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
//   terminal show           the liveness check for a terminal handle. A handle
//                           Orca still knows answers `result.terminal`; one it
//                           no longer knows is refused `terminal_handle_stale`
//   terminal create         the controller's own sender terminal, made by Orca
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
// Named so a human looking at Orca's terminal list can tell at a glance which
// tab belongs to the controller and must not be closed or typed into.
export const CONTROLLER_TERMINAL_TITLE = 'julia-controller';

// ---------------------------------------------------------------------------
// The request-id ledger
// ---------------------------------------------------------------------------

// `entries` is plain JSON so it can live in the controller's state file and
// survive a restart: if the same action is issued again after the restart, the
// id here makes it a replay rather than a second worker. Nothing re-issues an
// interrupted action on startup -- a card killed mid-flight is not picked back
// up by itself; that resume is JUL-99. What makes even the replay true rather
// than merely intended is `normalize()` in ./state.mjs, which round-trips
// `requests` -- a field it did not list would be dropped on read, silently, and
// a re-issued action would become a second worker.
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

    // (8) The liveness check for a terminal handle. `terminal show` is the
    // only read verb that takes ONE handle and answers whether Orca still
    // knows it; `terminal list` would answer a page that has to be searched
    // (and is capped by --limit), `terminal read` fetches screen output the
    // controller has no use for, and `terminal wait` BLOCKS, which is the one
    // thing a startup check must not do. Recorded live at 1.4.205:
    // terminal-show.plain-diagnostic-live.json and
    // terminal-show.unknown-handle.error.json.
    async terminalShowImpl({ terminal } = {}) {
      return call(['terminal', 'show', '--environment', environment, '--terminal', terminal]);
    },

    // (9) The controller's own sender terminal. `terminal create` is Orca's
    // own verb for a plain terminal in an existing worktree -- its own help
    // says "Use this, not worktree create, for a fresh agent in the current
    // checkout" -- and `worker-start` is wrong here because that starts a
    // SUPERVISED AGENT with a model allowance, which this terminal must never
    // be: nothing runs in it. No --command, so it is a bare shell.
    async terminalCreateImpl({ title = CONTROLLER_TERMINAL_TITLE } = {}) {
      return call([
        'terminal', 'create',
        '--environment', environment,
        '--worktree', repo,
        '--title', title,
      ]);
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
// The controller's own sender terminal
// ---------------------------------------------------------------------------

// WHY THIS EXISTS. The controller cannot make its two dispatch calls without a
// sender terminal handle: `runCreateImpl` and `workerStartImpl` above both pass
// it as `--from`, and `run-create` is refused outright without one
// (graph/fixtures/orca-1.4.205/run-create.no-sender-terminal.error.json). The
// mailbox wait (`checkWaitImpl`) carries the same handle under a different
// flag, `--terminal`. The remaining calls -- `worker-release`, `worktree ps`,
// `worktree rm` -- do not carry it at all. Until
// JUL-98 step 5 that handle came only from $JULIA_CONTROLLER_TERMINAL, which
// NOTHING set -- not ops/controller/julia-controller.service, not the runbook --
// so the controller printed its banner, refused and exited 1 on every start.
// Behind `Restart=always` / `RestartSec=5` / `StartLimitIntervalSec=0` that is a
// five-second crash loop that never stops and never moves a card.
//
// And a handle is not a thing a human could paste in once and be done: an Orca
// terminal handle does not survive an Orca restart (recorded:
// terminal-send.terminal-handle-stale.error.json is a send into a terminal an
// Orca restart had killed). So the controller finds or makes its own.
//
// THE ORDER, and what each branch is protecting against:
//   (a) $JULIA_CONTROLLER_TERMINAL, if Orca still knows it -- an operator
//       pointing the controller at a terminal they are watching still works.
//   (b) the handle this controller recorded on a previous start, if Orca still
//       knows it. This branch is the whole reason the handle is in the state
//       file: without it a restart makes a NEW terminal, and a crash loop makes
//       one every five seconds for ever.
//   (c) a fresh one from Orca, recorded before it is used.
//
// LIVENESS IS ASKED, NEVER ASSUMED. A handle being present in the environment
// or on disk says nothing about whether Orca still has it; only `terminal show`
// does. A handle Orca refuses is replaced, not used.
//
// AND IF NONE OF THAT WORKS it throws, and main() refuses loudly and exits
// non-zero exactly as it did before. Starting without a sender terminal would
// only move the same failure to the first `run-create`, with less to say.
export async function resolveSenderTerminal({
  env = process.env,
  state = {},
  boundaries,
  title = CONTROLLER_TERMINAL_TITLE,
  warn = console.error,
} = {}) {
  const isLive = async (handle) => {
    if (!handle) return false;
    try {
      const answer = await boundaries.terminalShowImpl({ terminal: handle });
      // The recorded live answer carries `result.terminal.handle`; a handle
      // Orca no longer knows is the thrown `terminal_handle_stale` below.
      // `orphaned: true` is Orca still holding a row for a terminal whose pty
      // is gone -- not something to send from either.
      const terminal = answer?.terminal ?? null;
      return Boolean(terminal?.handle) && terminal.orphaned !== true;
    } catch (error) {
      // ONLY Orca saying it no longer knows this handle counts as "dead".
      // scripts/orca-cli.mjs run() throws three different things and only one
      // of them is that answer: the structured refusal carries Orca's own code
      // on the error (`failure.code = code`, orca-cli.mjs line 82), while a
      // daemon that is down or an exec that fails throws a plain
      // `orca ... failed: <detail>` with NO `.code` (line 71) and malformed
      // output throws `did not return valid JSON`, also with no `.code`
      // (line 77). Reading all three as "dead" would skip the configured
      // handle, skip the recorded handle for the same wrong reason, and fall
      // through to `terminal create` -- one new terminal per start, which under
      // RestartSec=5 is one every five seconds: exactly the leak the recorded
      // branch exists to prevent, wearing a different hat.
      //
      // WHAT THIS TRADES. A daemon blip now makes the controller refuse and be
      // restarted by systemd every five seconds, which the crash-loop detector
      // makes visible on the board. The alternative was silently leaking a
      // terminal every five seconds, which nothing anywhere would show.
      // Visible and stopped beats invisible and spreading.
      if (error?.code !== 'terminal_handle_stale') throw error;
      warn(`[controller] terminal ${handle} is not usable (${error.code}): ${error.message}`);
      return false;
    }
  };

  const configured = env.JULIA_CONTROLLER_TERMINAL?.trim() || null;
  if (configured && await isLive(configured)) {
    return { terminal: configured, state, created: false, source: 'configured' };
  }
  const recorded = state.senderTerminal ?? null;
  if (recorded && await isLive(recorded)) {
    return { terminal: recorded, state, created: false, source: 'recorded' };
  }

  const answer = await boundaries.terminalCreateImpl({ title });
  const handle = answer?.terminal?.handle ?? null;
  if (!handle) {
    throw new Error(`orca terminal create answered no terminal handle (${JSON.stringify(answer ?? null).slice(0, 200)})`);
  }
  // A create that Orca could not make visible still gives a working handle and
  // says so in `warning` (recorded: terminal-create.plain-diagnostic.json).
  // That is a note, not a failure -- nothing is ever typed into this terminal.
  if (answer.terminal.warning) warn(`[controller] ${answer.terminal.warning}`);
  return { terminal: handle, state: { ...state, senderTerminal: handle }, created: true, source: 'created' };
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
