// step-runner.mjs -- JUL-98 step 3: how the controller actually uses a worker,
// start to finish, in ONE order.
//
// The pieces each have their own file and their own tests. This is the order
// they happen in, which is itself a rule:
//
//   1. dispatch a FRESH worker (./dispatch.mjs)
//   2. prove its turn really started (./turn-start.mjs) -- and if it did not,
//      stop HERE. The mailbox is not opened at all: a prompt typed into a
//      login or folder-trust screen is caught in seconds instead of being
//      waited on for eight hours, which is what happened on 19-20 September.
//   3. sleep on the mailbox until that worker's own worker_done arrives
//      (./mailbox.mjs), mirroring every message to Axiom on the way
//   4. run the test suite ONCE, as the controller, in the candidate worktree
//      (./test-run.mjs) -- the same result object goes to both seats
//   5. READ THE COST, then release the worker, then remove its worktree
//      (./release.mjs). Never any other way round.
//
// Every boundary is injected. Nothing here calls Orca, Linear, Axiom or git;
// step 4 is what wires the real implementations and switches it on.

import { dispatchWorker } from './dispatch.mjs';
import { proveTurnStarted } from './turn-start.mjs';
import { waitForWorkerDone } from './mailbox.mjs';
import { finishWorker, assertEverySeatCosted } from './release.mjs';
import { formatCostLine } from './cost.mjs';

// One seat, one step.
export async function runWorkerStep({
  seat,
  card,
  step,
  choice,
  files = [],
  environment,
  runId,
  from,
  repo,
  worktreeName,
  requestId,

  workerStartImpl,
  // Returns whatever the controller has observed about the start: a
  // `terminal send --wait-submit` answer, a `worktree ps` worktree, or both.
  // It is the only thing allowed to look at the worker before it reports.
  observeStartImpl,
  checkWaitImpl,
  suiteRunner,
  suiteKey,
  readCostImpl,
  releaseImpl,
  removeWorktreeImpl,
  mirrorImpl = null,
  runSuite = true,
  waitOptions = {},
} = {}) {
  // 1. A fresh worker.
  const dispatched = await dispatchWorker({
    workerStartImpl, environment, runId, from, repo,
    seat, card, step, choice, files, worktreeName, requestId,
  });
  if (!dispatched.ok) {
    return { ok: false, seat, stage: 'dispatch', reason: dispatched.reason, dispatchId: dispatched.dispatchId ?? null, residualResources: dispatched.residualResources ?? [] };
  }

  // A closure so every exit below cleans up the same way, in the same order.
  async function close(partial) {
    const finished = await finishWorker({
      seat,
      dispatchId: dispatched.dispatchId,
      worktree: dispatched.worktree,
      readCostImpl,
      releaseImpl,
      removeWorktreeImpl,
    });
    return {
      ...partial,
      seat,
      dispatchId: dispatched.dispatchId,
      taskId: dispatched.taskId,
      terminal: dispatched.terminal,
      worktree: dispatched.worktree,
      cost: finished.cost,
      released: finished.released,
      worktreeRemoved: finished.worktreeRemoved,
      // A step is only ok if the work succeeded AND its figures were read.
      ok: Boolean(partial.ok) && finished.ok,
      reason: partial.reason ?? finished.reason,
    };
  }

  // 2. Proof the turn started. Nothing is waited on until this holds.
  const observed = await observeStartImpl({ seat, dispatch: dispatched });
  const proof = proveTurnStarted(observed ?? {});
  if (!proof.started) {
    return close({
      ok: false,
      stage: 'turn-start',
      reason: proof.reason,
      retryRequestId: proof.retryRequestId ?? null,
      warnings: proof.warnings,
      outcome: null,
      testRun: null,
    });
  }

  // 3. Sleep on the mailbox.
  const heard = await waitForWorkerDone({
    checkWaitImpl,
    terminal: from,
    runId,
    dispatchId: dispatched.dispatchId,
    mirrorImpl,
    ...waitOptions,
  });

  // 4. The test suite: once, by the controller, in the candidate worktree.
  let testRun = null;
  if (runSuite && suiteRunner) {
    testRun = suiteRunner.ran(suiteKey)
      ? suiteRunner.resultFor(suiteKey)
      : await suiteRunner.runOnce({ key: suiteKey, worktree: worktreePathOf(dispatched.worktree) });
  }

  // 5. Cost, then release, then worktree.
  return close({
    ok: heard.outcome === 'succeeded',
    stage: 'done',
    outcome: heard.outcome,
    reason: heard.outcome === 'succeeded' ? null : `the ${seat} reported ${heard.outcome ?? 'nothing before the wait expired'}`,
    testRun,
    messages: heard.messages,
    mirrorFailures: heard.mirrorFailures,
    acknowledged: heard.acknowledged,
  });
}

// Orca names a worktree `<repoId>::<path>`; the suite runs in the path.
function worktreePathOf(worktreeId) {
  if (typeof worktreeId !== 'string') return worktreeId;
  const marker = worktreeId.indexOf('::');
  return marker < 0 ? worktreeId : worktreeId.slice(marker + 2);
}

// One step end to end: the builder, then the reviewer, on ONE test run, with a
// cost line for each and no way to finish without both.
export async function runBuildAndReview({
  card,
  step,
  choices,
  suiteRunner,
  suiteKey = `${card.identifier}:${step.key ?? step.title}`,
  seats = ['builder', 'reviewer'],
  ...shared
} = {}) {
  const results = {};
  for (const seat of seats) {
    results[seat] = await runWorkerStep({
      seat,
      card,
      step,
      choice: choices[seat],
      worktreeName: `${card.identifier.toLowerCase()}-${step.key ?? 'step'}${seat === 'reviewer' ? '-review' : ''}`,
      requestId: `${suiteKey}:${seat}`,
      suiteRunner,
      suiteKey,
      // The reviewer never re-runs the suite: it is handed the builder's run.
      runSuite: true,
      ...shared,
    });
  }

  const costLines = seats.map((seat) => results[seat].cost).filter(Boolean);
  let ok = seats.every((seat) => results[seat].ok);
  let reason = seats.map((seat) => results[seat].reason).find(Boolean) ?? null;
  let costText = [];
  try {
    // The gate before the card may leave its column.
    assertEverySeatCosted({ seats, costLines });
    costText = costLines.map(formatCostLine);
  } catch (error) {
    ok = false;
    reason = error.message;
  }

  return { ...results, ok, reason, costLines, costText, testRun: suiteRunner?.resultFor(suiteKey) ?? null, suiteKey };
}
