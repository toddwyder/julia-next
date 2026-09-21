// core.mjs -- JUL-98 step 2: one check cycle of the controller.
//
// This is the seam the rest of the controller hangs off, and it is deliberately
// SHORT of two things this step does not own:
//
//   * it dispatches no worker, and
//   * it reads no mailbox.
//
// Both are step 3. What a cycle does here is decide and record: find the card,
// refuse the ones that must be refused, resolve a capped seat's fallback (and
// say on the card when that moved the partner seat), take the card's Orca run,
// write the one column-move comment, and move the card. That is enough for the
// parts this step is judged on to be real rather than stubbed.
//
// Every boundary is injected. The `board` is the only thing that touches
// Linear, and the implementation that runs for real is `createControllerBoard`
// in ./board.mjs: it drives every Linear call through `createAuthedLinearCall`
// in ./token.mjs, so the writer is the controller's own identity ("Julia
// controller"), never Todd and never a builder -- a builder runs as `runner`
// and cannot read the app's credentials at all. Every test here injects a
// stand-in board instead, which is why the suite runs as `runner`.

import { selectStartableCard, controllerFingerprint } from './eligibility.mjs';
import { nextColumnFor, columnMoveComment } from './columns.mjs';
import { claimCardRun, createCommentGuard, isConsumerFenced } from './inflight.mjs';
// The seat rules are seat-labels.mjs's, imported rather than repeated: which
// backup a capped seat takes, and whether the partner has to move out of its
// way, is one rule with one home.
import { seatChoicesForIssue, fallbackSeatChoice } from '../../scripts/seat-labels.mjs';

export const READY_COLUMN = 'Ready';

// The default "is a card already in flight?" reader. Width 1 is Orca's, not
// ours: a run open on this environment means a card is being carried, and the
// controller does nothing else at all.
//
// This default answers "nothing in flight", for a caller that has already
// established the slot is free. It is NOT a production reader and this step
// wires none: the run-list walk that really answers the question is `isSlotBusy`
// in scripts/ready-queue.mjs (it follows Orca's cursor to the end), and it
// returns a boolean where `activeRunImpl` here returns the run itself, so
// adapting it belongs to the step that switches the controller on.
async function noActiveRun() {
  return null;
}

export async function runControllerCheck({
  board,
  runCreateImpl,
  environment,
  from,
  previousReady = {},
  previousCommented = {},
  activeRunImpl = noActiveRun,
  requestIdFor = (identifier, purpose) => `${identifier}:${purpose}`,
  now = () => new Date().toISOString(),
  // The hand-built duplicate-comment guard's memory. Passing one in across
  // cycles is what makes a repeated cycle replay its comment instead of writing
  // a second identical note (the one thing Orca's replay does not cover).
  commentsSeen = new Map(),
  hasReviewableOutput = true,
  // Which dispatch seat has hit its weekly cap on this cycle, if any
  // ('builder' or 'reviewer'). The controller cannot discover this on its own
  // -- a cap is a fact about a vendor account, learned when a dispatch is
  // refused -- so the process running the check supplies it. `null` means
  // nothing is capped and no fallback is resolved at all.
  cappedSeat = null,
  seatChoicesImpl = seatChoicesForIssue,
  seatFallbackImpl = fallbackSeatChoice,
} = {}) {
  const comments = createCommentGuard({
    postImpl: ({ issueId, body }) => board.comment({ issueId, body }),
    seen: commentsSeen,
  });

  // (a) Width 1, and the fence. Both are Orca's own answers: an open run means
  // a card is in flight, and `consumer_fenced` means another controller has
  // taken the run and this one must stand down without writing anything.
  let active;
  try {
    active = await activeRunImpl({ environment });
  } catch (error) {
    if (isConsumerFenced(error)) {
      return { status: 'fenced', reason: error.message, nextReady: previousReady, nextCommented: previousCommented };
    }
    throw error;
  }
  if (active) {
    return {
      status: 'slot-busy',
      issue: active.objective ?? null,
      runId: active.id ?? null,
      nextReady: previousReady,
      nextCommented: previousCommented,
    };
  }

  // (b) The cards in Ready, in board order, with the three refusals and the
  // one-full-check rule applied. Pure -- see ./eligibility.mjs.
  const issues = await board.listReadyCards();
  const { chosen, skipped, nextReady, nextCommented } = selectStartableCard({
    issues,
    previousReady,
    previousCommented,
  });

  // (c) One comment per refusal, and none for a card that has already been told
  // this exact thing. A card merely waiting its turn is told nothing.
  for (const entry of skipped) {
    if (!entry.comment) continue;
    const issue = issues.find((candidate) => candidate.identifier === entry.issue);
    await comments.postOnce({
      issueId: issue.id,
      key: `refusal:${entry.reasons.join('|')}`,
      body: entry.comment,
    });
  }

  if (!chosen) {
    const status = issues.length === 0 ? 'empty-ready' : 'nothing-eligible';
    return { status, skipped, nextReady, nextCommented };
  }

  // (d) The capped seat, if there is one. This happens BEFORE the run is taken
  // and before the card moves: a pair the family rule refuses must leave the
  // card exactly where it was, in Ready, with its sighting intact, rather than
  // moved into Implementation with nothing able to run on it.
  let seatFallback = null;
  if (cappedSeat) {
    seatFallback = seatFallbackImpl(seatChoicesImpl(chosen), cappedSeat);
    if (!seatFallback.ok) {
      return {
        status: 'seat-refused',
        issue: chosen.identifier,
        reason: seatFallback.reason,
        skipped,
        // The card never left Ready, so it keeps the sighting
        // selectStartableCard dropped on the assumption it would start.
        nextReady: { ...nextReady, [chosen.id]: controllerFingerprint(chosen) },
        nextCommented,
      };
    }
  }

  // (e) Take the card's run. This IS the in-flight record; a repeat of the same
  // request replays rather than starting a second one.
  const claim = await claimCardRun({
    runCreateImpl,
    environment,
    from,
    identifier: chosen.identifier,
    requestId: requestIdFor(chosen.identifier, 'run'),
  });

  // (f) One comment, then the move. The comment first: a card that moved with
  // no comment is a silent move, which is the thing the card forbids.
  const move = nextColumnFor(READY_COLUMN, { hasReviewableOutput });
  if (!move.ok) throw new Error(`controller: ${move.reason}`);
  const body = columnMoveComment({
    identifier: chosen.identifier,
    from: READY_COLUMN,
    move,
    at: now(),
  });
  await comments.postOnce({
    issueId: chosen.id,
    key: `move:${READY_COLUMN}->${move.to}`,
    body,
  });
  // (g) The one comment the capped-seat move owes the card, and ONLY when a
  // partner really moved. `partnerMovedReason` is posted verbatim: the card
  // says exactly what seat-labels.mjs decided, so the board and the code
  // cannot tell two different stories. Through the same guard, so a replayed
  // cycle does not write it twice.
  const partnerMoved = seatFallback?.partnerMoved ?? null;
  if (partnerMoved) {
    await comments.postOnce({
      issueId: chosen.id,
      key: `seat-partner-move:${partnerMoved.seat}->${partnerMoved.to}`,
      body: seatFallback.partnerMovedReason,
    });
  }

  await board.moveCard({ issueId: chosen.id, to: move.to });

  return {
    status: 'started',
    issue: chosen.identifier,
    runId: claim.runId,
    replayed: claim.replayed,
    movedTo: move.to,
    // The pair to dispatch, once a capped seat has been resolved. `null` when
    // nothing was capped -- step 3 is what reads it.
    seatChoices: seatFallback?.choices ?? null,
    partnerMoved,
    skipped,
    nextReady,
    nextCommented,
  };
}
