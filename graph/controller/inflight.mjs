// inflight.mjs -- JUL-98 step 2, item 5: width 1, using Orca rather than new
// code.
//
// The card is explicit, and so is the Decision of 2026-09-20 ("Use Orca for
// double-starts and two writers... Don't hand-build that"). The in-flight
// record for a card IS its Orca run:
//
//   * Orca binds a run to ONE coordinator terminal. A second controller that
//     takes the run fences the first, which then gets `consumer_fenced` on its
//     next call and must stand down (recorded: run-use.takeover.json and
//     check.consumer-fenced.error.json, JUL-109, 2026-09-20).
//   * Every mutating Orca call carries a request id, so a repeat returns the
//     recorded receipt and starts nothing (recorded: run-create.replayed.json,
//     `replayed: true`, same run id).
//
// So there is no lock in this file. There is a name for the run, two readers of
// Orca's own answers, and a guard for the ONE thing Orca does not cover: a
// duplicate Linear comment. That last one is named here because the card
// requires it to be named.

import { assertTicketId } from '../../scripts/ready-queue.mjs';

// The run's objective is the card's identifier: that is what makes the run the
// card's in-flight record and what lets a second controller find it rather than
// create a rival. Checked before use (item 7).
export function cardRunObjective(identifier) {
  return assertTicketId(identifier);
}

// Orca's own refusal to a controller that no longer owns the run. Read from the
// error CODE, never from message text.
export function isConsumerFenced(error) {
  return Boolean(error) && typeof error === 'object' && error.code === 'consumer_fenced';
}

// Orca's own report that a repeated request took no new effect. Present on
// every mutating call's result under `mutation` (run-create, terminal send).
export function wasReplayed(result) {
  return result?.mutation?.replayed === true;
}

// The run id an answer carries, or null. Null rather than a guess: a terminal
// send has a `mutation` but no run, and a caller must not read a run id that
// was never there.
export function runIdOf(result) {
  return result?.run?.id ?? null;
}

// Take (or re-take) the card's run. The request id is what makes this safe to
// repeat after a crash or a timeout: Orca replays its receipt instead of
// creating a second run, and the answer says which happened.
export async function claimCardRun({
  runCreateImpl,
  environment,
  from,
  identifier,
  requestId,
}) {
  const objective = cardRunObjective(identifier);
  const result = await runCreateImpl({ environment, from, objective, requestId });
  return {
    runId: runIdOf(result),
    replayed: wasReplayed(result),
    objective,
    result,
  };
}

// THE HAND-BUILT GUARD, and the only one.
//
// Orca's replay covers every Orca call. A Linear comment is not an Orca call:
// if the controller posts a column-move comment and then repeats the step (a
// retry, a crash between the comment and the state move), the card gets two
// identical notes and "every column move is exactly one comment" is broken.
// This guard records the (card, key) pairs already written and returns the
// first comment again instead of writing a second -- deliberately shaped like
// Orca's own replay answer.
//
// A FAILED post is not recorded: a comment that was never written must still be
// written on the retry.
const KEY_SEPARATOR = '::';

export function createCommentGuard({ postImpl, seen = new Map() } = {}) {
  const keyOf = (issueId, key) => `${issueId}${KEY_SEPARATOR}${key}`;
  return {
    async postOnce({ issueId, key, body }) {
      const mapKey = keyOf(issueId, key);
      if (seen.has(mapKey)) {
        return { posted: false, replayed: true, comment: seen.get(mapKey) };
      }
      const comment = await postImpl({ issueId, body });
      seen.set(mapKey, comment);
      return { posted: true, replayed: false, comment };
    },
    has({ issueId, key }) {
      return seen.has(keyOf(issueId, key));
    },
    size() {
      return seen.size;
    },
  };
}
