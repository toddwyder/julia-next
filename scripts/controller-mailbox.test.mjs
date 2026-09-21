// controller-mailbox.test.mjs -- JUL-98 step 3, items 2 and 7: the controller
// sleeps on Orca's mailbox, and every message it hears is mirrored to Axiom
// through the existing journey relay.
//
// Every shape below is read off a recording in graph/fixtures/orca-1.4.205/:
//
//   mailbox.check-all.status-heartbeat-escalation-done.json  seven real
//       messages: status x2, heartbeat, escalation and three worker_done, each
//       with `payload` as a JSON STRING carrying taskId/dispatchId and, for a
//       worker_done, `outcome`.
//   mailbox.check-wait-batch.jsonl   what a blocking `check --wait` returns:
//       a batch with a `deliveryId` to acknowledge, `timedOut: false`.
//   check-wait.empty-inbox-timeout.json   a wait that expired: `messages: []`,
//       `count: 0`, `timedOut: true`, `deliveryId: null`.
//   failure.mailbox.check-all.claude-codex-pi.json   worker_done with
//       `outcome: "failed"`, from all three vendors.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKER_MESSAGE_TYPES,
  classifyMessage,
  outcomeOf,
  createAxiomMirror,
  waitForWorkerDone,
} from '../graph/controller/mailbox.mjs';
import { loadOrcaFixture } from '../graph/controller/fixture-orca.mjs';

const ALL = loadOrcaFixture('mailbox.check-all.status-heartbeat-escalation-done.json').result;
const EMPTY_TIMEOUT = loadOrcaFixture('check-wait.empty-inbox-timeout.json').result;
const FAILED = loadOrcaFixture('failure.mailbox.check-all.claude-codex-pi.json').result;

// A batch shaped exactly like the recorded `check --wait` answer.
function batch(messages, { deliveryId = 'delivery_f3e92ff070dd', timedOut = false } = {}) {
  return {
    runId: ALL.runId,
    deliveryId,
    messages,
    count: messages.length,
    replayed: false,
    acknowledged: null,
    timedOut,
    cancelled: false,
    connectionLost: false,
    mutation: { requestId: 'req', replayed: false },
  };
}

const byType = (type) => ALL.messages.filter((message) => message.type === type);

test('the recorded payload is a JSON string, and every field the controller acts on is read out of it', () => {
  const done = byType('worker_done')[0];
  assert.equal(typeof done.payload, 'string', 'fixture check: Orca sends payload as a string');

  const classified = classifyMessage(done);
  assert.equal(classified.type, 'worker_done');
  assert.equal(classified.dispatchId, 'ctx_25889cbfea14');
  assert.equal(classified.taskId, 'task_12996abe9a89');
  assert.equal(classified.outcome, 'succeeded');
  assert.equal(classified.subject, 'Probe complete');
  assert.match(classified.body, /Executed the JUL-109 mailbox probe sequence/);

  const status = classifyMessage(byType('status')[0]);
  assert.equal(status.type, 'status');
  assert.equal(status.phase, 'step-2');
  assert.equal(status.outcome, null, 'only a worker_done carries an outcome');
});

test('a worker_done with outcome failed is read as failed, not smoothed into success', () => {
  const failures = FAILED.messages
    .filter((message) => message.type === 'worker_done')
    .filter((message) => message.payload.includes('"failed"'));
  assert.ok(failures.length >= 3, 'fixture check: Claude, Codex and Pi each reported one');
  for (const message of failures) {
    assert.equal(outcomeOf(message), 'failed');
  }
});

test('a malformed payload does not crash the loop: the message is still classified, with no outcome', () => {
  const classified = classifyMessage({ id: 'relay_x', type: 'worker_done', payload: 'not json' });
  assert.equal(classified.outcome, null);
  assert.equal(classified.dispatchId, null);
  assert.equal(classified.payloadError, true);
});

test('the controller waits on the mailbox and returns the moment the worker\'s own worker_done arrives', async () => {
  const done = byType('worker_done')[0];
  const batches = [
    batch([byType('status')[1]]),
    batch([byType('heartbeat')[0]]),
    batch([done]),
  ];
  const calls = [];
  const result = await waitForWorkerDone({
    checkWaitImpl: async (options) => {
      calls.push(options);
      return batches.shift();
    },
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_25889cbfea14',
    timeoutMs: 90000,
  });

  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.source, 'mailbox', 'the verdict came from the mailbox, never from watching a terminal');
  assert.equal(result.message.id, done.id);
  assert.equal(calls.length, 3, 'it blocked three times and acted on what arrived');
  assert.equal(calls[0].types.join(','), WORKER_MESSAGE_TYPES.join(','));
  assert.equal(calls[0].timeoutMs, 90000);
});

test('each wait acknowledges the batch before it, or the same message wakes it again forever', async () => {
  const batches = [
    batch([byType('status')[0]], { deliveryId: 'delivery_one' }),
    batch([byType('worker_done')[0]], { deliveryId: 'delivery_two' }),
  ];
  const acks = [];
  const result = await waitForWorkerDone({
    checkWaitImpl: async ({ ack }) => {
      acks.push(ack ?? null);
      return batches.shift();
    },
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_25889cbfea14',
  });

  assert.deepEqual(acks, [null, 'delivery_one'], 'the second wait acknowledges the first delivery');
  assert.equal(result.acknowledged, 'delivery_two', 'and the last delivery is named so it cannot be lost');
});

test('the delivery that carried the verdict is acknowledged too -- through ackImpl, or by the next chain of waits', async () => {
  const acked = [];
  const batches = [batch([byType('worker_done')[0]], { deliveryId: 'delivery_last' })];
  const result = await waitForWorkerDone({
    checkWaitImpl: async () => batches.shift(),
    ackImpl: async ({ deliveryId }) => { acked.push(deliveryId); },
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_25889cbfea14',
  });
  assert.deepEqual(acked, ['delivery_last']);

  // The other route: the next chain starts by acknowledging it.
  const nextAcks = [];
  await waitForWorkerDone({
    checkWaitImpl: async ({ ack }) => { nextAcks.push(ack); return batch([], { timedOut: true }); },
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_other',
    initialAck: result.acknowledged,
    maxWaits: 1,
  });
  assert.deepEqual(nextAcks, ['delivery_last']);
});

test('an expired wait is not a verdict: the controller goes back to sleep and waits again', async () => {
  assert.equal(EMPTY_TIMEOUT.timedOut, true, 'fixture check');
  const batches = [EMPTY_TIMEOUT, EMPTY_TIMEOUT, batch([byType('worker_done')[0]])];
  const result = await waitForWorkerDone({
    checkWaitImpl: async () => batches.shift(),
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_25889cbfea14',
  });
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.waits, 3);
});

test('a wait that keeps expiring gives up after the limit and says so, rather than blocking for ever', async () => {
  const result = await waitForWorkerDone({
    checkWaitImpl: async () => EMPTY_TIMEOUT,
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_25889cbfea14',
    maxWaits: 3,
  });
  assert.equal(result.outcome, null);
  assert.equal(result.timedOut, true);
  assert.equal(result.waits, 3);
});

test('another worker\'s worker_done does not end this worker\'s wait', async () => {
  const other = byType('worker_done').find((message) => message.payload.includes('ctx_866d6d92d021'));
  const mine = byType('worker_done')[0];
  const batches = [batch([other]), batch([mine])];
  const result = await waitForWorkerDone({
    checkWaitImpl: async () => batches.shift(),
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_25889cbfea14',
  });
  assert.equal(result.message.id, mine.id);
  assert.equal(result.waits, 2);
});

test('an escalation is handed to the caller the moment it arrives, before any worker_done', async () => {
  const escalation = byType('escalation')[0];
  const seen = [];
  const batches = [batch([escalation]), batch([byType('worker_done')[0]])];
  await waitForWorkerDone({
    checkWaitImpl: async () => batches.shift(),
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_25889cbfea14',
    onEscalation: (message) => seen.push(message),
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].subject, 'probe-escalation');
  assert.match(seen[0].body, /deliberate test escalation/);
});

// ---------------------------------------------------------------------------
// Item 7: EVERY message is mirrored to Axiom, not just the last one
// ---------------------------------------------------------------------------

test('every message in every batch is mirrored, in the order it arrived', async () => {
  const mirrored = [];
  const batches = [
    batch(ALL.messages.slice(4, 7)), // status, worker_done, worker_done
    batch([byType('worker_done')[0]]),
  ];
  await waitForWorkerDone({
    checkWaitImpl: async () => batches.shift(),
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_25889cbfea14',
    mirrorImpl: async (message) => { mirrored.push(message); },
  });
  assert.equal(mirrored.length, 4, 'three in the first batch and one in the second -- every message, not just the last');
  assert.deepEqual(
    mirrored.map((message) => message.id),
    [...ALL.messages.slice(4, 7).map((message) => message.id), byType('worker_done')[0].id],
  );
});

test('the mirror goes through the existing journey relay, with the message\'s own facts in the context', async () => {
  const recorded = [];
  const mirror = createAxiomMirror({
    runId: ALL.runId,
    recordEventImpl: async (stage, context) => { recorded.push({ stage, context }); return { sent: true }; },
  });

  await mirror(classifyMessage(byType('heartbeat')[0]));
  await mirror(classifyMessage(byType('worker_done')[0]));
  await mirror(classifyMessage(FAILED.messages.find((message) => message.type === 'worker_done')));

  assert.deepEqual(recorded.map((entry) => entry.stage), ['progress', 'completed', 'failed']);
  assert.equal(recorded[0].context.runId, ALL.runId);
  assert.equal(recorded[0].context.messageType, 'heartbeat');
  assert.equal(recorded[0].context.dispatchId, 'ctx_25889cbfea14');
  assert.equal(recorded[1].context.outcome, 'succeeded');
  assert.equal(recorded[2].context.outcome, 'failed');
});

test('a relay that is down does not stop the controller acting on the message', async () => {
  const batches = [batch([byType('worker_done')[0]])];
  const result = await waitForWorkerDone({
    checkWaitImpl: async () => batches.shift(),
    terminal: 'term_controller',
    runId: ALL.runId,
    dispatchId: 'ctx_25889cbfea14',
    mirrorImpl: async () => { throw new Error('relay unreachable'); },
  });
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.mirrorFailures, 1, 'and the failure is counted and reported, not hidden');
});
