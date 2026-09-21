// release.mjs -- JUL-98 step 3, item 6: a finished worker is released through
// Orca (output archived, terminal closed) and the card's worktrees are removed
// -- AFTER the cost has been read, and never before.
//
// THE ORDER IS THE POINT. Todd added this rule on 21 September because it had
// already gone wrong: step 1's Claude builder cost line came back blank because
// cleanup ran first, and the figures only live in the worker's own session
// files. Once the worktree is gone, so are they. So `finishWorker` does exactly
// three things in exactly one order -- read, release, remove -- and a cost that
// is blank or unreadable STOPS the other two, leaving the worker and its
// worktree in place so the figures can be read again. A card that has lost a
// seat's figures is a failed step; a card that has to wait a minute for cleanup
// is not.
//
// WHAT IS INJECTED AND WHY. `releaseImpl` and `removeWorktreeImpl` are passed
// in. The recordings in graph/fixtures/orca-1.4.205/ do NOT contain a
// `worker-release` answer: the findings record names the command (section 5:
// "worker-release, which closes the terminal") and the recorded command diff
// gives `worktree rm --worktree <selector> [--force] [--run-hooks]
// [--allow-failed-archive-hook]`, but no captured payload exists for either. So
// this module refuses to guess one. It owns the ORDER, which is what the card
// asks it to own; step 4, which switches the controller on, wires the real
// argv and records the answers.

import { assertCostLineComplete, neverStartedCostLine } from './cost.mjs';

// THE ONE CASE WITH NO COST TO LOSE: a worker that NEVER STARTED. If no turn
// ever began there is no session file to read -- Claude wrote no transcript,
// Codex no rollout, Pi no message_end -- so the cost read can only fail, and
// under attempt 1 that failure stopped the order at step 1 and LEAKED the
// worktree. That is precisely the 19-20 September case
// (graph/fixtures/orca-1.4.205/worker-start.failed-agent-readiness.json: state
// failed, failedStage agent_readiness, lastError timeout, with a
// residualResources list), where cleanup is the whole point. So a caller that
// knows the turn never started passes `turnStarted: false`, the read is
// skipped, and the seat gets an explicit never-started line (0 tokens, $0,
// `neverStarted: true`) rather than a blank one that could pass unnoticed.
// Nothing here weakens the order for a worker that DID run: `turnStarted`
// defaults to true, and on that path read-then-release-then-remove is
// unchanged, with a bad cost still stopping everything after it.

// One finished worker, finished properly.
//
// Returns `{ ok, cost, released, worktreeRemoved, reason }`. `ok: false` always
// means the cost line is not safe to post, and in that case nothing later in
// the order has run.
export async function finishWorker({
  seat,
  dispatchId,
  worktree,
  readCostImpl,
  releaseImpl,
  removeWorktreeImpl,
  removeWorktree = true,
  turnStarted = true,
  neverStartedReason = 'no turn was ever observed to start, so this worker has no session to read a cost from',
}) {
  // 1. READ THE COST. First, always, while the session files still exist --
  //    unless there is nothing to read because the turn never started.
  let cost = null;
  if (turnStarted === false) {
    cost = neverStartedCostLine({ seat, reason: neverStartedReason });
  } else {
    try {
      cost = await readCostImpl({ seat, dispatchId, worktree });
      assertCostLineComplete(cost);
    } catch (error) {
      return {
        ok: false,
        seat,
        cost,
        released: false,
        worktreeRemoved: false,
        reason: `${error.message} -- the worker and its worktree were left in place so the figures can be read again`,
      };
    }
  }

  // 2. RELEASE. Output archived, terminal closed.
  try {
    await releaseImpl({ seat, dispatchId });
  } catch (error) {
    return {
      ok: false,
      seat,
      cost,
      released: false,
      worktreeRemoved: false,
      reason: `release failed: ${error.message}`,
    };
  }

  // 3. REMOVE THE WORKTREE.
  if (!removeWorktree) {
    return { ok: true, seat, cost, released: true, worktreeRemoved: false, reason: null };
  }
  try {
    await removeWorktreeImpl({ seat, dispatchId, worktree });
  } catch (error) {
    return {
      ok: false,
      seat,
      cost,
      released: true,
      worktreeRemoved: false,
      reason: `worktree removal failed: ${error.message}`,
    };
  }

  return { ok: true, seat, cost, released: true, worktreeRemoved: true, reason: null };
}

// The gate before the card leaves its column: every seat that ran has a
// complete cost line. A blank one fails the step, so it must be caught here,
// where the card has not yet moved.
export function assertEverySeatCosted({ seats = [], costLines = [] } = {}) {
  const bySeat = new Map(costLines.map((line) => [line?.seat, line]));
  for (const seat of seats) {
    const line = bySeat.get(seat);
    if (!line) {
      throw new Error(`no cost line for the ${seat} seat -- a blank cost line for any seat fails the step, and the card must not leave its column without one`);
    }
    assertCostLineComplete(line);
  }
  return costLines;
}
