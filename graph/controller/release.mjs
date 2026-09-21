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

import { assertCostLineComplete } from './cost.mjs';

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
}) {
  // 1. READ THE COST. First, always, while the session files still exist.
  let cost = null;
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
