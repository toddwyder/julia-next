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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { runControllerCheck, READY_COLUMN } from './core.mjs';
import { createControllerBoard } from './board.mjs';
import { runBuildAndReview, attemptTag } from './step-runner.mjs';
import { createSuiteRunner, readWorktreeState, testRunLine, testRunJournalLine } from './test-run.mjs';
import { nextColumnFor, CONTROLLER_LAST_COLUMN } from './columns.mjs';
import { stepReportComment } from './card-steps.mjs';
import { launchFor } from './seat-run.mjs';
import { seatChoicesForIssue } from '../../scripts/seat-labels.mjs';
import {
  createOrcaBoundaries,
  createRequestLedger,
  createPublisher,
  resolveSenderTerminal,
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
//
// AND IT TOO CROSSES AN OWNERSHIP BOUNDARY, which is why it carries the same
// `-c safe.directory=` every other git call in this controller does. The
// controller runs as `orchestrator-svc`; /srv/orchestrator-svc/julia-next is
// root-owned (`ls -ld`: `dr-xr-x--- root orchestrator-svc`), and git's
// dubious-ownership guard is about the owning UID, not about permissions. The
// flag is scoped to exactly this one path and is never read from repo-local
// config, the same way `currentBranch` and `headShaOf` do it. What it costs
// when it is missing is quiet rather than fatal -- the catch below turns the
// refusal into `null` and every banner, journal line and crash-loop comment
// then says "unknown build", which is the one thing that names which code is
// looping. NOT VERIFIED FROM A BUILDER WORKTREE: a worker runs as `runner`,
// which cannot enter that directory at all (`git -C
// /srv/orchestrator-svc/julia-next rev-parse` as `runner`, 2026-09-21:
// "fatal: cannot change to ...: Permission denied"), so whether git refuses it
// for `orchestrator-svc` today depends on that account's global git config and
// only the controller's own account can settle it.
export async function resolveBuild({
  env = process.env,
  checkout = ORCHESTRATOR_CHECKOUT,
  execImpl = execFileAsync,
} = {}) {
  if (env.JULIA_CONTROLLER_BUILD) return env.JULIA_CONTROLLER_BUILD;
  try {
    const { stdout } = await execImpl('git', ['-c', `safe.directory=${checkout}`, '-C', checkout, 'rev-parse', '--short', 'HEAD']);
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

// The working copy a card is built in is branched from here.
export const BASE_BRANCH = 'origin/main';

// The one progress comment a carry keeps on the card, edited in place as the
// workers report (Todd, 23 Sep: "no black box").
export function progressCommentBody({ card, seat, round, status, count, at }) {
  const what = `${status.subject}${status.phase ? ` (${status.phase})` : ''}`;
  return [
    `**${card.identifier}: now working -- the ${seat}, round ${round}: ${what}.**`,
    '',
    `As of ${at}, from the worker's own progress file (${count} ${count === 1 ? 'report' : 'reports'} so far this run). The controller edits this comment as the worker reports; a worker whose progress file stops changing for five minutes is stopped as stuck.`,
  ].join('\n');
}

// The progress comment's final edit, once the step has ended either way.
export function finishedCommentBody({ card, outcome, at }) {
  const what = outcome.ok
    ? 'the step passed review and tests; publishing follows below'
    : `the step ${outcome.parked ? 'parked after two review rounds' : 'did not pass'} -- the reason is in the comment below`;
  return `**${card.identifier}: finished working -- ${what}.**\n\nAs of ${at}. This comment followed the workers' own progress files while they ran.`;
}

export function roundsSummary(rounds = []) {
  return rounds.map((r) => {
    const parts = [`round ${r.round}:`];
    if (r.candidate) parts.push(`built \`${r.candidate.slice(0, 7)}\``);
    if (r.testRun) parts.push(`tests ${r.testRun.pass} pass / ${r.testRun.fail} fail`);
    if (r.verdict) parts.push(`review ${r.verdict === 'approve' ? 'APPROVE' : 'CHANGES NEEDED'}`);
    return `- ${parts.join(' -- ')}`;
  });
}

// One card, carried: its own working copy, the build-and-review rounds, then
// publish, then the columns. JUL-98 step 8 rewrote this: each seat is one
// command (./seat-run.mjs), and the working copy belongs to THIS function --
// it is removed only after publishing, which is the fix for the send-back
// crash (the old route removed it first, then tried to publish from it).
export async function carryCard({
  card,
  attempt = 1,
  boundaries,
  board,
  publisher,
  suiteRunner = createSuiteRunner(),
  now = () => new Date().toISOString(),
  seatChoicesImpl = seatChoicesForIssue,
  runBuildAndReviewImpl = runBuildAndReview,
  currentBranchImpl = currentBranch,
  readWorktreeStateImpl = readWorktreeState,
  comments,
  log = () => {},
  // The stand-in harness only (scripts/controller-stand-in.mjs): run both seats
  // as the free stand-in, with its own limits. Never set from a card.
  standIn = false,
  timeLimits = {},
  seatOptions = {},
}) {
  const choices = seatChoicesImpl(card);
  const launches = {
    builder: launchFor('builder', choices.builder, { standIn }),
    reviewer: launchFor('reviewer', choices.reviewer, { standIn }),
  };
  const refused = Object.values(launches).find((launch) => !launch.ok);
  if (refused) {
    await comments.postOnce({ issueId: card.id, key: `seat-refused:${refused.reason}`, body: `**${card.identifier}: not started.** ${refused.reason}` });
    return { ok: false, stage: 'seat', reason: refused.reason };
  }

  const [step] = stepsForCard(card);
  const name = `${card.identifier.toLowerCase()}-work-${attemptTag(attempt)}`;
  const created = await boundaries.worktreeCreateImpl({ name, baseBranch: BASE_BRANCH });
  const worktreeId = created?.worktree?.id ?? null;
  const worktreePath = created?.worktree?.path ?? null;
  if (!worktreeId || !worktreePath) {
    throw new Error(`orca worktree create answered no worktree id or path for ${name} (${JSON.stringify(created ?? null).slice(0, 200)})`);
  }

  try {
    // Read NOW, while the working copy certainly exists.
    const branch = await currentBranchImpl(worktreePath);
    const start = await readWorktreeStateImpl({ worktree: worktreePath });
    if (!start.known) throw new Error(`the new working copy ${worktreePath} could not be read: ${start.reason}`);
    log(`[controller] ${card.identifier}: working copy ${worktreePath} on ${branch} from ${BASE_BRANCH} at ${start.shortCommit}`);

    let progressCommentId = null;
    const onProgress = async ({ seat, round, status, count }) => {
      const body = progressCommentBody({ card, seat, round, status, count, at: now() });
      log(`[controller] ${card.identifier}: ${seat} round ${round}: ${status.subject}${status.phase ? ` (${status.phase})` : ''}`);
      if (progressCommentId && board.updateComment) {
        await board.updateComment({ commentId: progressCommentId, body });
      } else {
        const posted = await board.comment({ issueId: card.id, body });
        progressCommentId = posted?.id ?? null;
      }
    };

    let outcome;
    try {
      outcome = await runBuildAndReviewImpl({
        card, step, launches, worktreePath, branch, baseCommit: start.commit, suiteRunner, boundaries,
        timeLimits, seatOptions, onProgress,
      });
    } catch (error) {
      // The controller's OWN fault mid-step (PR #102 review, finding 5): the
      // card is still told, below, rather than left with nothing but a journal
      // line.
      outcome = { ok: false, reason: `the controller itself failed mid-step: ${error.message}`, rounds: [], costLines: [], costText: [], testRun: null };
    }
    // The progress comment's last state, so it never says "now working" about
    // a step that has ended (PR #102 review, finding 6).
    if (progressCommentId && board.updateComment) {
      try {
        await board.updateComment({ commentId: progressCommentId, body: finishedCommentBody({ card, outcome, at: now() }) });
      } catch (error) {
        log(`[controller] ${card.identifier}: could not mark the progress comment finished: ${error.message}`);
      }
    }
    const testRun = outcome.testRun;
    if (testRun) log(`[controller] ${card.identifier}: ${testRunJournalLine(testRun)}`);

    if (!outcome.ok) {
      const headline = outcome.parked
        ? `**${card.identifier}: parked after two review rounds.** ${outcome.reason}`
        : `**${card.identifier}: the ${step.title} step did not pass.** ${outcome.reason}`;
      await comments.postOnce({
        issueId: card.id,
        key: `step-failed:${step.key}:${outcome.reason}`,
        body: [
          headline,
          ...(outcome.rounds?.length ? ['', ...roundsSummary(outcome.rounds)] : []),
          ...(testRun ? ['', testRunLine(testRun)] : []),
          ...(outcome.costText.length ? ['', '**Cost, per worker:**', ...outcome.costText] : []),
          '',
          `The work so far is on branch \`${branch}\`.`,
        ].join('\n'),
      });
      return { ok: false, stage: 'build-and-review', reason: outcome.reason, outcome, branch };
    }

    // Publishing: the App, from the working copy this function still holds.
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
      return { ok: false, stage: 'publish', reason: published.reason, outcome, published, branch };
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
          extra: [`Merged as ${published.merged.sha} (${published.pr.url}).`, '', ...roundsSummary(outcome.rounds)].join('\n'),
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
    return { ok: true, stage: 'carried', outcome, published, moves, column, branch };
  } finally {
    try {
      await boundaries.removeWorktreeImpl({ worktree: worktreeId });
    } catch (error) {
      log(`[controller] ${card.identifier}: could not remove the working copy ${worktreePath}: ${error.message}`);
    }
  }
}

// The branch the builder committed on, read out of the candidate worktree so
// the publisher pushes the branch that exists rather than a name guessed from
// the card.
//
// `-c safe.directory=<worktreePath>`, for the reason `headShaOf` in
// ./wiring.mjs states at length: the controller is `orchestrator-svc` and the
// candidate worktree is owned by `runner`, and git's dubious-ownership guard
// refuses the directory outright on the UID mismatch alone. Scoped to exactly
// the path the caller passed, the same way scripts/publish-pr.mjs and
// scripts/verify-reviewer-worktree.mjs do it. Without it the branch cannot be
// read and a passing step never reaches the publish it earned.
export async function currentBranch(worktreePath, { execImpl = execFileAsync } = {}) {
  const { stdout } = await execImpl('git', ['-c', `safe.directory=${worktreePath}`, '-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD']);
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
  log = console.log,
  carryCardImpl = carryCard,
  runControllerCheckImpl = runControllerCheck,
  // The same saver runLoop uses. A no-op default keeps runOnce callable on its
  // own, but the loop always passes the real one.
  saveState = () => {},
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

  // The card comes back WITH the check. It must not be looked up again: the
  // check has already moved it out of Ready, so a second lookup can only miss.
  // A check that says "started" and hands back no usable card is a bug in the
  // check, and it says so out loud rather than carrying a null id in silence --
  // runLoop catches this, records it as lastError, and the next cycle runs.
  const card = check.card;
  if (!card?.id) {
    throw new Error(
      `controller: the check admitted ${check.issue} but handed back no card id, so it cannot be carried (every Linear write for it would fail and a crash loop would have nowhere to comment)`,
    );
  }
  // Recorded BEFORE the work starts, and written to DISK before it: if the
  // controller dies carrying this card, the crash-loop comment has to know
  // where to go, and it reads that from the state file, not from this process.
  //
  // THE ATTEMPT NUMBER is recorded in the same write, and for the same reason:
  // it has to survive the process. It counts attempts on THIS card, it only
  // goes forwards, and it is what keeps a second attempt from asking Orca for
  // the worktree name a stopped attempt still holds and from replaying the
  // stopped attempt's `worker-start` through the request ledger
  // (`attemptTag` in ./step-runner.mjs states both). Incremented BEFORE the
  // work, not after: an attempt that dies mid-flight has still been made, and
  // the next one must not reuse its names.
  const previousAttempts = Number.isInteger(state.attempts?.[card.identifier]) ? state.attempts[card.identifier] : 0;
  const attempt = previousAttempts + 1;
  nextState = {
    ...nextState,
    attempts: { ...(nextState.attempts ?? {}), [card.identifier]: attempt },
    carrying: { identifier: card.identifier, id: card.id, at: now() },
  };
  saveState(nextState);

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
    card, attempt, boundaries, board, publisher, comments, now, log,
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
  // Injected so the tests never spawn the real `orca` binary, and so a test
  // can stand exactly where the first cycle starts. The defaults are the real
  // resolver over the real boundaries, and the real cycle.
  resolveSenderTerminalImpl = resolveSenderTerminal,
  runOnceImpl = runOnce,
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
  // THE SENDER TERMINAL. `run-create` and `worker-start` carry the handle as
  // `--from`, and `run-create` is refused outright without one
  // (run-create.no-sender-terminal.error.json); the mailbox wait carries the
  // same handle as `--terminal`. The controller finds or makes
  // its own (wiring.mjs's resolveSenderTerminal): an operator's
  // $JULIA_CONTROLLER_TERMINAL if Orca still knows it, else the handle this
  // controller recorded on a previous start if Orca still knows THAT, else a
  // fresh `terminal create`. Nothing has to supply a handle -- and a handle
  // could not be supplied durably anyway, since one does not survive an Orca
  // restart.
  let from;
  try {
    const resolved = await resolveSenderTerminalImpl({ env, state, boundaries, warn });
    from = resolved.terminal;
    if (resolved.created) {
      // Written to disk IMMEDIATELY, before a single cycle runs: a handle held
      // only in memory is a handle the next restart cannot see, and under
      // RestartSec=5 that is one leaked terminal every five seconds.
      state = resolved.state;
      saveState(state);
      log(`[controller] created its own Orca sender terminal ${from} (${ORCHESTRATOR_ENVIRONMENT}, ${ORCHESTRATOR_CHECKOUT})`);
    } else {
      log(`[controller] sending from the ${resolved.source} Orca terminal ${from}`);
    }
  } catch (error) {
    // Losing the ability to SAY WHY is worse than not starting, so this stays
    // as loud as the refusal it replaces, and still exits non-zero.
    warn(`[controller] no Orca sender terminal: ${error.message} -- Orca refuses a run-create with no sender terminal (run-create.no-sender-terminal.error.json). Set JULIA_CONTROLLER_TERMINAL to a live handle to override, or fix the Orca daemon so the controller can create its own.`);
    setExitCode(1);
    return null;
  }

  const shared = {
    state, board, boundaries, from, publisher, log, saveState, now,
  };
  const final = await runLoop({
    ...shared,
    intervalSeconds: options.intervalSeconds,
    cycles: options.once ? 1 : Infinity,
    runOnceImpl,
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
