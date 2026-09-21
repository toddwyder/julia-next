// main.mjs -- JUL-98 step 4, Task B: the program the systemd unit runs.
//
// WHAT THIS IS, AND WHAT IT IS NOT. It is a plain long-running Node program.
// It has NO model allowance of its own: it is not an agent, it calls no model,
// and the only thing it does that costs anything is START WORKERS, which do.
// Everything it decides is decided by the pieces built in steps 2 and 3
// (./core.mjs, ./step-runner.mjs and the files they use); everything it
// touches for real is ./wiring.mjs. This file is the ORDER and the LOOP, and
// deliberately holds no rule of its own.
//
// TWO MODES, and the second one is a safety feature rather than a convenience:
//
//   --once   run exactly one full check and exit. This is how the switch-on is
//            proven by hand, as `orchestrator-svc`, BEFORE the unit is enabled.
//            A controller that has never been run once by hand should not be
//            put behind `Restart=always`.
//   --loop   what the unit runs: one full check every interval, for ever.
//
// EVERY START SAYS WHICH BUILD IT IS (./crash-loop.mjs). The unit carries
// `StartLimitIntervalSec=0`, so systemd will never stop a bad build; the
// banner and the card comment are what make that visible instead.
//
// IT NEVER WRITES INTO ITS OWN CHECKOUT. /srv/orchestrator-svc/julia-next is
// root-owned and read-only to the account that runs it. State goes under
// $XDG_STATE_HOME (./state.mjs), and the in-flight record lives in the Orca
// run, where it already lived.

import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { runControllerCheck, READY_COLUMN } from './core.mjs';
import { createControllerBoard } from './board.mjs';
import { runBuildAndReview } from './step-runner.mjs';
import { createSuiteRunner } from './test-run.mjs';
import { testRunLine } from './test-run.mjs';
import { createAxiomMirror } from './mailbox.mjs';
import { nextColumnFor, CONTROLLER_LAST_COLUMN } from './columns.mjs';
import { stepReportComment } from './card-steps.mjs';
import { launchForChoice } from './dispatch.mjs';
import { seatChoicesForIssue } from '../../scripts/seat-labels.mjs';
import {
  createOrcaBoundaries,
  createRequestLedger,
  createSeatCostReader,
  createPublisher,
  worktreePathOf,
  ORCHESTRATOR_CHECKOUT,
  ORCHESTRATOR_ENVIRONMENT,
} from './wiring.mjs';
import {
  readControllerState, writeControllerState, defaultStatePath,
} from './state.mjs';
import {
  buildBanner, recordStart, detectCrashLoop, shouldReportCrashLoop, markCrashLoopReported, crashLoopComment,
} from './crash-loop.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_INTERVAL_SECONDS = 60;

export const USAGE = `usage: node graph/controller/main.mjs (--once | --loop) [--interval-seconds N]

The Julia controller. Reads the board as the controller's own Linear identity,
admits ONE Ready card at a time, and carries it across the columns with a fresh
builder and a fresh reviewer per step.

  --once                run exactly one full check and exit (prove it by hand)
  --loop                one full check every interval, for ever (what systemd runs)
  --interval-seconds N  seconds between checks in --loop (default ${DEFAULT_INTERVAL_SECONDS})

It must run as orchestrator-svc: the Linear app credentials it needs are
readable by that account only, by design.
`;

export function parseArgs(argv) {
  const parsed = { once: false, loop: false, help: false, intervalSeconds: DEFAULT_INTERVAL_SECONDS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') parsed.once = true;
    else if (arg === '--loop') parsed.loop = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--interval-seconds') parsed.intervalSeconds = Number(argv[++i]);
    else if (arg.startsWith('--interval-seconds=')) parsed.intervalSeconds = Number(arg.slice('--interval-seconds='.length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (parsed.once && parsed.loop) throw new Error('--once and --loop are exclusive: pick the one-shot or the loop');
  if (!parsed.help && !parsed.once && !parsed.loop) throw new Error('one of --once or --loop is required');
  if (!Number.isFinite(parsed.intervalSeconds) || parsed.intervalSeconds <= 0) {
    throw new Error(`--interval-seconds must be a positive number of seconds, got ${JSON.stringify(parsed.intervalSeconds)}`);
  }
  return parsed;
}

// Which build is running. The checkout is read-only but readable, so git
// answers it; `JULIA_CONTROLLER_BUILD` wins when something already knows (a
// deploy, or a test). Never throws: a controller that cannot name its build
// still starts, and still says so -- "unknown build" in the journal is far
// better than no line at all.
export async function resolveBuild({
  env = process.env,
  checkout = ORCHESTRATOR_CHECKOUT,
  execImpl = execFileAsync,
} = {}) {
  if (env.JULIA_CONTROLLER_BUILD) return env.JULIA_CONTROLLER_BUILD;
  try {
    const { stdout } = await execImpl('git', ['-C', checkout, 'rev-parse', '--short', 'HEAD']);
    return String(stdout).trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Carrying one admitted card
// ---------------------------------------------------------------------------

// The step plan for a card. One step for now, made of the card itself: the
// multi-step plan written into the card's description, and resuming a step
// after a crash, are JUL-99 (./card-steps.mjs already renders the block).
export function stepsForCard(card) {
  return [{
    key: 'work',
    title: card.title,
    brief: card.description ?? '',
    criteria: card.criteria ?? [],
  }];
}

// The builder, the reviewer, one test run, the cost lines, then publish, then
// the columns. Every boundary below is ./wiring.mjs's; the ORDER is
// ./step-runner.mjs's and is not repeated here.
export async function carryCard({
  card,
  runId,
  from,
  boundaries,
  board,
  publisher,
  readSeatCost,
  suiteRunner = createSuiteRunner(),
  mirrorImpl,
  now = () => new Date().toISOString(),
  seatChoicesImpl = seatChoicesForIssue,
  runBuildAndReviewImpl = runBuildAndReview,
  comments,
}) {
  const choices = seatChoicesImpl(card);
  // Which vendor each seat is, so the cost reader knows which session file
  // shape to read. It comes from the same function that builds the
  // `worker-start` argv, so the seat cannot be launched as one vendor and
  // costed as another.
  const agentForSeat = Object.fromEntries(
    Object.entries(choices).map(([seat, choice]) => [seat, launchForChoice(choice).agent ?? null]),
  );

  const [step] = stepsForCard(card);
  const outcome = await runBuildAndReviewImpl({
    card,
    step,
    choices,
    files: [],
    environment: ORCHESTRATOR_ENVIRONMENT,
    runId,
    from,
    suiteRunner,
    mirrorImpl,
    workerStartImpl: boundaries.workerStartImpl,
    observeStartImpl: boundaries.observeStartImpl,
    checkWaitImpl: boundaries.checkWaitImpl,
    releaseImpl: boundaries.releaseImpl,
    removeWorktreeImpl: boundaries.removeWorktreeImpl,
    readCostImpl: ({ seat, dispatchId, worktree }) => readSeatCost({ seat, dispatchId, worktree, agent: agentForSeat[seat] }),
  });

  const testRun = outcome.testRun;
  if (!outcome.ok) {
    // The card stays where it is. It is TOLD why, once, with whatever figures
    // were read -- a step that failed still spent money, and the card is where
    // that is recorded.
    await comments.postOnce({
      issueId: card.id,
      key: `step-failed:${step.key}:${outcome.reason}`,
      body: [
        `**${card.identifier}: the ${step.title} step did not pass.** ${outcome.reason}`,
        ...(testRun ? ['', testRunLine(testRun)] : []),
        ...(outcome.costText.length ? ['', '**Cost, per worker:**', ...outcome.costText] : []),
      ].join('\n'),
    });
    return { ok: false, stage: 'build-and-review', reason: outcome.reason, outcome };
  }

  // Publishing: the App, through scripts/publish-pr.mjs and merge-pr.mjs.
  const worktreePath = worktreePathOf(outcome.builder.worktree);
  const branch = await currentBranch(worktreePath);
  const published = await publisher.publishAndMerge({
    branch,
    worktreePath,
    title: `${card.identifier}: ${step.title}`,
    body: `${card.url ?? card.identifier}\n\nCarried by the Julia controller.`,
  });
  if (!published.ok) {
    await comments.postOnce({
      issueId: card.id,
      key: `publish-failed:${branch}`,
      body: `**${card.identifier}: the work passed but publishing did not.** ${published.reason}`,
    });
    return { ok: false, stage: 'publish', reason: published.reason, outcome, published };
  }

  // The columns, one comment per move, the report on the first of them.
  const moves = [];
  let column = 'Implementation';
  let first = true;
  for (let guard = 0; guard < 9; guard += 1) {
    if (column === CONTROLLER_LAST_COLUMN) break;
    const move = nextColumnFor(column, { hasReviewableOutput: card.hasReviewableOutput !== false });
    if (!move.ok) break;
    const at = now();
    const body = first
      ? stepReportComment({
        card, step, from: column, move, at,
        testRunLine: testRun ? testRunLine(testRun) : null,
        costText: outcome.costText,
        extra: `Merged as ${published.merged.sha} (${published.pr.url}).`,
      })
      : stepReportComment({
        card, step, from: column, move, at, testRunLine: null, costText: outcome.costText,
      });
    await comments.postOnce({ issueId: card.id, key: `move:${column}->${move.to}`, body });
    await board.moveCard({ issueId: card.id, to: move.to });
    moves.push({ from: column, to: move.to });
    column = move.to;
    first = false;
  }

  return { ok: true, stage: 'carried', outcome, published, moves, column };
}

async function currentBranch(worktreePath, { execImpl = execFileAsync } = {}) {
  const { stdout } = await execImpl('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD']);
  return String(stdout).trim();
}

// ---------------------------------------------------------------------------
// One full check
// ---------------------------------------------------------------------------

export async function runOnce({
  state,
  board,
  boundaries,
  from,
  publisher,
  readSeatCost,
  mirrorImpl,
  log = console.log,
  carryCardImpl = carryCard,
  runControllerCheckImpl = runControllerCheck,
  now = () => new Date().toISOString(),
} = {}) {
  const commentsSeen = new Map();
  const check = await runControllerCheckImpl({
    board,
    runCreateImpl: boundaries.runCreateImpl,
    activeRunImpl: boundaries.activeRunImpl,
    environment: ORCHESTRATOR_ENVIRONMENT,
    from,
    previousReady: state.ready,
    previousCommented: state.commented,
    commentsSeen,
    now,
  });

  let nextState = {
    ...state,
    ready: check.nextReady ?? state.ready,
    commented: check.nextCommented ?? state.commented,
  };

  if (check.status !== 'started') {
    log(`[controller] ${check.status}${check.issue ? ` (${check.issue})` : ''}`);
    return { check, state: nextState, carried: null };
  }

  const card = (await board.listReadyCards()).find((issue) => issue.identifier === check.issue)
    ?? { id: null, identifier: check.issue, title: check.issue };
  // Recorded BEFORE the work starts: if the controller dies carrying this card,
  // the crash-loop comment has to know where to go.
  nextState = { ...nextState, carrying: { identifier: card.identifier, id: card.id, at: now() } };

  const comments = {
    async postOnce({ issueId, key, body }) {
      const seen = `${issueId}::${key}`;
      if (commentsSeen.has(seen)) return { posted: false, replayed: true };
      const comment = await board.comment({ issueId, body });
      commentsSeen.set(seen, comment);
      return { posted: true, replayed: false, comment };
    },
  };

  const carried = await carryCardImpl({
    card, runId: check.runId, from, boundaries, board, publisher, readSeatCost, comments, now,
    // Every mailbox message this card's workers send is mirrored to Axiom on
    // the way through, via the relay that already exists -- no new event
    // vocabulary and no relay change (./mailbox.mjs's createAxiomMirror).
    mirrorImpl: mirrorImpl ?? createAxiomMirror({ runId: check.runId }),
  });
  log(`[controller] ${card.identifier}: ${carried.ok ? `carried to ${carried.column}` : `stopped at ${carried.stage} -- ${carried.reason}`}`);
  return { check, state: { ...nextState, carrying: null }, carried };
}

// ---------------------------------------------------------------------------
// Startup, and the loop
// ---------------------------------------------------------------------------

// The banner, the crash-loop check, and the ONE comment a loop earns. Returns
// the state to carry into the first cycle.
export async function startup({
  state,
  build,
  pid = process.pid,
  mode,
  at,
  checkout = ORCHESTRATOR_CHECKOUT,
  nodeVersion = process.version,
  log = console.log,
  warn = console.error,
  commentImpl = null,
} = {}) {
  log(buildBanner({ build, pid, startedAt: at, checkout, nodeVersion, mode }));
  let next = recordStart(state, { at, build, pid });
  const detection = detectCrashLoop(next, { at });
  if (!detection.looping) return { state: next, detection, commented: false };

  const line = `[controller] CRASH LOOP: ${detection.starts} starts since ${detection.since} on build ${build || 'unknown build'} -- systemd will not stop this (StartLimitIntervalSec=0)`;
  // Always on stderr, every looping start, whether or not a card gets told:
  // the journal is the one place this can never be missed.
  warn(line);
  if (!shouldReportCrashLoop(next, detection) || !next.carrying || !commentImpl) {
    return { state: next, detection, commented: false };
  }
  try {
    await commentImpl({
      issueId: next.carrying.id,
      body: crashLoopComment({
        identifier: next.carrying.identifier,
        build,
        starts: detection.starts,
        windowMs: detection.windowMs,
        since: detection.since,
        lastError: next.lastError ?? null,
      }),
    });
    next = markCrashLoopReported(next, { at, build, since: detection.since });
    return { state: next, detection, commented: true };
  } catch (error) {
    // A board that cannot be written to must not turn a crash loop into a
    // second, quieter failure. The journal line above already stands.
    warn(`[controller] could not comment the crash loop on ${next.carrying.identifier}: ${error.message}`);
    return { state: next, detection, commented: false };
  }
}

export async function runLoop({
  intervalSeconds = DEFAULT_INTERVAL_SECONDS,
  cycles = Infinity,
  sleepImpl = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  runOnceImpl,
  warn = console.error,
  ...shared
} = {}) {
  let state = shared.state;
  let done = 0;
  while (done < cycles) {
    try {
      const result = await runOnceImpl({ ...shared, state });
      state = result.state;
      shared.saveState?.(state);
    } catch (error) {
      // ONE cycle that threw is not a reason to exit: exiting is what makes
      // systemd restart, and a restart loop is the thing this build is trying
      // hard not to be. The error is said out loud and the next cycle runs.
      warn(`[controller] cycle failed: ${error.message}`);
      state = { ...state, lastError: error.message };
      shared.saveState?.(state);
    }
    done += 1;
    if (done < cycles) await sleepImpl(intervalSeconds * 1000);
  }
  return state;
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  log = console.log,
  warn = console.error,
  statePath = null,
  now = () => new Date().toISOString(),
  setExitCode = (code) => { process.exitCode = code; },
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    warn(error.message);
    warn(USAGE);
    setExitCode(2);
    return null;
  }
  if (options.help) {
    log(USAGE);
    return null;
  }

  const path = statePath ?? defaultStatePath({ env });
  let state = readControllerState({ statePath: path });
  const build = await resolveBuild({ env });
  const ledger = createRequestLedger(state.requests ?? {});
  const boundaries = createOrcaBoundaries({ ledger });
  const board = createControllerBoard();
  const publisher = createPublisher({ env });
  const readSeatCost = createSeatCostReader({ homedir: os.homedir() });
  const from = env.JULIA_CONTROLLER_TERMINAL ?? null;

  const saveState = (next) => {
    writeControllerState({ ...next, requests: ledger.entries() }, { statePath: path });
  };

  const started = await startup({
    state,
    build,
    mode: options.once ? 'once' : 'loop',
    at: now(),
    log,
    warn,
    commentImpl: ({ issueId, body }) => board.comment({ issueId, body }),
  });
  state = started.state;
  // SAVED HERE, before any preflight can exit. A build that dies in its own
  // startup -- a missing terminal handle, a bad checkout, a module that will
  // not import -- is precisely the build that crash-loops, and a start that was
  // never written down is a start the next process cannot count. Recording only
  // after the preflights would have made the crash-loop detector blind to every
  // crash loop that starts before the first cycle.
  saveState(state);

  const missing = publisher.missingCredentials();
  if (missing) {
    // Said once, at startup, rather than discovered at the end of a step that
    // has already cost two workers.
    warn(`[controller] publishing is not configured: ${missing.join(' and ')} are not set (EnvironmentFile=-/etc/orchestrator-svc/.env.publisher). Cards will build and review but cannot be published.`);
  }
  if (!from) {
    warn('[controller] JULIA_CONTROLLER_TERMINAL is not set -- Orca refuses a run-create with no sender terminal (run-create.no-sender-terminal.error.json)');
    setExitCode(1);
    return null;
  }

  const shared = {
    state, board, boundaries, from, publisher, readSeatCost,
    mirrorImpl: null, log, saveState, now,
  };
  const final = await runLoop({
    ...shared,
    intervalSeconds: options.intervalSeconds,
    cycles: options.once ? 1 : Infinity,
    runOnceImpl: runOnce,
    warn,
  });
  saveState(final);
  return final;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[controller] ${error.message}`);
    process.exitCode = 1;
  });
}
