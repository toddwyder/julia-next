// wiring.mjs -- the REAL implementation behind every boundary the controller
// leaves injected. Nothing else in the controller calls a real service.
//
// JUL-98 step 8 (Todd's Decision, 23 Sep) retired the start-then-message route:
// `worker-start`, `worker-show`, `worktree ps` as a turn-start proof, the
// `check --wait` mailbox, `worker-release`, typing a brief into an adopted
// terminal, and the worker-side cost-read and preparation terminals. Each seat
// is now ONE command in a plain terminal (./seat-run.mjs), answering through
// files the controller reads itself.
//
// WHAT IS STILL AN ORCA CALL:
//
//   run-create              the card's in-flight record, and width 1
//   run-list                the walk that answers "is a card already in
//                           flight?" (scripts/ready-queue.mjs `findActiveRun`)
//   worktree create / rm    the card's working copy, on the WORKER daemon
//   terminal create         a seat's one command (worker daemon), and the
//                           controller's own sender terminal (its own daemon)
//   terminal read / close   the seat's end marker, and the stop
//   terminal show           the liveness check for a terminal handle
//   --retry-request         Orca's own idempotency for run-create
//
// AND WHAT IS NOT: the test suite (`node --test` in the working copy, the same
// command CI runs), the seats' answers, progress and cost (files the seat
// writes in the working copy -- readable by this account, proven 23 Sep), and
// publishing (the julia-graph-publisher App, through scripts/publish-pr.mjs and
// scripts/merge-pr.mjs).
//
// WHAT `--retry-request` ACTUALLY TAKES. Orca ISSUES the request id: a first
// `run-create` answers `mutation.requestId`, and the same command re-run with
// `--retry-request <that id>` answers the same run with `replayed: true`
// (graph/fixtures/orca-1.4.205/run-create.ok.json and run-create.replayed.json).
// So the boundaries keep a LEDGER: the controller's own logical key for an
// action -> the request id Orca issued for it.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { orcaCall } from '../../scripts/orca-cli.mjs';
import { findActiveRun } from '../../scripts/ready-queue.mjs';
import { pushBranch, openPullRequest } from '../../scripts/publish-pr.mjs';
import { mergePullRequest } from '../../scripts/merge-pr.mjs';

const execFileAsync = promisify(execFile);

// TWO DAEMONS AND TWO CHECKOUTS, AND THEY ARE NOT INTERCHANGEABLE. Read this
// before you "simplify" one pair into the other, because JUL-98 step 5 already
// shipped that bug once and it stopped the controller dead.
//
// THE CONTROLLER'S OWN SIDE (the three constants immediately below). The
// controller process runs as `orchestrator-svc`, from
// /srv/orchestrator-svc/julia-next, and the Orca daemon that owns its Run is
// `orchestrator-local`. That checkout is root-owned and READ-ONLY to
// `orchestrator-svc` on purpose -- verified live: `ls -ld` answers
// `dr-xr-x--- root orchestrator-svc`, which is why ./state.mjs refuses to keep
// the controller's state file inside it and says so in its own header.
//
// THE WORKER SIDE (WORKER_ENVIRONMENT / WORKER_CHECKOUT below). A worker runs
// as `runner`, on the `ovh-local` daemon, in a worktree Orca creates from
// /home/runner/julia-next -- the runner-owned registered checkout. That is how
// every worker this graph has ever started was started:
// Orca's worktree creation on `ovh-local` from `path:/home/runner/julia-next`.
//
// WHAT BREAKS WHEN THEY ARE CONFUSED, which is not hypothetical -- it is the
// defect this constant pair exists to fix. Creating a worktree from a
// repository WRITES A BRANCH REF INTO THAT REPOSITORY. So pointing
// `worker-start --repo` at the controller's own read-only checkout makes Orca
// run `git worktree add -b <branch> ... ` inside it, and git answers:
//
//   state: failed, stage: worktree_create
//   fatal: cannot lock ref refs/heads/jul-92-probe: Unable to create
//   /srv/orchestrator-svc/julia-next/.git/refs/heads/jul-92-probe.lock:
//   Permission denied
//
// (reproduced by hand on 2026-09-21 after the controller did it for real to
// card JUL-92 at 18:54Z). EVERY dispatch fails identically, the card is left
// sitting in Implementation with nothing working on it, and the cycles after it
// report nothing-eligible because the run is still in flight. The fix is never
// to make the controller's checkout writable -- it is deliberately not -- but to
// dispatch into the runner's checkout on the runner's daemon.
//
// AND THE OTHER DIRECTION IS ALSO WRONG: the controller's Run, its mailbox and
// its own sender terminal live on `orchestrator-local`. Moving those to
// `ovh-local` answers `run_not_found` (runbook: "`run_not_found` on an
// orchestration command is the wrong daemon, not a missing Run"). Neither pair
// is a superset of the other; each Orca call below picks one deliberately.
export const ORCHESTRATOR_ENVIRONMENT = 'orchestrator-local';
export const ORCHESTRATOR_CHECKOUT = '/srv/orchestrator-svc/julia-next';
export const REPO_SELECTOR = `path:${ORCHESTRATOR_CHECKOUT}`;
// The worker daemon and the worker checkout: `runner`'s, writable by `runner`,
// which is what makes `git worktree add` possible at all.
export const WORKER_ENVIRONMENT = 'ovh-local';
export const WORKER_CHECKOUT = '/home/runner/julia-next';
export const WORKER_REPO_SELECTOR = `path:${WORKER_CHECKOUT}`;
export const PUBLISH_OWNER = 'toddwyder';
export const PUBLISH_REPO = 'julia-next';
export const PUBLISH_BASE = 'main';
// Named so a human looking at Orca's terminal list can tell at a glance which
// tab belongs to the controller and must not be closed or typed into.
export const CONTROLLER_TERMINAL_TITLE = 'julia-controller';

// Orca names a worktree `<repoId>::<path>`; git and the files want the path.
export function worktreePathOf(worktreeId) {
  if (typeof worktreeId !== 'string') return worktreeId;
  const marker = worktreeId.indexOf('::');
  return marker < 0 ? worktreeId : worktreeId.slice(marker + 2);
}

// ---------------------------------------------------------------------------
// The request-id ledger
// ---------------------------------------------------------------------------

// `entries` is plain JSON so it can live in the controller's state file and
// survive a restart: if the same action is issued again after the restart, the
// id here makes it a replay rather than a second run. Nothing re-issues an
// interrupted action on startup -- a card killed mid-flight is not picked back
// up by itself; that resume is JUL-99. What makes even the replay true rather
// than merely intended is `normalize()` in ./state.mjs, which round-trips
// `requests` -- a field it did not list would be dropped on read, silently, and
// a re-issued action would become a second run.
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

// `environment`/`repo` are the CONTROLLER'S OWN daemon and checkout;
// `workerEnvironment`/`workerRepo` are the RUNNER'S. See the constant block at
// the top of this file for why the two pairs can never be collapsed into one.
// Each boundary below names which pair it uses and why.
export function createOrcaBoundaries({
  environment = ORCHESTRATOR_ENVIRONMENT,
  repo = REPO_SELECTOR,
  workerEnvironment = WORKER_ENVIRONMENT,
  workerRepo = WORKER_REPO_SELECTOR,
  ledger = createRequestLedger(),
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
    // THE CONTROLLER'S OWN daemon and THE CONTROLLER'S OWN checkout, and it
    // stays there: this terminal is the controller's `--from` handle, it must
    // live on the daemon the Run lives on, and nothing is ever run in it -- so
    // the read-only checkout being read-only costs it nothing.
    async terminalCreateImpl({ title = CONTROLLER_TERMINAL_TITLE } = {}) {
      return call([
        'terminal', 'create',
        '--environment', environment,
        '--worktree', repo,
        '--title', title,
      ]);
    },

    // (10) A SEAT'S ONE COMMAND (./seat-run.mjs), in a plain terminal on the
    // WORKER daemon, so it runs as `runner`, in the card's working copy. No
    // agent is started by Orca and nothing is ever typed in: the command
    // carries everything, and a 40,000-character command was measured arriving
    // intact (23 Sep).
    async workerTerminalCreateImpl({ worktreePath, title, command } = {}) {
      return call([
        'terminal', 'create',
        '--environment', workerEnvironment,
        '--worktree', `path:${worktreePath}`,
        '--title', title,
        '--command', command,
      ]);
    },

    // (11) Reading that terminal back, for the end marker only. The accumulated
    // stream, paged with `--cursor` (a read with NO cursor returns the OLDEST
    // retained window, not the newest -- runbook, "Seven findings carried from
    // the cancelled JUL-106", item 6).
    async terminalReadImpl({ terminal, cursor = null, limit = 2000 } = {}) {
      const args = ['terminal', 'read', '--environment', workerEnvironment, '--terminal', terminal, '--limit', String(limit)];
      if (cursor !== null && cursor !== undefined) args.push('--cursor', String(cursor));
      return call(args);
    },

    // (12) Closing it: cleanup, never the stop. Measured 2026-09-23: closing an
    // Orca terminal kills what runs in it outright, with no signal a handler
    // can catch, and a seat's agent -- in its own process group -- survives it.
    // The stop is ./seat-run.mjs's `stopGroupCommand`. One pane, never `--all`.
    async terminalCloseImpl({ terminal } = {}) {
      return call(['terminal', 'close', '--environment', workerEnvironment, '--terminal', terminal]);
    },

    // (13) The card's working copy, on the RUNNER'S daemon from the RUNNER'S
    // checkout (the only checkout a branch can be created in). `--base-branch`
    // names what it starts from, so a stale checked-out branch in the shared
    // checkout can never become the base.
    async worktreeCreateImpl({ name, baseBranch } = {}) {
      const args = [
        'worktree', 'create',
        '--environment', workerEnvironment,
        '--repo', workerRepo,
        '--name', name,
        '--no-parent',
      ];
      if (baseBranch) args.push('--base-branch', baseBranch);
      return call(args);
    },

    // (7) The worktree. Orca names one `<repoId>::<path>`, which is exactly the
    // `id:` selector `worktree rm` documents. THE RUNNER'S daemon, for the same
    // reason as `worktree ps`: that is the daemon that has the worktree, and a
    // removal sent to the controller's daemon would leave the real worktree on
    // disk for ever. Also `--environment`-less before JUL-98 step 5.
    async removeWorktreeImpl({ worktree } = {}) {
      if (!worktree) return { removed: false, reason: 'the dispatch recorded no worktree' };
      return call(['worktree', 'rm', '--environment', workerEnvironment, '--worktree', `id:${worktree}`]);
    },
  };
}

// ---------------------------------------------------------------------------
// The controller's own sender terminal
// ---------------------------------------------------------------------------

// WHY THIS EXISTS. The controller cannot make its two dispatch calls without a
// sender terminal handle: `runCreateImpl` above passes it as `--from`, and
// `run-create` is refused outright without one
// (graph/fixtures/orca-1.4.205/run-create.no-sender-terminal.error.json). Until
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
// The end marker a seat's command prints
// ---------------------------------------------------------------------------

// WHY COMPLETION IS NOT `terminal wait`. A plain terminal is NOT finished when
// `terminal wait` says so: `--for tui-idle` answers `satisfied: true` at once
// even mid-run, and `--for exit` only ever times out because the shell stays
// open after the command returns (runbook, "the seven JUL-106 findings
// re-checked", row 3). So the command ends by printing this marker with its own
// exit status, which the shell can only do once the command has returned.
export const WORKER_SCRIPT_END_MARKER = '__JULIA_WORKER_SCRIPT_DONE__';

// The marker as the shell printed it, anchored, so the ECHO of the command --
// which also contains the marker text, inside quotes -- is never the answer.
const END_MARKER_LINE = new RegExp(`^${WORKER_SCRIPT_END_MARKER}:(\\d+)$`);

export function workerScriptExitCode(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = END_MARKER_LINE.exec(String(lines[i]).trim());
    if (match) return Number(match[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Publishing -- the App, never a personal git identity
// ---------------------------------------------------------------------------

// The reviewed head commit, read out of the candidate worktree. merge-pr.mjs
// refuses anything that is not a 40-character sha, and GitHub refuses the merge
// with a 409 if the PR head has moved since -- so the commit that is merged is
// the commit that was reviewed, proven by GitHub rather than by trust.
//
// ACROSS THE OWNERSHIP BOUNDARY. This runs as `orchestrator-svc` against a
// worktree owned by `runner` (JUL-98 step 5: the candidate worktree now lives
// under /home/runner/orca/workspaces/julia-next/). Git's dubious-ownership
// guard -- which is about the owning UID, not about file permissions -- then
// refuses to operate in that directory at all: "fatal: detected dubious
// ownership in repository at ...". So `-c safe.directory=<the exact path the
// caller passed in>`, the same fix scripts/publish-pr.mjs (pushBranch) and
// scripts/verify-reviewer-worktree.mjs already use, scoped to that one path and
// never read from repo-local config, where a pushed commit could poison it.
// WITHOUT IT the read fails, so no sha reaches merge-pr.mjs and the card stops
// at `stage: publish` after the work has already passed.
export async function headShaOf(worktreePath, { execImpl = execFileAsync } = {}) {
  const { stdout } = await execImpl('git', ['-c', `safe.directory=${worktreePath}`, '-C', worktreePath, 'rev-parse', 'HEAD']);
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
