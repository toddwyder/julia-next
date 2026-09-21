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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { orcaCall } from '../../scripts/orca-cli.mjs';
import { findActiveRun } from '../../scripts/ready-queue.mjs';
import { pushBranch, openPullRequest } from '../../scripts/publish-pr.mjs';
import { mergePullRequest } from '../../scripts/merge-pr.mjs';
import { createSeatCostReader, claudeProjectDirName, worktreePathOf, WORKER_HOME } from './cost-read.mjs';
import { WORKER_MESSAGE_TYPES } from './mailbox.mjs';

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
// `worker-start --environment orchestrator-local --on ovh-local --repo
// path:/home/runner/julia-next` (graph/fixtures/orca-1.4.205/README.md lines
// 9-12, recorded against the real daemon).
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
// AND THE WORKER'S HOME, WORKER_HOME, which now lives in ./cost-read.mjs with
// the reader that uses it, and is re-exported here so every caller and test
// that already imports it from this file still does. It belongs to `runner`,
// never to the account this process runs as, and ./cost-read.mjs's header
// records the measured 0700 permission that makes it unreadable from here.
export { createSeatCostReader, claudeProjectDirName, worktreePathOf, WORKER_HOME };
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
    //
    // THE ONE CALL THAT CARRIES BOTH SIDES, and the only one that needs `--on`.
    // `worker-start --help` says it in one line: "--on selects only the worker
    // server; the Run and this command remain on the current Orca server", and
    // on the next line "Use exact --repo on the selected server". So:
    //   --environment  the CONTROLLER'S daemon -- that is where `--run` lives,
    //                  and the wrong one answers `run_not_found`.
    //   --on           the RUNNER'S daemon -- where the worker process runs.
    //   --repo         the RUNNER'S checkout -- resolved on the `--on` server,
    //                  and writable by `runner`, so `git worktree add` can
    //                  create the branch ref it has to create.
    // Before JUL-98 step 5's fix there was no `--on` at all and `--repo` was
    // the controller's own read-only checkout, so every dispatch died in
    // `stage: worktree_create` with "Permission denied" (top of this file).
    async workerStartImpl({ run, from, spec, worktree, name, agent, model, effort, requestId } = {}) {
      const args = [
        'orchestration', 'worker-start',
        '--environment', environment,
        '--on', workerEnvironment,
        '--run', run,
        '--from', from,
        '--spec', spec,
        '--worktree', worktree,
        '--name', name,
        '--repo', workerRepo,
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
    //
    // AND IT IS ASKED OF THE RUNNER'S DAEMON. The worktree being looked for was
    // created by `worker-start --on ovh-local`, so `ovh-local` is the only
    // daemon that has a row for it. Until JUL-98 step 5 this call passed no
    // `--environment` at all and fell back to the process default -- which
    // under systemd is unset, because the unit sets no ORCA_ENVIRONMENT.
    async observeStartImpl({ dispatch } = {}) {
      const answer = await call(['worktree', 'ps', '--environment', workerEnvironment, '--limit', String(worktreePsLimit)]);
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
    //
    // THE CONTROLLER'S daemon, because a Dispatch belongs to the Run and the
    // Run is there. This too passed no `--environment` before JUL-98 step 5,
    // for the same reason `worktree ps` did not: the process default looked
    // like enough on a laptop and is unset under the unit.
    async releaseImpl({ dispatchId } = {}) {
      return call(['orchestration', 'worker-release', '--environment', environment, '--dispatch', dispatchId]);
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

    // (10) THE WORKER-SIDE COST TERMINAL, and the three verbs it takes.
    //
    // THE WHOLE POINT OF IT: a terminal Orca creates on the WORKER daemon runs
    // as the WORKER, so it can read the worker's own 0700 transcript directory
    // -- which this process cannot, and cannot be given without root. The
    // measured permissions are in ./cost-read.mjs's header.
    //
    //   --environment  the RUNNER'S daemon, `ovh-local`. The controller's own
    //                  daemon would give a terminal running as
    //                  `orchestrator-svc` again, which is the bug.
    //   --worktree     the CANDIDATE worktree, by path, so the terminal's cwd
    //                  is the checkout that holds scripts/read-seat-cost.mjs.
    //   --command      that script, plus the end marker (see
    //                  `costReadCommand` below).
    //
    // `terminal create` and not `worker-start`: `worker-start` begins a
    // SUPERVISED AGENT with a model allowance, and this is a shell running one
    // node process -- no model, no tokens, nothing to supervise.
    async workerTerminalCreateImpl({ worktreePath, title, command } = {}) {
      return call([
        'terminal', 'create',
        '--environment', workerEnvironment,
        '--worktree', `path:${worktreePath}`,
        '--title', title,
        '--command', command,
      ]);
    },

    // (11) Reading that terminal back. NOT `--screen`: a screen read is the
    // current frame only, it cannot be paged, and the one JSON line can have
    // scrolled off it. The accumulated stream can be paged, and `--cursor`
    // (the previous read's `nextCursor`) is how the next read returns only
    // what is new -- which matters because a read with NO cursor returns the
    // OLDEST retained window, not the newest (runbook, "Seven findings carried
    // from the cancelled JUL-106", item 6). So: one cursorless read to start
    // at the oldest line, then cursor-advanced reads to the end.
    async terminalReadImpl({ terminal, cursor = null, limit = 2000 } = {}) {
      const args = ['terminal', 'read', '--environment', workerEnvironment, '--terminal', terminal, '--limit', String(limit)];
      if (cursor !== null && cursor !== undefined) args.push('--cursor', String(cursor));
      return call(args);
    },

    // (12) Closing it. `orca terminal close --terminal <handle>` is the verb
    // (`orca terminal close --help`: "Close one terminal, its whole tab, or
    // every terminal in a workspace"; without `--all` it "closes one terminal
    // pane/session"). No `--tab` and no `--worktree ... --all`: this terminal
    // is one pane the controller made for one read, and `--all` would stop
    // every terminal in the candidate worktree -- including the worker's own
    // agent terminal, which Orca closes itself at `worker-release`.
    async terminalCloseImpl({ terminal } = {}) {
      return call(['terminal', 'close', '--environment', workerEnvironment, '--terminal', terminal]);
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
// The cost read -- through Orca, as the WORKER, never off this process's disk
// ---------------------------------------------------------------------------

// WHAT CHANGED AND WHY, in one paragraph, because the obvious "simplification"
// is to put the file read back here and it does not work.
//
// Orca exposes no token or dollar figure at all (`worktree ps`, `worker-show`,
// `terminal list` searched: docs/research/jul109-orca-1.4.205-findings.md
// section 5; and `orchestration worker-read --source transcript` returns the
// messages with NO usage, token or cost field, checked on a real dispatch on
// 2026-09-21). So the figures can only come from the vendor's own session file.
// Those files are readable only BY THE WORKER: Claude Code creates each
// per-project transcript directory mode 0700 owned by `runner`, and as
// `orchestrator-svc` `ls` on it answers "Permission denied" (the measured
// listing is in ./cost-read.mjs's header). Widening that is not available --
// `acl` is not installed on this host and installing it needs root, which is
// not a graph action -- and making transcripts world-readable would widen the
// boundary far past the problem.
//
// So the read happens AS THE WORKER, through Orca: a plain terminal on the
// worker daemon, in the candidate worktree, running
// scripts/read-seat-cost.mjs, which prints one line of JSON. That route is how
// every worker cost figure posted on JUL-98 was obtained by hand before this
// existed.
//
// PUT THE DIRECT FILE READ BACK AND THIS IS WHAT HAPPENS: `readdir` on the
// per-project directory throws EACCES, the reader refuses, the seat gets no
// cost line, `assertCostLineComplete` fails it and the step stops with "no cost
// line for the builder seat" -- the JUL-92 stop of 2026-09-21, which is the
// only thing the controller did for a whole evening.

// Named so a human reading Orca's terminal list can see what it is and that it
// is short-lived.
export const COST_TERMINAL_TITLE_PREFIX = 'julia-cost-';

// THE END MARKER, and why completion is not `terminal wait`. A plain terminal
// is NOT finished when `terminal wait` says so: `--for tui-idle` answers
// `satisfied: true` at once even mid-run (recorded live: satisfied after 2.5 s
// on a terminal still running `sleep 90`), and `--for exit` only ever times out
// because the shell stays open after the command returns (8.4 s then
// `timeout`) -- runbook, "the seven JUL-106 findings re-checked", row 3. The
// documented way is to poll `terminal read` until the shell prompt is back.
// This is that, made machine-readable instead of matched against whatever
// shape the prompt happens to have: the shell prints the marker only once it
// has the command's exit status in `$?`, i.e. only once the prompt is back, and
// it carries that status out with it.
export const COST_READ_END_MARKER = '__JULIA_COST_READ_DONE__';

// Single-quoted for the shell, and a value that could break out of the quoting
// is refused rather than interpolated.
function shellArg(value, what) {
  const text = String(value);
  if (text.includes("'")) throw new Error(`read-seat-cost: refusing to build a shell command with a quote in ${what}: ${text}`);
  return `'${text}'`;
}

export function costReadCommand({ seat, agent, worktreePath }) {
  const script = `node ${shellArg(`${worktreePath}/scripts/read-seat-cost.mjs`, 'the worktree path')}`
    + ` --seat ${shellArg(seat, 'the seat')} --agent ${shellArg(agent, 'the agent')} --worktree ${shellArg(worktreePath, 'the worktree path')}`;
  return `${script}; echo "${COST_READ_END_MARKER}:$?"`;
}

// The marker as the shell printed it, anchored, so the ECHO of the command --
// which also contains the marker text, inside quotes, after the node call --
// can never be mistaken for the answer.
const END_MARKER_LINE = new RegExp(`^${COST_READ_END_MARKER}:(\\d+)$`);

export function costReadExitCode(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = END_MARKER_LINE.exec(String(lines[i]).trim());
    if (match) return Number(match[1]);
  }
  return null;
}

// ONE line of JSON, so the caller never guesses which line is the answer: the
// script prints nothing else on stdout, and everything else in the transcript
// is a prompt, the echoed command or (on failure) stderr. A line that opens
// like JSON and will not parse is a REFUSAL, never a skip -- skipping it would
// walk on to "no line at all", which says the wrong thing about what broke.
export function costLineFromTerminalLines(lines, { seat }) {
  const candidates = lines.map((line) => String(line).trim()).filter((line) => line.startsWith('{'));
  if (candidates.length === 0) {
    throw new Error(`the ${seat} seat's cost read printed no JSON line -- scripts/read-seat-cost.mjs prints exactly one on success, so there is no figure to post and nothing is guessed`);
  }
  const text = candidates[candidates.length - 1];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`the ${seat} seat's cost read printed a line that is not valid JSON (${error.message}): ${text.slice(0, 200)}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`the ${seat} seat's cost read printed JSON that is not a cost line: ${text.slice(0, 200)}`);
  }
  return parsed;
}

// One seat's figures, read while the worker's session files still exist --
// which is why graph/controller/release.mjs reads BEFORE it releases.
//
// EVERY FAILURE IS A REFUSAL. No marker inside the timeout, a non-zero exit, no
// JSON line, an unparseable one: each throws, finishWorker() in ./release.mjs
// leaves the worker and its worktree in place, and the step stops saying which
// seat and why. Nothing here can produce a blank or guessed figure.
//
// AND THE TERMINAL IS ALWAYS CLOSED. The close is in a `finally`, so a refusal
// does not leak a terminal on the worker daemon -- one per failed cost read,
// for ever, is exactly the leak this had to avoid.
export function createOrcaSeatCostReader({
  boundaries,
  timeoutMs = 120000,
  pollMs = 1000,
  readLimit = 2000,
  sleepImpl = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  now = () => Date.now(),
  warn = console.error,
} = {}) {
  return async function readSeatCost({ seat, worktree, agent }) {
    // A DeepSeek seat never reaches here: graph/controller/dispatch.mjs refuses
    // to start one with a new worktree at all (JUL-109 section 4). Refused
    // before a terminal is made, so an unknown vendor costs nothing.
    if (agent !== 'claude' && agent !== 'codex') {
      throw new Error(`no cost source is known for a ${JSON.stringify(agent)} seat (${seat}) -- refusing to guess a figure`);
    }
    const worktreePath = worktreePathOf(worktree);
    const created = await boundaries.workerTerminalCreateImpl({
      worktreePath,
      title: `${COST_TERMINAL_TITLE_PREFIX}${seat}`,
      command: costReadCommand({ seat, agent, worktreePath }),
    });
    const terminal = created?.terminal?.handle ?? null;
    if (!terminal) {
      throw new Error(`the ${seat} seat's cost read could not start: orca terminal create on the worker daemon answered no terminal handle (${JSON.stringify(created ?? null).slice(0, 200)})`);
    }
    // A create Orca could not make visible still gives a working handle and
    // says so in `warning` (recorded: terminal-create.plain-diagnostic.json).
    // A note, not a failure -- nothing is ever typed into this terminal.
    if (created.terminal.warning) warn(`[controller] ${created.terminal.warning}`);

    try {
      const lines = [];
      let cursor = null;
      let exitCode = null;
      const deadline = now() + timeoutMs;
      for (;;) {
        const answer = await boundaries.terminalReadImpl({ terminal, cursor, limit: readLimit });
        const read = answer?.terminal ?? {};
        for (const line of read.tail ?? []) lines.push(String(line));
        if (read.nextCursor !== null && read.nextCursor !== undefined) cursor = read.nextCursor;
        exitCode = costReadExitCode(lines);
        if (exitCode !== null) break;
        if (now() >= deadline) {
          throw new Error(`the ${seat} seat's cost read did not finish within ${timeoutMs} ms -- no "${COST_READ_END_MARKER}" line came back from the worker terminal, so the figures were not read and nothing is guessed`);
        }
        await sleepImpl(pollMs);
      }
      if (exitCode !== 0) {
        const tail = lines.filter((line) => !END_MARKER_LINE.test(line.trim())).slice(-5).join(' | ');
        throw new Error(`the ${seat} seat's cost read failed on the worker: scripts/read-seat-cost.mjs exited ${exitCode} -- ${tail || 'it printed nothing'}`);
      }
      return costLineFromTerminalLines(lines, { seat });
    } finally {
      // Even on the failure path. A close that itself fails is said out loud
      // and does not replace the real reason the read failed.
      try {
        await boundaries.terminalCloseImpl({ terminal });
      } catch (error) {
        warn(`[controller] could not close the ${seat} seat's cost terminal ${terminal}: ${error.message}`);
      }
    }
  };
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
