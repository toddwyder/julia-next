#!/usr/bin/env node
// Runner for the merge machine. Everything the workflow needs from the outside
// world is injected here, so the workflow itself stays a description of the
// order and the machine's steps can be tested without a forge or a tracker.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { scratchDir } from '../../scripts/scratch-dir.mjs';
import { fileURLToPath } from 'node:url';

import { getIssue, postComment, setIssueState } from '../../scripts/linear-cli.mjs';
import { alreadyCompleted, completeCard, deleteRemoteBranch, gh, mainRunsFor, mergePullRequest, prepareMainCheckout, publishDocs, pullRequestComments, readPullRequest, waitForMainCi, waitForMerged, waitForPullChecks } from './land.mjs';
import { runRetro } from './retro.mjs';
import { deadTestFiles, runSweep, sweepPlan, sweepSummary } from './sweep.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function parseArgs(argv) {
  const args = { noPost: false, force: false, model: null, cardFile: null, pr: null, card: null };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--pr') args.pr = Number(argv[++index]);
    else if (value === '--card') args.card = argv[++index];
    else if (value === '--model') args.model = argv[++index];
    else if (value === '--card-file') args.cardFile = argv[++index];
    else if (value === '--no-post') args.noPost = true;
    else if (value === '--force') args.force = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!Number.isInteger(args.pr) || args.pr <= 0) throw new Error('--pr <number> is required');
  if (!args.card) throw new Error('--card <JUL-n> is required');
  return args;
}

function git(args, { cwd = root } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function recordPath(runDir) {
  return path.join(runDir, 'record.json');
}

// The card stays the object the gather step read from Linear. A run that stops
// before it (or a refusal) still writes a record, and a bare identifier there
// would make the next run think it was resuming a different card.
function cardFor(runDir, identifier) {
  const card = readRecord(runDir)?.card;
  return card && typeof card === 'object' ? card : { identifier, title: '', description: '', url: null };
}

function readRecord(runDir) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(runDir), 'utf8'));
  } catch {
    return null;
  }
}

function writeRecord(runDir, record) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(recordPath(runDir), `${JSON.stringify(record, null, 2)}\n`);
}

function traceFileFor(pr, label = 'merge') {
  const dir = process.env.JULIA_TRACES_DIR ?? path.join(process.env.HOME ?? '.', '.local/share/mastracode/traces');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `merge-pr-${pr}-${label}-${Date.now()}.duckdb`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.join(root, '.artifacts', 'merge', `pr-${args.pr}`);
  const checkoutDir = path.join(scratchDir, 'merge', `pr-${args.pr}`);
  const saved = args.force ? null : readRecord(runDir);
  if (saved?.status === 'finished' && saved.merge?.commit) {
    console.log(`The merge machine already finished ${args.card} on pull request #${args.pr}: ${saved.merge.commit}. Pass --force to run it again.`);
    return 0;
  }

  if (!args.cardFile && !process.env.LINEAR_API_KEY) throw new Error('LINEAR_API_KEY is required unless --card-file is given');

  const readCard = async card => {
    if (args.cardFile) return JSON.parse(fs.readFileSync(args.cardFile, 'utf8'));
    return getIssue(card);
  };

  const changedFiles = pr => {
    const raw = gh(['pr', 'view', String(pr), '--json', 'files']);
    return JSON.parse(raw).files.map(file => file.path);
  };

  const firstCommitAt = pr => {
    const raw = gh(['pr', 'view', String(pr), '--json', 'commits,createdAt']);
    const pull = JSON.parse(raw);
    const dates = (pull.commits ?? []).map(commit => commit.authoredDate ?? commit.committedDate).filter(Boolean).sort();
    if (dates.length > 0) return { at: dates[0], from: 'the pull request’s first commit' };
    if (pull.createdAt) return { at: pull.createdAt, from: 'the pull request opening' };
    return { at: null, from: 'nothing, which Linear will show as unknown' };
  };

  // Leftovers are collected here because only the repository knows them. The
  // merge machine's own run folder is never offered to the sweep.
  const collectLeftovers = ({ card, pr, head, checkout, changed }) => {
    const mergedLocal = new Set(git(['branch', '--merged', 'origin/main', '--format=%(refname:short)']).split(/\r?\n/).filter(Boolean));
    const mergedRemote = new Set(git(['branch', '-r', '--merged', 'origin/main', '--format=%(refname:short)']).split(/\r?\n/).filter(Boolean));
    const branches = [];
    for (const name of mergedLocal) {
      branches.push({ name, merged: true, remote: false, head: git(['rev-parse', name]) });
    }
    for (const name of git(['branch', '--format=%(refname:short)']).split(/\r?\n/).filter(Boolean)) {
      if (mergedLocal.has(name)) continue;
      branches.push({ name, merged: false, remote: false, head: git(['rev-parse', name]) });
    }
    for (const name of git(['branch', '-r', '--format=%(refname:short)']).split(/\r?\n/).filter(Boolean)) {
      if (name.endsWith('/HEAD')) continue;
      branches.push({ name, merged: mergedRemote.has(name), remote: true, head: git(['rev-parse', name]) });
    }

    const worktrees = git(['worktree', 'list', '--porcelain'])
      .split(/\r?\n\r?\n/)
      .map(block => {
        const lines = block.split(/\r?\n/);
        const worktree = lines.find(line => line.startsWith('worktree '));
        if (!worktree) return null;
        const branch = lines.find(line => line.startsWith('branch '));
        return { path: worktree.slice('worktree '.length), branch: branch ? branch.slice('branch '.length).replace('refs/heads/', '') : null };
      })
      .filter(Boolean);

    const artifacts = path.join(root, '.artifacts');
    const runDirs = fs.existsSync(artifacts)
      ? fs
          .readdirSync(artifacts)
          .map(name => path.join(artifacts, name, `pr-${pr}`))
          .filter(dir => fs.existsSync(dir))
          .filter(dir => dir !== runDir)
      : [];

    const tests = changed.filter(file => /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(file));
    const deadTests = deadTestFiles({
      files: tests.map(file => path.join(checkout, file)),
      read: file => fs.readFileSync(file, 'utf8'),
      exists: file => fs.existsSync(file),
    }).filter(test => !test.path.startsWith(path.join(artifacts, path.sep)));

    return sweepPlan({
      root,
      artifacts,
      card,
      pr,
      branches,
      worktrees: worktrees.filter(tree => !tree.path.startsWith(checkoutDir)),
      runDirs,
      deadTests,
      currentBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      mergedHead: head,
    });
  };

  const deps = {
    runDir,
    runId: null,
    modelId: args.model ?? undefined,
    getIssue: readCard,
    readPull: pr => readPullRequest(pr),
    readComments: pr => pullRequestComments(pr),
    changedFiles,
    firstCommitAt,
    merge: ({ pr, head }) => mergePullRequest({ pr, head }),
    deleteBranch: ({ ref }) => deleteRemoteBranch(ref),
    waitMerged: async ({ pr }) => waitForMerged({ pr, read: readPullRequest, log: console.log }),
    prepareMain: ({ sha }) => prepareMainCheckout({ root, runDir: checkoutDir, sha, git }),
    waitChecks: ({ pr }) => waitForPullChecks({ pr, log: console.log }),
    waitCi: ({ sha }) => waitForMainCi({ sha, list: mainRunsFor, log: console.log }),
    git,
    publish: publishDocs,
    saveRecord: async record => writeRecord(runDir, { ...record, updatedAt: new Date().toISOString() }),
    retro: async input => {
      process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFileFor(args.pr, 'merge-retro');
      return runRetro({ ...input, modelId: args.model ?? undefined, root, log: console.log });
    },
    sweep: async ({ card, pr, head, checkout, changed }) => {
      const plan = collectLeftovers({ card, pr, head, checkout, changed });
      const summary = sweepSummary(plan);
      const outcome = runSweep({ plan, root, git, log: console.log });
      fs.writeFileSync(path.join(runDir, 'sweep.json'), `${JSON.stringify({ plan, ...outcome }, null, 2)}\n`);
      return { summary, ...outcome, plan };
    },
    cardComments: async card => {
      const issue = await getIssue(card, { includeComments: true });
      return (issue.comments?.nodes ?? []).map(comment => ({ body: comment.body ?? '' }));
    },
    alreadyCompleted,
    completeCard: async ({ card, comment }) => {
      const result = await completeCard({
        card,
        comment,
        getIssue,
        postComment,
        setIssueState,
        mayPost: !args.noPost,
        keep: body => {
          const file = path.join(runDir, 'card-note.md');
          fs.mkdirSync(runDir, { recursive: true });
          fs.writeFileSync(file, `${body}\n`);
          return file;
        },
        log: console.log,
      });
      return { ...result, comment };
    },
  };

  process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFileFor(args.pr, 'merge');
  process.env.MASTRA_DB_PATH = path.join(runDir, 'state.db');
  fs.mkdirSync(runDir, { recursive: true });

  const { loadMastra } = await import('../shipping/harness.mjs');
  const { Mastra, LibSQLStore } = await loadMastra();
  const { createMergeWorkflow } = await import('./workflow.mjs');

  const mastra = new Mastra({ storage: new LibSQLStore({ id: `merge-pr-${args.pr}`, url: `file:${path.join(runDir, 'state.db')}` }), logger: false });
  const { workflow } = await createMergeWorkflow({ mastra, deps, log: console.log });

  const startedAt = new Date().toISOString();
  const run = await workflow.createRun();
  deps.runId = run.runId;
  writeRecord(runDir, { pr: args.pr, card: cardFor(runDir, args.card), status: 'running', runId: run.runId, startedAt, resume: saved ?? null });

  let result;
  try {
    result = await run.start({
      inputData: {
        pr: args.pr,
        card: args.card,
        resume: saved?.card?.identifier === args.card ? saved : null,
      },
    });
  } catch (error) {
    // The steps save their record after each one; a refusal keeps what the last
    // step reached so the next run can pick it up instead of starting over.
    writeRecord(runDir, { ...(readRecord(runDir) ?? {}), pr: args.pr, card: cardFor(runDir, args.card), status: 'refused', runId: run.runId, startedAt, reason: error.message });
    console.error(`The merge machine refused: ${error.message}`);
    return 1;
  }

  const record = result?.result ?? null;
  const finished = result?.status === 'success' && record;
  writeRecord(runDir, { ...(record ?? readRecord(runDir) ?? {}), pr: args.pr, card: cardFor(runDir, args.card), status: finished ? 'finished' : result?.status ?? 'failed', runId: run.runId, startedAt, updatedAt: new Date().toISOString(), error: result?.error?.message ?? null });

  if (!finished) {
    console.error(`The merge machine stopped: ${result?.error?.message ?? result?.status ?? 'no result'}`);
    return 1;
  }

  console.log(`${record.card.identifier}: ${record.merge?.commit ?? 'not merged'} on ${record.pull?.base ?? 'main'}; ${record.ci?.green ? 'main CI green' : 'main CI not green'}; retro ${record.retro?.ok ? `at ${record.retro.file}` : 'not written'}; ${record.sweep?.summary ?? 'nothing swept'}; card ${record.completion?.state ?? 'left in progress'}.`);
  if (record.stop) {
    console.error(`Stopped: ${record.stop.reason}`);
    return 1;
  }
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error(error.stack ?? error.message);
    process.exit(1);
  });
