// wiring.mjs -- JUL-98 step 4, Task B: the REAL implementation behind every
// boundary graph/controller/step-runner.mjs leaves injected.
//
// step-runner.mjs's own header ends: "Nothing here calls Orca, Linear, Axiom or
// git; step 4 is what wires the real implementations and switches it on." This
// is that file, and nothing else in the controller calls a real service.
//
// ORCA FIRST. Every boundary that is about WAITING, LOCKING, RETRYING, WORKER
// TRACKING or CLEANUP is an Orca command, not code written here:
//
//   run-create              the card's in-flight record, and width 1
//   run-list                the walk that answers "is a card already in
//                           flight?" (scripts/ready-queue.mjs `findActiveRun`,
//                           one walk, one home)
//   worker-start            a fresh worker, its worktree and its terminal, all
//                           created by Orca
//   worktree ps             the ONLY recorded proof that an agent is really
//                           running (`agents[].state`)
//   check --wait            the blocking mailbox. There is no poll loop, no
//                           terminal read and no sleep anywhere in the
//                           controller
//   worker-release          output archived, terminal closed
//   worktree rm             the worktree removed
//   --retry-request         Orca's own idempotency, instead of a hand-built
//                           "did I already do this?" check
//
// THE THREE BOUNDARIES ORCA DOES NOT COVER, and why each is not an Orca call:
//
//   the test suite   `node --test scripts/*.test.mjs` in the candidate
//                    worktree. A supervised agent would be a second opinion
//                    about the tests; the card wants the controller's own run,
//                    and it is the same command CI runs.
//   the cost read    Orca exposes no token or dollar figure at all --
//                    `worktree ps`, `worker-show` and `terminal list` were all
//                    searched (docs/research/jul109-orca-1.4.205-findings.md,
//                    section 5). The figures live in the vendors' own session
//                    files, so that is where they are read from.
//   publishing       the julia-graph-publisher GitHub App, through
//                    scripts/publish-pr.mjs and scripts/merge-pr.mjs. Orca has
//                    no publish verb, and the App credential is the one route
//                    that does not use a personal git identity.
//
// WHAT `--retry-request` ACTUALLY TAKES, which the card's earlier steps had
// slightly wrong. Orca ISSUES the request id: a first `run-create` answers
// `mutation.requestId` and `replayed: false`, and the same command re-run with
// `--retry-request <that id>` answers the same run with `replayed: true`
// (graph/fixtures/orca-1.4.205/run-create.ok.json and run-create.replayed.json,
// and the fixture README's own command column). A caller cannot invent one. So
// the boundaries below keep a LEDGER: the controller's own logical key for an
// action -> the request id Orca issued for it. A repeat of that action replays
// through Orca instead of starting a second run or a second worker.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { orcaCall } from '../../scripts/orca-cli.mjs';
import { findActiveRun } from '../../scripts/ready-queue.mjs';
import { pushBranch, openPullRequest } from '../../scripts/publish-pr.mjs';
import { mergePullRequest } from '../../scripts/merge-pr.mjs';
import { claudeExtractFromTranscript, codexExtractFromRollout, seatCostLine } from './cost.mjs';
import { WORKER_MESSAGE_TYPES } from './mailbox.mjs';

const execFileAsync = promisify(execFile);

export const ORCHESTRATOR_ENVIRONMENT = 'orchestrator-local';
export const ORCHESTRATOR_CHECKOUT = '/srv/orchestrator-svc/julia-next';
export const REPO_SELECTOR = `path:${ORCHESTRATOR_CHECKOUT}`;
export const PUBLISH_OWNER = 'toddwyder';
export const PUBLISH_REPO = 'julia-next';
export const PUBLISH_BASE = 'main';

// ---------------------------------------------------------------------------
// The request-id ledger
// ---------------------------------------------------------------------------

// `entries` is plain JSON so it can live in the controller's state file and
// survive a restart: a controller killed between starting a worker and
// recording it must replay that worker on the way back up, not start a second.
export function createRequestLedger(entries = {}) {
  const book = { ...entries };
  return {
    // The flag pair to append to an argv, or nothing the first time round.
    flagsFor(key) {
      return key && book[key] ? ['--retry-request', book[key]] : [];
    },
    // Orca's own issued id, off the answer it just gave.
    record(key, result) {
      const issued = result?.mutation?.requestId;
      if (key && issued) book[key] = issued;
      return result;
    },
    entries() {
      return { ...book };
    },
  };
}

// ---------------------------------------------------------------------------
// The Orca boundaries
// ---------------------------------------------------------------------------

export function createOrcaBoundaries({
  environment = ORCHESTRATOR_ENVIRONMENT,
  repo = REPO_SELECTOR,
  ledger = createRequestLedger(),
  // High enough that the shared row cap cannot hide this controller's own
  // worker on a busy host; `truncated` above catches it if it ever does.
  worktreePsLimit = 200,
  orcaCallImpl = orcaCall,
  findActiveRunImpl = findActiveRun,
} = {}) {
  const call = (args) => orcaCallImpl([...args, '--json']);

  return {
    ledger,

    // (1) The card's in-flight record IS its Orca run.
    async runCreateImpl({ from, objective, requestId } = {}) {
      const result = await call([
        'orchestration', 'run-create',
        '--environment', environment,
        '--from', from,
        '--objective', objective,
        ...ledger.flagsFor(requestId),
      ]);
      return ledger.record(requestId, result);
    },

    // (2) Width 1. Orca's run list is the answer, walked to the end by the one
    // walk the repo has. Returns the RUN, because the controller says on the
    // card which card is in flight, not merely that one is.
    async activeRunImpl() {
      return findActiveRunImpl({ environment });
    },

    // (3) A fresh worker: new worktree, new terminal, new task and dispatch
    // ids, all Orca's. `--setup skip` matches the recorded probe that started
    // a healthy Claude worker (worker-start.claude-model-effort.json).
    async workerStartImpl({ run, from, spec, worktree, name, agent, model, effort, requestId } = {}) {
      const args = [
        'orchestration', 'worker-start',
        '--environment', environment,
        '--run', run,
        '--from', from,
        '--spec', spec,
        '--worktree', worktree,
        '--name', name,
        '--repo', repo,
        '--agent', agent,
        '--setup', 'skip',
      ];
      // `--effort requires --model` (worker-start --help), so they travel
      // together or not at all.
      if (model) args.push('--model', model);
      if (model && effort) args.push('--effort', effort);
      args.push(...ledger.flagsFor(requestId));
      const result = await call(args);
      return ledger.record(requestId, result);
    },

    // (4) Turn-start proof. `worktree ps` is the one recorded answer in which
    // Orca says an agent is really running; the row for THIS worker's worktree
    // is what proveTurnStarted() classifies.
    //
    // SHAPE, CONFIRMED LIVE 2026-09-21 by running `orca worktree ps --json` in
    // this repo's own worktree: `result.worktrees[]`, each row keyed
    // `worktreeId` (NOT `id`) and carrying `agents[]` with `state: "working"`,
    // beside `totalCount` and `truncated`.
    //
    // THE TRAP `truncated` IS: the row cap is shared across hosts, so a busy
    // machine can answer a page that simply does not contain this worker's
    // worktree. "Absent" would then be read as "no turn started", and
    // step-runner.mjs would release a perfectly healthy worker as never-started.
    // So an absent row on a TRUNCATED page is an error, not a verdict.
    async observeStartImpl({ dispatch } = {}) {
      const answer = await call(['worktree', 'ps', '--limit', String(worktreePsLimit)]);
      const worktrees = answer?.worktrees ?? [];
      const wanted = dispatch?.worktree ?? null;
      const worktree = worktrees.find((row) => row?.worktreeId === wanted) ?? null;
      if (!worktree && answer?.truncated === true) {
        throw new Error(`worktree ps returned a truncated page of ${worktrees.length} of ${answer.totalCount ?? 'unknown'} worktrees and none of them is ${wanted} -- refusing to read an absent row as "no turn started"`);
      }
      // `send` stays null: the controller never types into a worker's terminal,
      // so it has no `terminal send --wait-submit` answer to classify. A row
      // that is genuinely absent from a complete page is reported as "nothing
      // observed", which proveTurnStarted refuses -- the right answer, never an
      // assumed start.
      return { worktree, start: dispatch?.raw ?? null };
    },

    // (5) The mailbox. `--wait` blocks in Orca; nothing here sleeps or polls.
    async checkWaitImpl({ terminal, runId, types = WORKER_MESSAGE_TYPES, timeoutMs, ack } = {}) {
      const args = [
        'orchestration', 'check',
        '--environment', environment,
        '--terminal', terminal,
        '--wait',
        '--timeout-ms', String(timeoutMs),
        '--types', types.join(','),
      ];
      if (runId) args.push('--run', runId);
      // "A bound Run replays the same Delivery until --ack": the previous
      // batch is acknowledged by the wait that follows it.
      if (ack) args.push('--ack', ack);
      return call(args);
    },

    // (6) Release: output archived, terminal closed. Idempotent in Orca itself
    // ("repeating the call reports already_released"), so no guard here.
    async releaseImpl({ dispatchId } = {}) {
      return call(['orchestration', 'worker-release', '--dispatch', dispatchId]);
    },

    // (7) The worktree. Orca names one `<repoId>::<path>`, which is exactly the
    // `id:` selector `worktree rm` documents.
    async removeWorktreeImpl({ worktree } = {}) {
      if (!worktree) return { removed: false, reason: 'the dispatch recorded no worktree' };
      return call(['worktree', 'rm', '--worktree', `id:${worktree}`]);
    },
  };
}

// ---------------------------------------------------------------------------
// The cost read -- NOT an Orca call, because Orca has no such figure
// ---------------------------------------------------------------------------

// Claude Code names a project directory after the worktree path with every
// character that is not a letter or a digit replaced by a dash
// (~/.claude/projects/-home-runner-jul109b-base-julia-next-b is the recorded
// example on this host, and this session's own directory is the same shape).
export function claudeProjectDirName(worktreePath) {
  return String(worktreePath).replace(/[^A-Za-z0-9]/g, '-');
}

// A .jsonl file as the list of its lines, with the blank last line dropped.
function splitJsonl(text) {
  return String(text).split('\n').filter((line) => line.trim() !== '');
}

function newestFile(dir, matches, { readdirImpl, statImpl }) {
  let entries;
  try {
    entries = readdirImpl(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries
    .filter((entry) => entry.isFile() && matches(entry.name))
    .map((entry) => {
      const full = join(dir, entry.name);
      return { full, mtimeMs: statImpl(full).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.full ?? null;
}

// Codex writes ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, so the newest
// rollout is found by walking the three date levels newest-first rather than
// by globbing the whole tree.
function newestCodexRollout(root, { readdirImpl, statImpl }) {
  const descend = (dir, depth) => {
    let names;
    try {
      names = readdirImpl(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    if (depth === 0) return newestFile(dir, (name) => /^rollout-.*\.jsonl$/.test(name), { readdirImpl, statImpl });
    const dirs = names.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
    for (const name of dirs) {
      const found = descend(join(dir, name), depth - 1);
      if (found) return found;
    }
    return null;
  };
  return descend(root, 3);
}

// One seat's figures, read while the worker's session files still exist --
// which is why graph/controller/release.mjs reads BEFORE it releases.
//
// WHAT THIS CANNOT PROVE BY TEST, stated here rather than left implied: that
// the real Claude/Codex worker Orca started on the server writes its session
// file where this looks. The LAYOUT is recorded (findings section 5, and the
// directory names on this host); that a controller-started worker lands in it
// is only provable when the controller runs for real.
export function createSeatCostReader({
  homedir = os.homedir(),
  readFileImpl = readFileSync,
  readdirImpl = readdirSync,
  statImpl = statSync,
} = {}) {
  return async function readSeatCost({ seat, worktree, agent, startedAt = null, endedAt = null }) {
    const worktreePath = worktreePathOf(worktree);
    if (agent === 'claude') {
      const dir = join(homedir, '.claude', 'projects', claudeProjectDirName(worktreePath));
      const file = newestFile(dir, (name) => name.endsWith('.jsonl'), { readdirImpl, statImpl });
      if (!file) {
        throw new Error(`no Claude transcript for the ${seat} seat under ${dir} -- its cost cannot be read, so the worker and its worktree are left in place`);
      }
      // parseTranscriptLines takes an ARRAY of lines: handing it the raw file
      // text would iterate it one CHARACTER at a time and total nothing at all
      // -- the exact silent-blank failure cost.mjs's own header records.
      return seatCostLine({ seat, ...claudeExtractFromTranscript(splitJsonl(readFileImpl(file, 'utf8'))) });
    }
    if (agent === 'codex') {
      const root = join(homedir, '.codex', 'sessions');
      const file = newestCodexRollout(root, { readdirImpl, statImpl });
      if (!file) {
        throw new Error(`no Codex rollout for the ${seat} seat under ${root} -- its cost cannot be read, so the worker and its worktree are left in place`);
      }
      const lines = splitJsonl(readFileImpl(file, 'utf8')).map((line) => JSON.parse(line));
      return seatCostLine({ seat, ...codexExtractFromRollout(lines) });
    }
    // A DeepSeek seat never reaches here: graph/controller/dispatch.mjs refuses
    // to start one with a new worktree at all (JUL-109 section 4).
    throw new Error(`no cost source is known for a ${JSON.stringify(agent)} seat (${seat}) -- refusing to guess a figure${startedAt && endedAt ? ` for ${startedAt}..${endedAt}` : ''}`);
  };
}

// Orca names a worktree `<repoId>::<path>`.
export function worktreePathOf(worktreeId) {
  if (typeof worktreeId !== 'string') return worktreeId;
  const marker = worktreeId.indexOf('::');
  return marker < 0 ? worktreeId : worktreeId.slice(marker + 2);
}

// ---------------------------------------------------------------------------
// Publishing -- the App, never a personal git identity
// ---------------------------------------------------------------------------

// The reviewed head commit, read out of the candidate worktree. merge-pr.mjs
// refuses anything that is not a 40-character sha, and GitHub refuses the merge
// with a 409 if the PR head has moved since -- so the commit that is merged is
// the commit that was reviewed, proven by GitHub rather than by trust.
export async function headShaOf(worktreePath, { execImpl = execFileAsync } = {}) {
  const { stdout } = await execImpl('git', ['-C', worktreePath, 'rev-parse', 'HEAD']);
  return String(stdout).trim();
}

export function createPublisher({
  owner = PUBLISH_OWNER,
  repo = PUBLISH_REPO,
  base = PUBLISH_BASE,
  env = process.env,
  pushBranchImpl = pushBranch,
  openPullRequestImpl = openPullRequest,
  mergePullRequestImpl = mergePullRequest,
  headShaImpl = headShaOf,
} = {}) {
  return {
    // The preflight the unit's optional EnvironmentFile makes necessary: if the
    // publisher key never loaded, say so ONCE at startup with the reason,
    // rather than carrying a card all the way to a publish that cannot happen.
    missingCredentials() {
      const missing = ['JULIA_PUBLISHER_APP_ID', 'JULIA_PUBLISHER_APP_PRIVATE_KEY'].filter((name) => !env[name]);
      return missing.length > 0 ? missing : null;
    },

    async publishAndMerge({ branch, worktreePath, title, body }) {
      const missing = this.missingCredentials();
      if (missing) {
        return { ok: false, reason: `publishing needs ${missing.join(' and ')} -- load /etc/orchestrator-svc/.env.publisher before starting the controller` };
      }
      await pushBranchImpl({ owner, repo, branch, cwd: worktreePath, env });
      const pr = await openPullRequestImpl({ owner, repo, head: branch, base, title, body, env });
      const sha = await headShaImpl(worktreePath);
      const merged = await mergePullRequestImpl({ owner, repo, number: pr.number, expectedHeadSha: sha, env });
      return { ok: Boolean(merged.merged), pr, sha, merged, reason: merged.merged ? null : (merged.message ?? 'GitHub did not report the pull request as merged') };
    },
  };
}
