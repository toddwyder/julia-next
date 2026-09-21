// core.mjs -- JUL-98 step 2: one check cycle of the controller.
//
// This is the seam the rest of the controller hangs off, and it is deliberately
// SHORT of two things this step does not own:
//
//   * it dispatches no worker, and
//   * it reads no mailbox.
//
// Both are step 3. What a cycle does here is decide and record: find the card,
// refuse the ones that must be refused, take the card's Orca run, write the one
// column-move comment, and move the card. That is enough for the parts this
// step is judged on to be real rather than stubbed.
//
// Every boundary is injected. The `board` is the only thing that touches Linear
// and its real implementation is built on the app token in ./token.mjs, so the
// writer is the controller's own identity ("Julia controller"), never Todd and
// never a builder -- a builder runs as `runner` and cannot read the app's
// credentials at all.

import { selectStartableCard } from './eligibility.mjs';
import { nextColumnFor, columnMoveComment } from './columns.mjs';
import { claimCardRun, createCommentGuard, isConsumerFenced } from './inflight.mjs';

export const READY_COLUMN = 'Ready';

// The default "is a card already in flight?" reader. Width 1 is Orca's, not
// ours: a run open on this environment means a card is being carried, and the
// controller does nothing else at all. The real implementation lists the
// environment's runs; the default here answers "nothing in flight" so a caller
// that has already established the slot is free need not pass one.
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

  // (d) Take the card's run. This IS the in-flight record; a repeat of the same
  // request replays rather than starting a second one.
  const claim = await claimCardRun({
    runCreateImpl,
    environment,
    from,
    identifier: chosen.identifier,
    requestId: requestIdFor(chosen.identifier, 'run'),
  });

  // (e) One comment, then the move. The comment first: a card that moved with
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
  await board.moveCard({ issueId: chosen.id, to: move.to });

  return {
    status: 'started',
    issue: chosen.identifier,
    runId: claim.runId,
    replayed: claim.replayed,
    movedTo: move.to,
    skipped,
    nextReady,
    nextCommented,
  };
}
