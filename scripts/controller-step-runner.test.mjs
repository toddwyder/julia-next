// controller-step-runner.test.mjs -- JUL-98 step 3: the whole of how the
// controller uses workers, in one order, on one step.
//
// The pieces are pinned in their own files (dispatch, turn-start, mailbox,
// test-run, cost, release, card-steps). What is pinned HERE is the order they
// happen in, which is where the two rules Todd added on 21 September live:
//
//   * the cost is read BEFORE the worker is released and before its worktree
//     is removed, and
//   * the card's Steps block is written and ticked by the program as the step
//     moves.
//
// Plus the one this step exists to prevent: a worker whose turn never started
// is caught AT ONCE, not waited on. The mailbox is never even opened for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runWorkerStep, runBuildAndReview } from '../graph/controller/step-runner.mjs';
import { createSuiteRunner } from '../graph/controller/test-run.mjs';
import { createFixtureWorkerOrca, loadOrcaFixture } from '../graph/controller/fixture-orca.mjs';
import { turnStartedFromSend } from '../graph/controller/turn-start.mjs';

const ALL = loadOrcaFixture('mailbox.check-all.status-heartbeat-escalation-done.json').result;
const TURN_STARTED = loadOrcaFixture('terminal-send.wait-submit.turn-started.json').result;
const NO_TURN = loadOrcaFixture('terminal-send.wait-submit.no-turn-started.json').result;

const GREEN_TAP = '# tests 522\n# pass 521\n# fail 0\n# skipped 1\n# todo 0\n';

const CARD = { identifier: 'JUL-92', title: 'Docs and settings match how things run now' };
const STEP = { key: 'step-1', title: 'Fix the stale runbook lines', brief: 'Rewrite the three stale paragraphs.', criteria: ['the runbook names the real paths'] };
const CHOICES = {
  builder: { entry: 'claude', modelLabel: 'builder-claude-opus', effort: 'medium' },
  reviewer: { entry: 'codex', modelLabel: 'adversary-codex', effort: 'medium' },
};

const COST = { model: 'claude-opus-5', totalTokens: 369994, peakContext: 62524, minutes: 0.71, usd: 0.1057, capped: false, failedOverTo: null };

// A worker_done for whatever dispatch id the fixture Orca hands out, so the
// mailbox stand-in answers about the worker that was actually started.
function doneMessage(dispatchId, outcome = 'succeeded') {
  const recorded = ALL.messages.find((message) => message.type === 'worker_done');
  return { ...recorded, payload: JSON.stringify({ taskId: 'task_x', dispatchId, outcome }) };
}

function harness({ send = TURN_STARTED, outcome = 'succeeded', cost = COST } = {}) {
  const order = [];
  const orca = createFixtureWorkerOrca();
  return {
    order,
    orca,
    deps: {
      environment: 'ovh-local',
      runId: 'run_1bf570ce5660',
      from: 'term_controller',
      repo: 'path:/home/runner/julia-next',
      workerStartImpl: async (options) => { order.push('dispatch'); return orca.workerStart(options); },
      observeStartImpl: async () => { order.push('prove-start'); return { send }; },
      checkWaitImpl: async ({ ack }) => {
        order.push('mailbox-wait');
        const dispatchId = orca.workerStartCalls().length > 0 ? lastDispatchId(orca) : 'ctx_unknown';
        return {
          runId: ALL.runId,
          deliveryId: `delivery_${order.length}`,
          messages: ack ? [doneMessage(dispatchId, outcome)] : [ALL.messages[4], doneMessage(dispatchId, outcome)],
          count: 2,
          timedOut: false,
        };
      },
      // THE STAND-IN INVENTS NOTHING. The real reader reads the worker's own
      // session file -- Claude's transcript, Codex's rollout, Pi's
      // message_end. A worker whose turn never started wrote none of them, so
      // the real reader can only fail. Handing back a figure here is how the
      // suite stayed green over a live gap in round 2: the controller sent a
      // never-started worker down the ordinary read path and the stand-in
      // covered for it. It refuses now, exactly as the real reader would.
      readCostImpl: async ({ seat }) => {
        order.push(`read-cost:${seat}`);
        if (!turnStartedFromSend(send)) {
          throw new Error(`no session file exists for the ${seat}: its turn never started, so there is no cost to read`);
        }
        return { seat, ...cost };
      },
      releaseImpl: async ({ seat }) => { order.push(`release:${seat}`); },
      removeWorktreeImpl: async ({ seat }) => { order.push(`remove-worktree:${seat}`); },
      mirrorImpl: async () => { order.push('mirror'); },
      now: () => '2026-09-21T14:00:00.000Z',
    },
  };
}

let dispatchCounter = 0;
function lastDispatchId(orca) {
  // The fixture Orca derives each dispatch id from the recorded one by suffix.
  dispatchCounter = orca.workersStarted();
  return `ctx_937abab903ae-${dispatchCounter}`;
}

test('one step, in one order: dispatch, prove the turn started, sleep on the mailbox, then the cost, then the release, then the worktree', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({
    execImpl: async () => { h.order.push('test-suite'); return { stdout: GREEN_TAP }; },
    now: () => '2026-09-21T14:00:00.000Z',
  });

  const result = await runWorkerStep({
    seat: 'builder',
    card: CARD,
    step: STEP,
    choice: CHOICES.builder,
    worktreeName: 'jul92-step-1',
    requestId: 'JUL-92:step-1:builder',
    suiteRunner,
    suiteKey: 'JUL-92:step-1',
    ...h.deps,
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.testRun.pass, 521);
  assert.equal(result.cost.totalTokens, 369994);

  const withoutMirrors = h.order.filter((entry) => entry !== 'mirror');
  assert.deepEqual(withoutMirrors, [
    'dispatch',
    'prove-start',
    'mailbox-wait',
    'test-suite',
    'read-cost:builder',
    'release:builder',
    'remove-worktree:builder',
  ]);
});

test('a worker that never started is caught at once: the mailbox is never opened and nothing is waited on', async () => {
  const h = harness({ send: NO_TURN });
  h.deps.checkWaitImpl = async () => { throw new Error('the mailbox must not be opened for a worker that never started'); };
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });

  const result = await runWorkerStep({
    seat: 'builder', card: CARD, step: STEP, choice: CHOICES.builder,
    worktreeName: 'jul92-step-1', requestId: 'r', suiteRunner, suiteKey: 'k',
    ...h.deps,
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage, 'turn-start');
  assert.match(result.reason, /input.accepted/i);
  assert.equal(result.retryRequestId, NO_TURN.send.prompt.requestId, 'Orca\'s own replay advice is carried, so confirming costs nothing');

  // AND IT IS CLEANED UP AS A NEVER-STARTED WORKER. There is no session to
  // read, so the read is not attempted at all: the seat gets an explicit
  // never-started line and the worktree still goes. Round 2 sent this worker
  // down the ordinary read path, where the real reader has nothing to read,
  // and the worktree leaked -- the 19-20 September failure exactly.
  assert.equal(result.cost.neverStarted, true, 'the seat is costed as never started, not with an invented or blank figure');
  assert.equal(result.cost.totalTokens, 0);
  assert.equal(result.released, true);
  assert.equal(result.worktreeRemoved, true, 'the workspace of a worker that never started is still removed');
  const withoutMirrors = h.order.filter((entry) => entry !== 'mirror');
  assert.deepEqual(withoutMirrors, ['dispatch', 'prove-start', 'release:builder', 'remove-worktree:builder']);
});

test('a worker that reports outcome failed is reported as failed, and is still costed and cleaned up', async () => {
  const h = harness({ outcome: 'failed' });
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });

  const result = await runWorkerStep({
    seat: 'builder', card: CARD, step: STEP, choice: CHOICES.builder,
    worktreeName: 'jul92-step-1', requestId: 'r', suiteRunner, suiteKey: 'k',
    ...h.deps,
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.ok, false);
  assert.ok(h.order.includes('read-cost:builder'));
  assert.ok(h.order.indexOf('read-cost:builder') < h.order.indexOf('release:builder'), 'a failed worker is costed before it is released too');
});

test('every mailbox message is mirrored, not just the one that ended the wait', async () => {
  const mirrored = [];
  const h = harness();
  h.deps.mirrorImpl = async (message) => { mirrored.push(message.type); };
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });

  await runWorkerStep({
    seat: 'builder', card: CARD, step: STEP, choice: CHOICES.builder,
    worktreeName: 'jul92-step-1', requestId: 'r', suiteRunner, suiteKey: 'k',
    ...h.deps,
  });
  assert.deepEqual(mirrored, ['status', 'worker_done']);
});

// --- the step as a whole: build, then review, on one test run ---------------

test('the builder and the reviewer are separate fresh workers, handed the SAME single test run', async () => {
  const h = harness();
  let suiteRuns = 0;
  const suiteRunner = createSuiteRunner({
    execImpl: async () => { suiteRuns += 1; h.order.push('test-suite'); return { stdout: GREEN_TAP }; },
    now: () => '2026-09-21T14:00:00.000Z',
  });

  const result = await runBuildAndReview({
    card: CARD, step: STEP, choices: CHOICES, suiteRunner,
    ...h.deps,
  });

  assert.equal(suiteRuns, 1, 'the suite runs once for the step, not once per seat');
  assert.equal(result.builder.testRun, result.reviewer.testRun, 'both seats were handed the very same result');
  assert.notEqual(result.builder.dispatchId, result.reviewer.dispatchId, 'two fresh workers');
  assert.equal(result.ok, true);

  assert.equal(result.costLines.length, 2);
  assert.deepEqual(result.costLines.map((line) => line.seat), ['builder', 'reviewer']);
  for (const text of result.costText) assert.match(text, /peak context/);
});

test('the step cannot be reported done while a seat has no cost line', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });
  h.deps.readCostImpl = async ({ seat }) => {
    h.order.push(`read-cost:${seat}`);
    return seat === 'reviewer' ? { seat, ...COST, peakContext: null } : { seat, ...COST };
  };

  const result = await runBuildAndReview({ card: CARD, step: STEP, choices: CHOICES, suiteRunner, ...h.deps });
  assert.equal(result.ok, false);
  assert.match(result.reason, /peakContext/);
  assert.ok(!h.order.includes('release:reviewer'), 'and the reviewer was not released with its figures unread');
});
