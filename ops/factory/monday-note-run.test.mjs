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

import { runMondayNote, runMondayNoteBackfill } from './monday-note-run.mjs';

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

test('a run names a card accepted in an earlier week when its cost and failed attempts land this week', async () => {
  // The weekly job reads a card snapshot and the week's traces. A card accepted
  // last week whose build ran and failed this week must appear in this week's
  // note with this week's cost and failed attempts, and its earlier-week trace
  // must not be attributed to this note.
  const continued = {
    number: 141,
    title: 'Continued card',
    enteredAt: '2026-09-27T09:00:00Z',
    doneAt: '2026-09-28T13:00:00Z',
    stageHistory: [
      { stage: 'planning', enteredAt: '2026-09-27T09:00:00Z', exitedAt: '2026-09-27T09:15:00Z', by: 'agent:r1', exitedBy: 'agent:r1' },
      { stage: 'execute', enteredAt: '2026-09-28T10:00:00Z', exitedAt: '2026-09-28T13:00:00Z', by: 'agent:r2', exitedBy: 'agent:r2' },
    ],
    sessions: { 'session-141': {} },
  };
  const spans = [
    { id: 'old', sessionId: 'session-141', startedAt: '2026-09-27T09:00:00Z', endedAt: '2026-09-27T09:15:00Z', attributes: { costContext: { estimatedCost: 99, costUnit: 'usd' } } },
    { id: 'new', sessionId: 'session-141', startedAt: '2026-09-28T10:00:00Z', endedAt: '2026-09-28T13:00:00Z', spanType: 'model_generation', status: 'error', attributes: { model: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', usage: { inputTokens: 600000, outputTokens: 20000 } } },
  ];
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();

  const result = await runMondayNote({
    now: '2026-10-05T08:00:00Z',
    readCards: async () => [continued],
    readSpans: async ({ from, to }) => spans.filter((span) => span.startedAt >= from && span.startedAt < to),
    discussions,
    notifications,
  });

  const body = discussions.calls.posted[0].body;
  assert.match(body, /#141 Continued card — \$2\.10/);
  assert.match(body, /1 failed attempt/);
  assert.doesNotMatch(body, /\$99/);
  assert.ok(Math.abs(result.note.totalUsd - 2.1) < 1e-12);
  assert.equal(result.note.failedAttempts, 1);
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

test('a trace whose token count is missing records a named gap and the note still publishes', async () => {
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();
  const noCost = { ...SPANS[0], id: 's-nocost', sessionId: 'session-140', spanType: 'model_generation', attributes: { model: 'x' } };

  const result = await runMondayNote({
    now: '2026-10-05T08:00:00Z',
    readCards: async () => CARDS,
    readSpans: async () => [noCost],
    discussions,
    notifications,
  });

  assert.equal(result.posted, true);
  assert.equal(discussions.calls.posted.length, 1);
  assert.match(discussions.calls.posted[0].body, /• No token count: 1 call\(s\)/);
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

// --- Backfill: the weekly job must fill in every missed full week, not only the
// most recent one. The Discussion lookup by title is the cursor, so a week that
// already has its note is skipped and a week that does not is published once.

function discWithExisting(titles) {
  const existing = new Set(titles);
  const calls = { found: [], posted: [] };
  return {
    calls,
    find: async ({ title }) => {
      calls.found.push(title);
      return existing.has(title) ? { url: `https://example.test/${title}` } : null;
    },
    post: async (input) => {
      calls.posted.push(input);
      existing.add(input.title);
      return { url: `https://example.test/${input.title}` };
    },
  };
}

test('a multi-week outage backfills every missed week, oldest first, exactly once', async () => {
  // Observability started Monday 2026-09-28; by Monday 2026-10-19 three full
  // weeks have completed, and only the very first note was ever posted.
  const discussions = discWithExisting(['Monday note — week ending 2026-10-05']);
  const notifications = fakeNotifications();
  const windows = [];

  const result = await runMondayNoteBackfill({
    now: '2026-10-19T09:00:00Z',
    traceRetentionDays: 100,
    readCards: async () => CARDS,
    readSpans: async ({ from, to }) => { windows.push(`${from}..${to}`); return SPANS; },
    discussions,
    notifications,
  });

  assert.deepEqual(result.published.map((p) => p.title), [
    'Monday note — week ending 2026-10-12',
    'Monday note — week ending 2026-10-19',
  ]);
  assert.deepEqual(windows, [
    '2026-10-05T00:00:00.000Z..2026-10-12T00:00:00.000Z',
    '2026-10-12T00:00:00.000Z..2026-10-19T00:00:00.000Z',
  ]);
  // The already-published first week was not re-posted.
  assert.equal(discussions.calls.posted.length, 2);
  // One notification for the backlog, not one per week.
  assert.equal(notifications.sent.length, 1);
  assert.match(notifications.sent[0].body, /2 missed weeks backfilled/);
});

test('an expired missing week fails before reading traces or posting a misleading note', async () => {
  const issues = fakeIssues();
  let traceReads = 0;
  await assert.rejects(() => runMondayNoteBackfill({
    now: '2026-10-19T09:00:00Z',
    readCards: async () => CARDS,
    readSpans: async () => { traceReads += 1; return []; },
    issues,
  }), /retention|expired/i);
  assert.equal(traceReads, 0);
  assert.equal(issues.calls.posted.length, 0);
});

test('re-running the backfill posts and notifies nothing when no week is missing', async () => {
  const discussions = discWithExisting([
    'Monday note — week ending 2026-10-05',
    'Monday note — week ending 2026-10-12',
    'Monday note — week ending 2026-10-19',
  ]);
  const notifications = fakeNotifications();

  const result = await runMondayNoteBackfill({
    now: '2026-10-19T23:00:00Z',
    readCards: async () => CARDS,
    readSpans: async () => SPANS,
    discussions,
    notifications,
  });

  assert.deepEqual(result.published, []);
  assert.equal(result.posted, false);
  assert.equal(discussions.calls.posted.length, 0);
  assert.equal(notifications.sent.length, 0, 'a repeated fire must not notify twice');
});

test('a long outage is bounded per run and the next run continues without skipping a week', async () => {
  // Ten missed weeks, a batch of three: the first run posts the three oldest,
  // the next run continues from the fourth, so nothing is skipped or duplicated.
  const discussions = discWithExisting([]);
  const notifications = fakeNotifications();
  const seen = [];

  const first = await runMondayNoteBackfill({
    now: '2026-12-07T09:00:00Z',
    traceRetentionDays: 100,
    readCards: async () => CARDS,
    readSpans: async ({ from }) => { seen.push(from); return SPANS; },
    discussions,
    notifications,
    maxWeeksPerRun: 3,
  });

  assert.equal(first.published.length, 3);
  assert.ok(first.remaining > 0);
  assert.equal(first.published[0].from, '2026-09-28T00:00:00.000Z');

  const second = await runMondayNoteBackfill({
    now: '2026-12-07T09:00:00Z',
    traceRetentionDays: 100,
    readCards: async () => CARDS,
    readSpans: async ({ from }) => { seen.push(from); return SPANS; },
    discussions,
    notifications,
    maxWeeksPerRun: 3,
  });

  // The second run starts exactly where the first stopped.
  assert.equal(second.published[0].from, first.published.at(-1).to);
  const posted = discussions.calls.posted.map((p) => p.title);
  assert.equal(new Set(posted).size, posted.length, 'no week is posted twice');
  assert.ok(seen.length >= 6);
});

test('a failed read during backfill fails closed: nothing is posted or notified', async () => {
  const discussions = discWithExisting([]);
  const notifications = fakeNotifications();

  await assert.rejects(
    () => runMondayNoteBackfill({
      now: '2026-10-19T09:00:00Z',
      traceRetentionDays: 100,
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

// --- Issue #180: GitHub Issues route (retired Discord notification)

function fakeIssues({ existing = null } = {}) {
  const calls = { found: [], posted: [] };
  const issues = new Map();
  if (existing) {
    for (const [title, item] of Object.entries(existing)) {
      issues.set(title, item);
    }
  }
  return {
    calls,
    find: async ({ title }) => {
      calls.found.push(title);
      return issues.get(title) ?? null;
    },
    post: async ({ title, body }) => {
      calls.posted.push({ title, body });
      const item = { id: 100 + calls.posted.length, number: 200 + calls.posted.length, title, url: `https://github.com/o/r/issues/${200 + calls.posted.length}` };
      issues.set(title, item);
      return item;
    },
  };
}

test('runMondayNote publishes to GitHub issues with factory:machine label and does not require Discord', async () => {
  const issues = fakeIssues();

  const result = await runMondayNote({
    now: '2026-10-05T08:00:00Z',
    readCards: async () => CARDS,
    readSpans: async () => SPANS,
    issues,
  });

  assert.equal(result.posted, true);
  assert.equal(issues.calls.posted.length, 1);
  assert.match(issues.calls.posted[0].title, /Monday note — week ending 2026-10-05/);
  assert.match(issues.calls.posted[0].body, /#140 Monday note/);
  assert.match(result.url, /https:\/\/github\.com\/o\/r\/issues\/201/);
});

test('runMondayNoteBackfill backfills missing weeks over GitHub issues', async () => {
  const issues = fakeIssues({
    existing: {
      'Monday note — week ending 2026-10-05': { id: 100, number: 180, title: 'Monday note — week ending 2026-10-05', url: 'https://github.com/o/r/issues/180' },
    },
  });

  const result = await runMondayNoteBackfill({
    now: '2026-10-19T09:00:00Z',
    traceRetentionDays: 100,
    readCards: async () => CARDS,
    readSpans: async () => SPANS,
    issues,
  });

  assert.equal(result.posted, true);
  assert.deepEqual(result.published.map((p) => p.title), [
    'Monday note — week ending 2026-10-12',
    'Monday note — week ending 2026-10-19',
  ]);
  assert.equal(issues.calls.posted.length, 2);
});
