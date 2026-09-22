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
import { readFailedCostLine } from '../graph/controller/cost.mjs';
import { createOrcaSeatCostReader } from '../graph/controller/wiring.mjs';

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

// --- A worker that never started ---------------------------------------------
//
// The review finding this pins (JUL-98 step 3, attempt 1): read-cost-then-
// release-then-remove is right for a worker that RAN, but a worker that never
// started has no session file to read a cost from, so the cost read threw, the
// order stopped at step 1, and the worktree leaked. Orca's recording of that
// case is graph/fixtures/orca-1.4.205/worker-start.failed-agent-readiness.json
// (state failed, failedStage agent_readiness, lastError timeout, and a
// residualResources list) -- exactly the 19-20 September trust screen, where
// the leaked worktree is the thing that needs cleaning up.

test('a worker that never started is still cleaned up: no cost is read, and the line says never-started rather than blank', async () => {
  const r = recorder();
  // The real never-started case: there is no session file, so a cost read
  // would throw -- and under attempt 1 that threw refusal stopped the order at
  // step 1 and leaked the worktree.
  r.readCostImpl = async () => {
    r.order.push('read-cost');
    throw new Error('no session file for this worker: no turn ever started');
  };
  const result = await finishWorker({
    seat: 'builder',
    dispatchId: 'ctx_937abab903ae',
    worktree: 'dce3a58b::/home/runner/orca/workspaces/julia-next/jul92-step-1',
    turnStarted: false,
    ...r,
  });

  assert.deepEqual(r.order, ['release', 'remove-worktree'], 'there is no session to read, so the read is skipped -- and it must not block cleanup');
  assert.equal(result.ok, true);
  assert.equal(result.cost.neverStarted, true, 'explicitly never-started, not a blank cost line that would silently pass');
  assert.equal(result.cost.totalTokens, 0);
  assert.equal(result.released, true);
  assert.equal(result.worktreeRemoved, true, 'the worktree must not leak');
});

// JUL-98 step 5, fourth fix: the cost read is now an Orca terminal on the
// worker daemon, which costs a terminal and a poll. A never-started worker has
// nothing to read, so it must not pay either -- and, more importantly, must
// still get its explicit never-started line rather than the refusal that
// terminal would produce. This runs the REAL reader, not a stand-in, so the
// claim is about the code that ships.
test('the never-started path never creates a cost terminal -- it is still an explicit never-started line, not an error', async () => {
  const r = recorder();
  const created = [];
  r.readCostImpl = createOrcaSeatCostReader({
    boundaries: {
      async workerTerminalCreateImpl(args) { created.push(args); return { terminal: { handle: 'term_x' } }; },
      async terminalReadImpl() { return { terminal: { tail: [] } }; },
      async terminalCloseImpl() { return {}; },
    },
    pollMs: 0,
    timeoutMs: 0,
  });
  const result = await finishWorker({
    seat: 'builder',
    dispatchId: 'ctx_937abab903ae',
    worktree: 'dce3a58b::/home/runner/orca/workspaces/julia-next/jul92-step-1',
    turnStarted: false,
    ...r,
  });

  assert.deepEqual(created, [], 'no terminal is created for a worker that never began a turn');
  assert.equal(result.ok, true);
  assert.equal(result.cost.neverStarted, true);
  assert.equal(result.cost.totalTokens, 0);
  assert.equal(result.worktreeRemoved, true);
});

test('a worker that DID run still has its cost read before anything is released -- the never-started path does not weaken the order', async () => {
  const r = recorder();
  const result = await finishWorker({
    seat: 'builder',
    dispatchId: 'ctx_937abab903ae',
    worktree: 'dce3a58b::/home/runner/orca/workspaces/julia-next/jul92-step-1',
    turnStarted: true,
    ...r,
  });
  assert.deepEqual(r.order, ['read-cost', 'release', 'remove-worktree']);
  assert.equal(result.cost.neverStarted, undefined);
});

test('a never-started seat passes the gate before the card moves, and an ordinary blank one still does not', async () => {
  const neverStarted = await finishWorker({
    seat: 'builder',
    dispatchId: 'ctx_937abab903ae',
    worktree: 'dce3a58b::/home/runner/orca/workspaces/julia-next/jul92-step-1',
    turnStarted: false,
    ...recorder(),
  });
  assert.doesNotThrow(() => assertEverySeatCosted({ seats: ['builder'], costLines: [neverStarted.cost] }));
  assert.throws(
    () => assertEverySeatCosted({ seats: ['builder'], costLines: [{ seat: 'builder', model: null, totalTokens: null, peakContext: null, minutes: null }] }),
    /blank/,
  );
});

test('a possibly-running seat with a read-failed cost line passes the gate before the card moves, while an ordinary blank line still does not', () => {
  const line = readFailedCostLine({ seat: 'builder', model: 'claude-opus-5', reason: 'transcript missing' });
  assert.doesNotThrow(() => assertEverySeatCosted({ seats: ['builder'], costLines: [line] }));
  assert.throws(
    () => assertEverySeatCosted({ seats: ['builder'], costLines: [{ seat: 'builder', model: null, totalTokens: null, peakContext: null, minutes: null }] }),
    /blank/,
  );
});

