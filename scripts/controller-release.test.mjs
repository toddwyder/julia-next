// controller-release.test.mjs -- JUL-98 step 3, item 6 and the order half of
// item 5: the cost is READ BEFORE the worker is released and before its
// worktree is removed.
//
// This is a rule Todd added on 21 September for a reason that already
// happened: step 1's Claude builder cost line came back blank because cleanup
// ran first. The order is therefore pinned here, not merely intended.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { finishWorker, assertEverySeatCosted } from '../graph/controller/release.mjs';

const COST = {
  seat: 'builder', model: 'claude-opus-5', totalTokens: 369994, peakContext: 62524, minutes: 0.71, usd: 0.1057, capped: false, failedOverTo: null,
};

function recorder() {
  const order = [];
  return {
    order,
    readCostImpl: async () => { order.push('read-cost'); return COST; },
    releaseImpl: async () => { order.push('release'); return { released: true }; },
    removeWorktreeImpl: async () => { order.push('remove-worktree'); return { removed: true }; },
  };
}

test('the cost is read first, then the worker is released, then the worktree is removed', async () => {
  const r = recorder();
  const result = await finishWorker({
    seat: 'builder',
    dispatchId: 'ctx_937abab903ae',
    worktree: 'dce3a58b::/home/runner/orca/workspaces/julia-next/jul92-step-1',
    ...r,
  });

  assert.deepEqual(r.order, ['read-cost', 'release', 'remove-worktree'], 'reading the cost must come before releasing and before cleanup');
  assert.equal(result.ok, true);
  assert.equal(result.cost.totalTokens, 369994);
  assert.equal(result.released, true);
  assert.equal(result.worktreeRemoved, true);
});

test('a blank cost line stops the release: nothing is archived or removed while the figures are missing', async () => {
  const r = recorder();
  const result = await finishWorker({
    seat: 'builder',
    dispatchId: 'ctx_937abab903ae',
    worktree: '/w',
    ...r,
    readCostImpl: async () => { r.order.push('read-cost'); return { ...COST, peakContext: null }; },
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /peakContext/);
  assert.deepEqual(r.order, ['read-cost'], 'the worker is still there to read again: cleanup never ran');
  assert.equal(result.released, false);
  assert.equal(result.worktreeRemoved, false);
});

test('a cost read that throws is the same refusal: the worker and its worktree survive', async () => {
  const r = recorder();
  const result = await finishWorker({
    seat: 'reviewer',
    dispatchId: 'ctx_x',
    worktree: '/w',
    ...r,
    readCostImpl: async () => { r.order.push('read-cost'); throw new Error('session file not found'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /session file not found/);
  assert.deepEqual(r.order, ['read-cost']);
});

test('a release that fails does not take the worktree with it, and says so', async () => {
  const r = recorder();
  const result = await finishWorker({
    seat: 'builder',
    dispatchId: 'ctx_x',
    worktree: '/w',
    ...r,
    releaseImpl: async () => { r.order.push('release'); throw new Error('worker-release failed (terminal_handle_stale)'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.cost.totalTokens, 369994, 'the cost was already read, so it is not lost with the failure');
  assert.deepEqual(r.order, ['read-cost', 'release']);
  assert.equal(result.worktreeRemoved, false);
});

test('the card cannot leave its column until every seat has a cost line', () => {
  assert.doesNotThrow(() => assertEverySeatCosted({
    seats: ['builder', 'reviewer'],
    costLines: [COST, { ...COST, seat: 'reviewer', model: 'deepseek-v4-pro' }],
  }));

  assert.throws(
    () => assertEverySeatCosted({ seats: ['builder', 'reviewer'], costLines: [COST] }),
    /reviewer/,
    'a missing seat line must stop the column move, not be noticed later',
  );

  assert.throws(
    () => assertEverySeatCosted({
      seats: ['builder'],
      costLines: [{ ...COST, minutes: null }],
    }),
    /minutes/,
  );
});
