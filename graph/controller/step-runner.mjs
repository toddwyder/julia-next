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
import { formatCostLine, neverStartedCostLine } from './cost.mjs';
// The seat rules are scripts/seat-labels.mjs's, imported rather than repeated.
// A seat that CANNOT BE LAUNCHED takes exactly the route a CAPPED seat already
// takes (JUL-98 step 2, item 6): the same `fallbackSeatChoice`, the same seat
// table, the same family guard. There is no second fallback machine here.
import { fallbackSeatChoice } from '../../scripts/seat-labels.mjs';

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
  // The Orca boundaries the START-THEN-ADOPT route needs (JUL-98 step 6), for
  // the seats `worker-start --agent` has no launcher for. Passed straight
  // through: ./dispatch.mjs decides whether they are used at all.
  adoptBoundaries = {},
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
  // The controller's own clock, for a seat whose vendor records no duration.
  now = () => new Date().toISOString(),
} = {}) {
  // 1. A fresh worker.
  const dispatched = await dispatchWorker({
    workerStartImpl, adoptBoundaries, environment, runId, from, repo,
    seat, card, step, choice, files, worktreeName, requestId, now,
  });
  if (!dispatched.ok) {
    // ITEM 2 (JUL-98 step 5, fifth fix): A SEAT THAT NEVER STARTED IS COSTED AS
    // ONE, NOT LEFT BLANK. Nothing was launched, so there is no session file to
    // read -- exactly the case ./cost.mjs's `neverStartedCostLine` already
    // exists for, and it is reused here rather than a second line being
    // written. Without it the seat had NO cost line at all, and
    // `assertEverySeatCosted` then reported the stop as "no cost line for the
    // <seat> seat" -- which is what the live JUL-92 run put on the card while
    // the real reason (the reviewer's entry was refused before dispatch) was
    // said nowhere. The mark is explicit, so an ORDINARY blank line still fails
    // the step exactly as before.
    return {
      ok: false,
      seat,
      stage: 'dispatch',
      reason: dispatched.reason,
      launchRefused: dispatched.launchRefused === true,
      dispatchId: dispatched.dispatchId ?? null,
      residualResources: dispatched.residualResources ?? [],
      cost: neverStartedCostLine({ seat, reason: dispatched.reason }),
    };
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
      // The agent that was ACTUALLY launched travels with the read. A seat that
      // moved to its backup is a different vendor from the one the card's label
      // resolved to, and the cost reader has to read the session file of the
      // vendor that ran -- not the one that was refused.
      readCostImpl: (args) => readCostImpl({
        ...args,
        agent: dispatched.launch?.agent ?? null,
        model: dispatched.launch?.model ?? null,
        // An allowance-billed seat has no session file: its only figure is the
        // difference between the reading taken before it started and one taken
        // now (./cost.mjs geminiExtractFromAllowance).
        allowanceBefore: dispatched.allowanceBefore ?? null,
        // The controller started it and has now seen it report: that IS the
        // duration for a vendor that records none.
        startedAt: dispatched.startedAt ?? null,
        endedAt: dispatched.startedAt ? now() : null,
      }),
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

// ITEM 1 (JUL-98 step 5, fifth fix): THE ONE COMMENT A MOVED SEAT OWES THE
// CARD. Plain English, naming the seat, the entry it was going to run on, the
// entry it ran on instead, and why. It is ONE comment: when the family guard
// also had to move the partner seat out of the way, seat-labels.mjs's own
// `partnerMovedReason` is appended to this same comment verbatim, so the board
// and the code cannot tell two different stories.
export function seatMoveComment({ seat, from, to, modelLabel, reason, partnerMovedReason = null }) {
  const lines = [
    `**The ${seat} seat moved to its backup.** It was going to run on \`${from}\`, which could not be started: ${reason}. So it ran on the backup the seat table already names for it, \`${to}\` (${modelLabel}).`,
  ];
  if (partnerMovedReason) lines.push('', partnerMovedReason);
  return lines.join('\n');
}

// One step end to end: the builder, then the reviewer, on ONE test run, with a
// cost line for each and no way to finish without both.
//
// AND THE SEAT FALLBACK (JUL-98 step 5, fifth fix). A seat whose entry CANNOT
// BE LAUNCHED at all is not a dead end: it takes the same route a CAPPED seat
// takes. `fallbackSeatChoice` -- the very function the capped case uses, with
// the same seat table and the same family guard -- resolves that seat's backup,
// the step is started again on it, and the card is told once.
//
// Why this is not a new policy: the reviewer seat's first choice is
// `pi-deepseek`, and ./dispatch.mjs refuses to start a DeepSeek seat with a new
// worktree at all (it cannot report to the mailbox; JUL-109 section 4). Until
// this change the controller could therefore never run a review of any kind, on
// any card -- and the only thing it said about it was that a cost line was
// blank. The seat table has named `codex` as that seat's backup all along.
//
// THREE THINGS IT DELIBERATELY DOES NOT DO:
//   * it never tries a third entry, and never guesses one -- the backup comes
//     from the seat table or the step stops;
//   * it never runs a same-family pair: if the family guard refuses the backup,
//     the step stops and says so;
//   * it never moves a seat that has ALREADY RUN on this step. The partner move
//     `fallbackSeatChoice` can make is offered only while no seat has run yet
//     (`movePartner` below), so a reviewer falling back can never rewrite the
//     builder that is already finished.
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
  // The capped-seat resolver, injected only so a test can stand a seat table
  // in front of it. The default is the real one.
  seatFallbackImpl = fallbackSeatChoice,
  ...shared
} = {}) {
  const tag = attemptTag(attempt);
  const results = {};
  const seatMoves = [];
  const ran = new Set();
  // The choices actually in play. A seat that moves writes its move back here,
  // so a partner the family guard moved is dispatched on the entry it moved to.
  let inPlay = choices;

  const startSeat = (seat, choice, suffix) => runWorkerStep({
    seat,
    card,
    step,
    choice,
    // A second start for the same seat must collide with nothing the refused
    // one asked for -- the same rule `attemptTag` states for a second attempt.
    worktreeName: `${card.identifier.toLowerCase()}-${step.key ?? 'step'}${seat === 'reviewer' ? '-review' : ''}-${tag}${suffix}`,
    requestId: `${suiteKey}:${seat}:${tag}${suffix}`,
    suiteRunner,
    suiteKey,
    // The reviewer never re-runs the suite: it is handed the builder's run.
    runSuite: true,
    ...shared,
  });

  // A seat that could not be started at all, reported as that rather than as a
  // blank cost line. The never-started line carries the same sentence.
  const stopped = (base, seat, reason) => ({
    ...base, ok: false, reason, cost: neverStartedCostLine({ seat, reason }),
  });

  // ITEM 3 (JUL-98 step 5, round 2): WHAT "IT RAN ON THE BACKUP" IS ALLOWED TO
  // MEAN. The move comment below tells the card the seat RAN on its backup, so
  // it may only be written when the backup's worker actually got going.
  //
  // `launchRefused` is NOT that test. It marks only the one case where nothing
  // at all was created -- ./dispatch.mjs's own comment says so, and says that a
  // `worker-start` that FAILED deliberately keeps `ok: false` WITHOUT the mark.
  // Both of those come back from `runWorkerStep` with `stage: 'dispatch'` and a
  // never-started cost line (line 81 and line 86 above). A worker that was
  // created but whose turn was never proven is the same kind of thing again:
  // `stage: 'turn-start'`, `turnStarted: false`, a never-started cost line, and
  // no work done (line 138).
  //
  // Before this, only `launchRefused` took the stop path, so a backup that
  // failed at `agent_readiness` or the trust screen -- the 19-20 September
  // failure -- put three contradictory things on one card: "it ran on codex",
  // "worker-start failed at agent_readiness", and a cost line reading "never
  // started". So the gate is the stage, which covers all three.
  const neverGotGoing = (result) => result.stage === 'dispatch' || result.stage === 'turn-start';

  for (const seat of seats) {
    const first = inPlay[seat];
    let result = await startSeat(seat, first, '');

    if (result.launchRefused) {
      const fromEntry = first?.entry ?? null;
      const fromReason = result.reason;
      // The partner may only be moved while nothing has run yet; once the
      // builder is finished its entry is a fact, not a choice.
      const fallback = seatFallbackImpl(inPlay, seat, { movePartner: ran.size === 0 });

      if (!fallback.ok) {
        result = stopped(result, seat, `the ${seat} seat could not be started on ${fromEntry}: ${fromReason} -- and its backup was refused too: ${fallback.reason}`);
      } else {
        const backup = fallback.choices[seat];
        const second = await startSeat(seat, backup, '-bk');
        if (neverGotGoing(second)) {
          result = stopped(second, seat, `the ${seat} seat could not be started on ${fromEntry}: ${fromReason} -- and its backup ${backup.entry} could not be started either: ${second.reason}`);
        } else {
          inPlay = fallback.choices;
          seatMoves.push({
            seat,
            from: fromEntry,
            to: backup.entry,
            modelLabel: backup.modelLabel,
            reason: fromReason,
            partnerMoved: fallback.partnerMoved ?? null,
            comment: seatMoveComment({
              seat,
              from: fromEntry,
              to: backup.entry,
              modelLabel: backup.modelLabel,
              reason: fromReason,
              partnerMovedReason: fallback.partnerMovedReason ?? null,
            }),
          });
          result = { ...second, movedFrom: fromEntry, movedTo: backup.entry };
        }
      }
    }

    ran.add(seat);
    results[seat] = result;
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

  return { ...results, ok, reason, costLines, costText, seatMoves, seatChoices: inPlay, testRun: suiteRunner?.resultFor(suiteKey) ?? null, suiteKey };
}
