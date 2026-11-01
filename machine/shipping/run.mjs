#!/usr/bin/env node
// The machine's own entry point. It fetches the pull request's head, checks the
// code out on its own, starts the Shipping workflow, then writes the
// determination from Mastra's record of that run and posts it on the pull
// request. Nothing here judges the code; the Shipping agent does that.
//
//   node scripts/julia-agents.mjs -- node machine/shipping/run.mjs --pr 401 --card JUL-305
//
// The harness reads this file's own environment first, so the trace path and
// the state database are set below before any Mastra module is loaded.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const USAGE = `usage: node machine/shipping/run.mjs --pr <number> --card <JUL-number> [--model <id>] [--no-post] [--force]`;

function parseArgs(argv) {
  const options = { pr: null, card: null, model: null, post: true, force: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--pr') options.pr = Number(argv[++index]);
    else if (flag === '--card') options.card = argv[++index];
    else if (flag === '--model') options.model = argv[++index];
    else if (flag === '--no-post') options.post = false;
    else if (flag === '--force') options.force = true;
    else if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`unknown argument ${flag}\n${USAGE}`);
  }
  if (!Number.isInteger(options.pr) || options.pr <= 0) throw new Error(`--pr is required\n${USAGE}`);
  if (!/^[A-Z]+-\d+$/.test(String(options.card ?? ''))) throw new Error(`--card is required\n${USAGE}`);
  return options;
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function prepareCheckout(pr, runDir, checkout) {
  git(['fetch', '--no-tags', '--quiet', 'origin', `pull/${pr}/head`]);
  const sha = git(['rev-parse', 'FETCH_HEAD^{commit}']);
  try {
    git(['worktree', 'remove', '--force', checkout]);
  } catch {
    // No worktree there yet; the add below fails loudly if something else is.
  }
  try {
    git(['worktree', 'prune']);
  } catch {
    // Prune is tidiness; a stale registration fails the add with a clear message.
  }
  fs.mkdirSync(runDir, { recursive: true });
  git(['worktree', 'add', '--detach', '--quiet', checkout, sha]);
  return sha;
}

function traceFileFor(pr) {
  const dir = process.env.JULIA_TRACES_DIR || path.join(os.homedir(), '.local', 'share', 'mastracode', 'traces');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${stamp}-${process.pid}-shipping-pr-${pr}.duckdb`);
}

// A posting step reads the saved result first: a run that reached the pull request
// and then died must not comment a second time when it is started again.
function savedPosting(runDir, pr, sha, card) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(runDir, 'record.json'), 'utf8'));
    if (saved.pr !== pr || saved.sha !== sha || saved.card?.identifier !== card) return null;
    return saved.posted?.url ? saved : null;
  } catch {
    return null;
  }
}

function postComment(pr, bodyFile) {
  const url = execFileSync('gh', ['pr', 'comment', String(pr), '--body-file', bodyFile], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return url.split(/\s+/).find(part => part.startsWith('http')) ?? url;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDir = path.join(repoRoot, '.artifacts', 'shipping', `pr-${options.pr}`);
  const checkout = path.join(runDir, 'worktree');

  console.log(`Fetching pull request #${options.pr} and checking it out at ${checkout}.`);
  const sha = prepareCheckout(options.pr, runDir, checkout);
  console.log(`Pull request #${options.pr} is at ${sha}.`);

  if (options.post && !options.force) {
    const saved = savedPosting(runDir, options.pr, sha, options.card);
    if (saved) {
      console.log(`Already reviewed at ${sha} and posted at ${saved.posted.url}. Nothing to do; pass --force to review it again.`);
      return;
    }
  }

  const traceFile = traceFileFor(options.pr);
  process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFile;
  if (!process.env.MASTRA_DB_PATH) process.env.MASTRA_DB_PATH = path.join(runDir, 'state.db');
  console.log(`Mastra writes this run's record to ${traceFile}.`);

  const { runShipping, WORKFLOW_ID, PLAYBOOK, FREE_MODEL } = await import('./workflow.mjs');
  const { stopHarness } = await import('./harness.mjs');
  const { readSpans, workflowRun } = await import('./trace-record.mjs');
  const { commandsFromSpans, determinationComment, playbookSteps } = await import('./determination.mjs');

  const modelId = options.model ?? FREE_MODEL;
  const run = await runShipping({
    pr: options.pr,
    sha,
    checkout,
    card: options.card,
    modelId,
    log: message => console.log(message),
  });
  await stopHarness(run.booted);

  const spans = await readSpans(traceFile);
  const workflowSpan = workflowRun(spans, WORKFLOW_ID);
  const { commands, otherTools } = commandsFromSpans(spans);
  let steps = [];
  try {
    steps = playbookSteps(fs.readFileSync(path.join(checkout, PLAYBOOK), 'utf8'));
  } catch {
    steps = [];
  }

  const failed = run.output ? null : `the workflow ended ${run.status}: ${run.error ?? 'no answer'}`;
  const comment = determinationComment({
    pr: options.pr,
    sha,
    card: run.output?.card ?? { identifier: options.card },
    model: run.output?.modelId ?? modelId,
    playbook: PLAYBOOK,
    workflowRunId: workflowSpan?.runId ?? run.runId,
    workflowId: WORKFLOW_ID,
    traceFile,
    criteria: run.output?.criteria ?? [],
    verdict: run.verdict,
    commands,
    otherTools,
    steps,
    failed,
  });

  const recordPath = path.join(runDir, 'record.json');
  const commentPath = path.join(runDir, 'determination.md');
  fs.writeFileSync(commentPath, comment);
  const record = {
    pr: options.pr,
    sha,
    checkout,
    card: run.output?.card ?? { identifier: options.card },
    criteria: run.output?.criteria ?? [],
    modelId: run.output?.modelId ?? modelId,
    playbook: PLAYBOOK,
    workflowId: WORKFLOW_ID,
    workflowRunId: workflowSpan?.runId ?? run.runId,
    traceFile,
    status: run.status,
    error: run.error,
    elapsedMs: run.elapsedMs,
    verdict: run.verdict?.verdict ?? null,
    answer: run.verdict?.raw ?? null,
    commands,
    otherTools,
    determination: commentPath,
    posted: null,
  };

  if (options.post) {
    record.posted = { url: postComment(options.pr, commentPath) };
    console.log(`Posted the determination on pull request #${options.pr}: ${record.posted.url}`);
  } else {
    console.log(`Left the determination unposted at ${commentPath}.`);
  }

  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Wrote the run record to ${recordPath}.`);
  console.log(`The Shipping agent said ${record.verdict ?? 'nothing usable'}; this is a result either way.`);
}

main().catch(error => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
