// monday-note.test.mjs -- issue #140, seam 1 (Todd approved 2026-09-30):
// the weekly report built from Factory's own card records and Mastra's trace
// costs. The fixtures below are sample records, never live Factory data.
//
// The note is what Todd reads, so the assertions are on the note's own lines:
// what each card cost (failed attempts included), how long it took, and
// whether every step was done by Factory or by him.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMondayNote, publishMondayNote, MONDAY_NOTE_CATEGORY } from './monday-note.mjs';

const WEEK = { from: '2026-09-21T00:00:00Z', to: '2026-09-28T00:00:00Z' };

// A card Todd starts the normal way: his one Intake tap, then Factory does the rest.
const factoryCard = {
  number: 140,
  title: 'Monday note',
  enteredAt: '2026-09-22T09:00:00Z',
  doneAt: '2026-09-22T13:12:00Z',
  movements: [
    { at: '2026-09-22T09:00:00Z', by: 'todd', what: 'started the card' },
    { at: '2026-09-22T13:12:00Z', by: 'factory', what: 'merged the pull request' },
  ],
};

// A card someone moved by hand: this is what "Done by Factory" is for.
const handMovedCard = {
  number: 142,
  title: 'Moved by hand',
  enteredAt: '2026-09-23T09:00:00Z',
  doneAt: '2026-09-23T10:00:00Z',
  movements: [
    { at: '2026-09-23T09:00:00Z', by: 'todd', what: 'started the card' },
    { at: '2026-09-23T10:00:00Z', by: 'todd', what: 'merged the pull request' },
  ],
};

// One plan, one failed build attempt, the build that worked, and the review.
const traces = [
  { id: 's1', card: 140, phase: 'plan', startedAt: '2026-09-22T09:00:00Z', endedAt: '2026-09-22T09:15:00Z', costUsd: 0.4, outcome: 'passed' },
  { id: 's2', card: 140, phase: 'build', startedAt: '2026-09-22T09:15:00Z', endedAt: '2026-09-22T10:57:00Z', costUsd: 3.1, outcome: 'failed-attempt' },
  { id: 's3', card: 140, phase: 'build', startedAt: '2026-09-22T10:57:00Z', endedAt: '2026-09-22T12:30:00Z', costUsd: 2.5, outcome: 'passed' },
  { id: 's4', card: 140, phase: 'review', startedAt: '2026-09-22T12:30:00Z', endedAt: '2026-09-22T13:10:00Z', costUsd: 0.6, outcome: 'passed' },
  { id: 's5', card: 142, phase: 'build', startedAt: '2026-09-23T09:05:00Z', endedAt: '2026-09-23T09:55:00Z', costUsd: 0.9, outcome: 'passed' },
];

test('the note names its category so the publisher can find it', () => {
  assert.equal(MONDAY_NOTE_CATEGORY, 'Monday notes');
});

test('each card gets one line with its trace cost, failed attempts, elapsed time and who did the work', () => {
  const note = buildMondayNote({ cards: [factoryCard, handMovedCard], traces, ...WEEK });

  assert.equal(note.quiet, false);
  assert.deepEqual(
    note.lines.map((line) => line.text),
    [
      '#140 Monday note — $6.60 — 4h 12m — 1 failed attempt — Done by Factory',
      '#142 Moved by hand — $0.90 — 1h — not all by Factory: Todd merged the pull request',
    ],
  );
  assert.equal(note.totalUsd, 7.5);
  assert.equal(note.failedAttempts, 1);
});

test('a card or trace outside the week window is left out of that week\'s note', () => {
  const earlierCard = {
    number: 139,
    title: 'Last week\'s card',
    enteredAt: '2026-09-19T09:00:00Z',
    doneAt: '2026-09-19T10:00:00Z',
    movements: [
      { at: '2026-09-19T09:00:00Z', by: 'todd', what: 'started the card' },
      { at: '2026-09-19T10:00:00Z', by: 'factory', what: 'merged the pull request' },
    ],
  };
  const earlierTrace = { id: 's0', card: 139, phase: 'build', startedAt: '2026-09-19T09:05:00Z', endedAt: '2026-09-19T09:55:00Z', costUsd: 5, outcome: 'passed' };
  // A trace for this week's card that landed after the week closed, plus a
  // stale trace for the earlier card attached to this week's card number.
  const afterWeekTrace = { id: 's6', card: 140, phase: 'review', startedAt: '2026-09-29T09:05:00Z', endedAt: '2026-09-29T09:55:00Z', costUsd: 9, outcome: 'failed-attempt' };

  const note = buildMondayNote({
    cards: [earlierCard, factoryCard],
    traces: [...traces, earlierTrace, afterWeekTrace],
    ...WEEK,
  });

  assert.deepEqual(note.lines.map((line) => line.number), [140]);
  assert.equal(note.totalUsd, 6.6);
  assert.equal(note.failedAttempts, 1);
});

test('the note says where the costs came from and that outside-Factory sessions are excluded', () => {
  const note = buildMondayNote({ cards: [factoryCard, handMovedCard], traces, ...WEEK });

  assert.match(note.body, /Mastra's traces/);
  assert.match(note.body, /outside Factory \(Codex, GPT, or Claude sessions started by hand\) are not counted/);
});

test('a quiet week says so instead of reporting nothing', () => {
  const note = buildMondayNote({ cards: [], traces: [], ...WEEK });

  assert.equal(note.quiet, true);
  assert.equal(note.totalUsd, 0);
  assert.deepEqual(note.lines, []);
  assert.match(note.body, /No cards were accepted this week\./);
  assert.match(note.body, /Total model spend: \$0\.00 across 0 cards\./);
});

test('a card built only by Factory is not blamed for a failed attempt it recovered from', () => {
  const note = buildMondayNote({ cards: [factoryCard], traces, ...WEEK });
  assert.equal(note.lines[0].doneByFactory, true);
  assert.equal(note.lines[0].elapsedMs, 4 * 60 * 60 * 1000 + 12 * 60 * 1000);
  assert.equal(note.lines[0].failedAttempts, 1);
});

// --- Publishing: the two adapters are fakes, so the note never leaves this
// process. GitHub's Discussions API and the phone notification are the only
// outside world the program touches, and each call is counted here.

const DISCUSSION_URL = 'https://github.com/toddwyder/julia-next/discussions/42';

function fakeDiscussions(existing = null) {
  const calls = { found: [], posted: [] };
  return {
    calls,
    find: async (query) => {
      calls.found.push(query);
      return existing;
    },
    post: async (input) => {
      calls.posted.push(input);
      return { url: DISCUSSION_URL };
    },
  };
}

function fakeNotifications() {
  const sent = [];
  return { sent, notify: async (message) => sent.push(message) };
}

test('the note lands in the Monday notes category and Todd is told once, with the link', async () => {
  const note = buildMondayNote({ cards: [factoryCard, handMovedCard], traces, ...WEEK });
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();

  const result = await publishMondayNote({ note, discussions, notifications });

  assert.deepEqual(discussions.calls.found, [{ category: 'Monday notes', title: note.title }]);
  assert.equal(discussions.calls.posted.length, 1);
  assert.deepEqual(discussions.calls.posted[0], {
    category: 'Monday notes',
    title: note.title,
    body: note.body,
  });
  assert.equal(notifications.sent.length, 1);
  assert.equal(notifications.sent[0].url, DISCUSSION_URL);
  assert.deepEqual(result, { posted: true, url: DISCUSSION_URL });
});

test('a quiet week still tells Todd, without inventing a card line', async () => {
  const note = buildMondayNote({ cards: [], traces: [], ...WEEK });
  const discussions = fakeDiscussions();
  const notifications = fakeNotifications();

  await publishMondayNote({ note, discussions, notifications });

  assert.equal(notifications.sent.length, 1);
  assert.equal(notifications.sent[0].body, 'Quiet week.');
});

test('a second run for the same week posts and notifies nothing', async () => {
  const note = buildMondayNote({ cards: [factoryCard], traces, ...WEEK });
  const discussions = fakeDiscussions({ url: DISCUSSION_URL });
  const notifications = fakeNotifications();

  const result = await publishMondayNote({ note, discussions, notifications });

  assert.equal(discussions.calls.posted.length, 0);
  assert.equal(notifications.sent.length, 0);
  assert.deepEqual(result, { posted: false, reason: 'already published', url: DISCUSSION_URL });
});
