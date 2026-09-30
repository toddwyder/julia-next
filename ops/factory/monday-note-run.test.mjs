// monday-note-run.test.mjs -- issue #140, blocker 1: the production entrypoint.
//
// This is the piece a timer actually runs. It wires the two readers and the two
// adapters together, computes the week, builds the note, and posts it once. The
// tests inject every seam, so nothing reaches a database, GitHub, Discord or the
// Factory API.
//
// The safety rules the tests pin:
//   - a failed read fails closed: nothing is posted, the run exits non-zero;
//   - a week that already has its Discussion posts and notifies nothing;
//   - a quiet week still tells Todd, and still posts its Discussion.
import test from 'node:test';
import assert from 'node:assert/strict';

import { runMondayNote } from './monday-note-run.mjs';

function fakeDiscussions({ existing = null } = {}) {
  const calls = { found: [], posted: [] };
  return {
    calls,
    find: async (query) => { calls.found.push(query); return existing; },
    post: async (input) => { calls.posted.push(input); return { url: 'https://github.com/o/r/discussions/9' }; },
  };
}

function fakeNotifications() {
  const sent = [];
  return { sent, notify: async (message) => sent.push(message) };
}

const CARDS = [
  {
    number: 140,
    title: 'Monday note',
    enteredAt: '2026-09-28T01:00:00Z',
    stageHistory: [
      { stage: 'planning', enteredAt: '2026-09-28T01:00:00Z', exitedAt: '2026-09-28T01:15:00Z', by: 'agent:r1', exitedBy: 'agent:r1' },
      { stage: 'done', enteredAt: '2026-09-28T05:12:00Z', by: 'agent:r1' },
    ],
    sessions: { 'session-140': {} },
  },
];
const SPANS = [
  { id: 's1', card: 140, phase: 'plan', startedAt: '2026-09-28T01:00:00Z', endedAt: '2026-09-28T01:15:00Z', costUsd: 0.4, outcome: 'passed' },
];

test('one run reads the week, posts the note, and notifies Todd once with the link', async () => {
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();

  const result = await runMondayNote({
    now: '2026-10-05T08:00:00Z',
    readCards: async () => CARDS,
    readSpans: async () => SPANS,
    discussions,
    notifications,
  });

  assert.equal(result.posted, true);
  assert.equal(discussions.calls.posted.length, 1);
  assert.equal(notifications.sent.length, 1);
  assert.equal(notifications.sent[0].url, 'https://github.com/o/r/discussions/9');
  assert.match(discussions.calls.posted[0].body, /#140 Monday note/);
  assert.match(discussions.calls.posted[0].title, /week ending 2026-10-05/);
});

test('a failed card read fails closed: nothing is posted or notified', async () => {
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();

  await assert.rejects(
    () => runMondayNote({
      now: '2026-10-05T08:00:00Z',
      readCards: async () => { throw new Error('psql exited 1'); },
      readSpans: async () => SPANS,
      discussions,
      notifications,
    }),
    /psql exited 1/,
  );

  assert.equal(discussions.calls.posted.length, 0);
  assert.equal(notifications.sent.length, 0);
});

test('a failed trace read also fails closed', async () => {
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();

  await assert.rejects(
    () => runMondayNote({
      now: '2026-10-05T08:00:00Z',
      readCards: async () => CARDS,
      readSpans: async () => { throw new Error('Mastra trace list returned HTTP 500'); },
      discussions,
      notifications,
    }),
    /HTTP 500/,
  );

  assert.equal(discussions.calls.posted.length, 0);
  assert.equal(notifications.sent.length, 0);
});

test('a week that already has its Discussion is not posted or notified again', async () => {
  const discussions = fakeDiscussions({ existing: { url: 'https://github.com/o/r/discussions/9' } });
  const notifications = fakeNotifications();

  const result = await runMondayNote({
    now: '2026-10-05T08:00:00Z',
    readCards: async () => CARDS,
    readSpans: async () => SPANS,
    discussions,
    notifications,
  });

  assert.equal(result.posted, false);
  assert.equal(discussions.calls.posted.length, 0);
  assert.equal(notifications.sent.length, 0);
});

test('a quiet week posts its Discussion and tells Todd it was quiet', async () => {
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();

  await runMondayNote({
    now: '2026-10-05T08:00:00Z',
    readCards: async () => [],
    readSpans: async () => [],
    discussions,
    notifications,
  });

  assert.equal(discussions.calls.posted.length, 1);
  assert.equal(notifications.sent.length, 1);
  assert.equal(notifications.sent[0].body, 'Quiet week.');
});

test('a trace whose cost is missing fails closed: nothing is posted or notified', async () => {
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();
  const noCost = { ...SPANS[0], id: 's-nocost', sessionId: 'session-140', costUsd: undefined };

  await assert.rejects(
    () => runMondayNote({
      now: '2026-10-05T08:00:00Z',
      readCards: async () => CARDS,
      readSpans: async () => [noCost],
      discussions,
      notifications,
    }),
    /cost/i,
  );

  assert.equal(discussions.calls.posted.length, 0);
  assert.equal(notifications.sent.length, 0);
});

test('a cost-bearing span that matches no card fails closed: nothing is posted or notified', async () => {
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();
  // A real generation span: the cost lives on `attributes.costContext`, and it
  // names a session no card in this project owns.
  const orphan = {
    id: 's-orphan',
    sessionId: 'session-no-card',
    startedAt: '2026-09-28T02:00:00Z',
    endedAt: '2026-09-28T02:30:00Z',
    attributes: { costContext: { estimatedCost: 0.75, costUnit: 'usd' } },
  };

  await assert.rejects(
    () => runMondayNote({
      now: '2026-10-05T08:00:00Z',
      readCards: async () => CARDS,
      readSpans: async () => [orphan],
      discussions,
      notifications,
    }),
    /uncorrelated|not correlated|correlat/i,
  );

  assert.equal(discussions.calls.posted.length, 0);
  assert.equal(notifications.sent.length, 0);
});

test('before the first Monday after switch-on there is no completed week, so nothing is posted', async () => {
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();
  let reads = 0;

  const result = await runMondayNote({
    now: '2026-09-28T10:00:00Z',
    readCards: async () => { reads += 1; return CARDS; },
    readSpans: async () => { reads += 1; return SPANS; },
    discussions,
    notifications,
  });

  assert.equal(result.posted, false);
  assert.equal(result.reason, 'no completed week');
  assert.equal(reads, 0, 'no reads are needed when there is no completed week');
  assert.equal(discussions.calls.posted.length, 0);
  assert.equal(notifications.sent.length, 0);
});
