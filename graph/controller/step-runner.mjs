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
  //
  // `turnStarted` is the ONE thing an exit has to tell it. A worker whose turn
  // never began wrote no session file -- no Claude transcript, no Codex
  // rollout, no Pi message_end -- so asking the real reader for its figures can
  // only fail, and that failure stops the order at step 1 and LEAKS the
  // worktree (the 19-20 September case, which is the whole reason this step
  // exists). So the turn-start exit below says so, `finishWorker` skips the
  // read and gives the seat an explicit never-started line, and cleanup still
  // runs. It defaults to true, so every worker that DID run is unchanged:
  // read, then release, then remove, with a bad cost still stopping the rest.
  async function close(partial, { turnStarted = true } = {}) {
    const finished = await finishWorker({
      seat,
      dispatchId: dispatched.dispatchId,
      worktree: dispatched.worktree,
      readCostImpl,
      releaseImpl,
      removeWorktreeImpl,
      turnStarted,
      ...(turnStarted === false && partial?.reason ? { neverStartedReason: partial.reason } : {}),
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
    }, { turnStarted: false });
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

// THE ATTEMPT TOKEN, and why every name a second attempt uses carries it.
//
// A stopped attempt leaves things behind. JUL-92 stopped at build-and-review on
// 2026-09-21 with the cost read refusing, which is BEFORE
// `finishWorker` releases the worker and removes its worktree -- so the
// worktree `jul-92-work` is still registered with Orca (`orca worktree list
// --json` on the host, 2026-09-21: path
// /home/runner/orca/workspaces/julia-next/jul-92-work, displayName
// `jul-92-work`, branch `refs/heads/jul-92-work`). Put the card back in Ready
// and the next attempt asks for those same names again.
//
// WHAT ORCA ACTUALLY DOES WITH A REPEATED NAME -- measured, not assumed, by
// creating the same `--name` three times on this host at 1.4.205 and recording
// the answers (graph/fixtures/orca-1.4.205/worktree-create.duplicate-name-suffixed.json):
// it does NOT refuse. It silently creates a DIFFERENT path and a DIFFERENT
// branch -- `jul98-5d-probe-2`, then `-3` -- while keeping
// `displayName: "jul98-5d-probe"` with `displayNameMode: "fixed"` on every one
// of them. So two attempts on one card leave two rows sharing one display
// name, and Orca's own `name:<displayName>` selector can then no longer address
// either: `worktree rm --worktree name:jul98-5d-probe` answered
// `selector_ambiguous`
// (graph/fixtures/orca-1.4.205/worktree-rm.duplicate-name-ambiguous.error.json).
// The controller removes by `id:`, so it survives that -- but the branch it
// publishes stops being the branch the card is named after, and no operator can
// clean up by name any more.
//
// AND THE HARDER HALF, which a unique name is the same fix for: the request
// ledger. `requestId` below is the controller's logical key for a
// `worker-start`, and ./wiring.mjs turns a key it has already seen into
// `--retry-request <id>`, which Orca REPLAYS -- "no second worker" is the whole
// point of it. A second attempt on the same card with the same key would
// therefore not start a worker at all: it would be handed the stopped
// attempt's dispatch back, whose terminal and worker are gone, and then wait on
// a mailbox nothing will ever post to.
//
// So the attempt number goes into BOTH the worktree name and the request key.
// It is not invented here: ./main.mjs counts it per card in the controller's
// state file and hands it down, so it survives a restart and can only go
// forwards. Nothing leftover is deleted to make room -- `worktree rm` "also
// attempts to delete the checked-out local branch" (`orca worktree rm --help`),
// which would destroy the stopped attempt's commits, and the coordinator reads
// that worktree.
export function attemptTag(attempt) {
  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  return `a${n}`;
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
  // Which attempt on this card this is. 1 on a card that has never been
  // carried; ./main.mjs increments it before the work starts.
  attempt = 1,
  ...shared
} = {}) {
  const tag = attemptTag(attempt);
  const results = {};
  for (const seat of seats) {
    results[seat] = await runWorkerStep({
      seat,
      card,
      step,
      choice: choices[seat],
      worktreeName: `${card.identifier.toLowerCase()}-${step.key ?? 'step'}${seat === 'reviewer' ? '-review' : ''}-${tag}`,
      requestId: `${suiteKey}:${seat}:${tag}`,
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
