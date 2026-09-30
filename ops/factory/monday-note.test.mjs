// monday-note.test.mjs -- issue #140, seam 1 (Todd approved 2026-09-30):
// the weekly report built from Factory's own card records and Mastra's trace
// costs. The fixtures below are sample records, never live Factory data.
//
// The note is what Todd reads, so the assertions are on the note's own lines:
// what each card cost (failed attempts included), how long it took, and
// whether every step was done by Factory or by him.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMondayNote, publishMondayNote, MONDAY_NOTE_CATEGORY, previousWeekWindow } from './monday-note.mjs';

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

// The same card in Factory's own record shape: server-appended `stageHistory`
// with the actor that entered and left each stage (`by` / `exitedBy`), which is
// what the note must read instead of a hand-shaped list.
const stagedCard = {
  number: 140,
  title: 'Monday note',
  stages: ['done'],
  createdAt: '2026-09-22T09:00:00Z',
  acceptedAt: '2026-09-22T09:00:00Z',
  sessions: { 'session-140': { sessionId: 'session-140', threadId: 't', branch: 'b', startedBy: 'todd' } },
  stageHistory: [
    { stage: 'planning', enteredAt: '2026-09-22T09:00:00Z', exitedAt: '2026-09-22T09:15:00Z', by: 'agent:run-1', exitedBy: 'agent:run-1' },
    { stage: 'execute', enteredAt: '2026-09-22T09:15:00Z', exitedAt: '2026-09-22T12:30:00Z', by: 'agent:run-1', exitedBy: 'agent:run-2' },
    { stage: 'review', enteredAt: '2026-09-22T12:30:00Z', exitedAt: '2026-09-22T13:10:00Z', by: 'agent:run-2', exitedBy: 'agent:run-3' },
    { stage: 'done', enteredAt: '2026-09-22T13:12:00Z', by: 'agent:run-3' },
  ],
};

test('each step is named with its actor, not just the card total', () => {
  const note = buildMondayNote({ cards: [stagedCard], traces: traces.filter((trace) => trace.card === 140), ...WEEK });

  assert.deepEqual(
    note.lines[0].steps.map((step) => step.text),
    [
      'plan — Factory — $0.40 — 15m',
      'build — Factory — $5.60 — 3h 15m — 1 failed attempt',
      'review — Factory — $0.60 — 40m',
      'done — Factory — $0.00',
    ],
  );
});

test('the rendered body visibly contains every card step, its actor, its time, the card cost and the total elapsed', () => {
  // Returned metadata is not enough: Todd reads the posted Discussion body, so
  // every step the note knows about must appear there, with the actor who did
  // it and the step's own time when Factory recorded one. The card line must
  // carry the card's cost (failed attempts included) and the total elapsed.
  const note = buildMondayNote({ cards: [stagedCard], traces: traces.filter((trace) => trace.card === 140), ...WEEK });

  for (const step of note.lines[0].steps) {
    assert.ok(note.body.includes(step.text), `body is missing step line: ${step.text}`);
  }
  // The actor and the step time are in the body, not only in metadata.
  assert.match(note.body, /plan — Factory — \$0\.40 — 15m/);
  assert.match(note.body, /build — Factory — \$5\.60 — 3h 15m — 1 failed attempt/);
  assert.match(note.body, /#140 Monday note — \$6\.60 — 4h 12m — 1 failed attempt — Done by Factory/);
});

test('the body names a hand-moved step with the person, not Factory', () => {
  const byHand = {
    ...stagedCard,
    number: 142,
    stageHistory: [
      { stage: 'planning', enteredAt: '2026-09-23T09:00:00Z', exitedAt: '2026-09-23T09:30:00Z', by: 'agent:run-1', exitedBy: 'agent:run-1' },
      { stage: 'done', enteredAt: '2026-09-23T09:30:00Z', by: 'todd', exitedBy: 'todd' },
    ],
  };
  const note = buildMondayNote({ cards: [byHand], traces: [], ...WEEK });

  assert.match(note.body, /done — Todd/);
  assert.match(note.body, /not all by Factory: Todd done/);
});

test('a step moved by hand names the person, not Factory', () => {
  const byHand = {
    ...stagedCard,
    number: 142,
    stageHistory: [
      { stage: 'planning', enteredAt: '2026-09-23T09:00:00Z', exitedAt: '2026-09-23T09:30:00Z', by: 'agent:run-1', exitedBy: 'agent:run-1' },
      { stage: 'done', enteredAt: '2026-09-23T09:30:00Z', by: 'todd', exitedBy: 'todd' },
    ],
  };
  const note = buildMondayNote({ cards: [byHand], traces: [], ...WEEK });

  assert.deepEqual(note.lines[0].steps.map((step) => step.text), [
    'plan — Factory — $0.00 — 30m',
    'done — Todd — $0.00',
  ]);
  assert.equal(note.lines[0].doneByFactory, false);
});

test('a card costs each of its traces exactly once across its steps', () => {
  // Every trace in the week belongs to a card in the note, so the card-cost sum
  // is the whole spend and no cost lands outside a card.
  const card140Traces = traces.filter((trace) => trace.card === 140);
  const note = buildMondayNote({ cards: [stagedCard], traces: card140Traces, ...WEEK });

  assert.equal(note.lines[0].costUsd, 6.6);
  assert.equal(note.lines[0].steps.reduce((sum, step) => sum + step.costUsd, 0), 6.6);
  assert.equal(note.uncorrelatedUsd, 0);
  assert.equal(note.totalUsd, 6.6);
});

test('the initial report covers every card since observability was switched on', () => {
  // Observability started Monday 2026-09-28. The first note is the first Monday
  // after it (2026-10-05), whose one full week [09-28, 10-05) covers every card
  // since switch-on; a card from before it is not invented into the window, and
  // no separate partial-week note can overlap it.
  const inWindow = { ...stagedCard, number: 141, enteredAt: '2026-09-28T09:00:00Z' };
  const later = { ...stagedCard, number: 137, enteredAt: '2026-10-04T09:00:00Z' };
  const before = { ...stagedCard, number: 139, enteredAt: '2026-09-20T09:00:00Z' };
  const window = previousWeekWindow({ now: '2026-10-05T08:00:00Z' });

  const note = buildMondayNote({ cards: [inWindow, later, before], traces: [], ...window });

  assert.deepEqual(note.lines.map((line) => line.number), [141, 137]);
  // The pre-switch-on card is in no note.
  const earlier = buildMondayNote({ cards: [before], traces: [], ...previousWeekWindow({ now: '2026-09-28T10:00:00Z' }) });
  assert.deepEqual(earlier.lines, []);
});

test('splitting the period into weeks counts every card and trace exactly once', () => {
  const cardA = { ...stagedCard, number: 140, enteredAt: '2026-09-22T09:00:00Z' };
  const cardB = { ...stagedCard, number: 141, enteredAt: '2026-09-29T09:00:00Z' };
  const weekA = { from: '2026-09-20T00:00:00Z', to: '2026-09-27T00:00:00Z' };
  const weekB = { from: '2026-09-27T00:00:00Z', to: '2026-10-04T00:00:00Z' };
  // Every trace is correlated to a card in the note, so the card-cost sum is
  // the whole spend and no trace is attributed outside its week.
  const traceA = { id: 'a1', card: 140, phase: 'plan', startedAt: '2026-09-22T09:00:00Z', endedAt: '2026-09-22T09:15:00Z', costUsd: 1, outcome: 'passed' };
  const traceB = { id: 'b1', card: 141, phase: 'build', startedAt: '2026-09-29T09:05:00Z', endedAt: '2026-09-29T09:55:00Z', costUsd: 2, outcome: 'passed' };
  const allTraces = [traceA, traceB];

  const first = buildMondayNote({ cards: [cardA, cardB], traces: allTraces, ...weekA });
  const second = buildMondayNote({ cards: [cardA, cardB], traces: allTraces, ...weekB });

  const counted = [...first.lines, ...second.lines].map((line) => line.number);
  assert.deepEqual(counted, [140, 141]);
  assert.equal(new Set(counted).size, counted.length, 'a card appears in exactly one week');
  assert.equal(first.lines[0].costUsd, 1);
  assert.equal(second.lines[0].costUsd, 2);
  assert.equal(first.totalUsd + second.totalUsd, 3);
  assert.equal(first.uncorrelatedUsd, 0);
  assert.equal(second.uncorrelatedUsd, 0);
});

test('an uncorrelated cost-bearing span fails closed instead of being reported or dropped', () => {
  // A model span that names no card is a correlation failure: folding it onto a
  // card would lie, and printing it as its own line would still publish a note
  // whose card totals may be wrong. The whole note fails instead.
  const orphan = { id: 's9', card: null, correlated: false, phase: 'build', startedAt: '2026-09-22T10:00:00Z', endedAt: '2026-09-22T10:30:00Z', costUsd: 1.25, outcome: 'passed' };
  const card140Traces = traces.filter((trace) => trace.card === 140);

  assert.throws(
    () => buildMondayNote({ cards: [stagedCard], traces: [...card140Traces, orphan], ...WEEK }),
    /uncorrelated|not matched|correlat/i,
  );
});

test('a cost-bearing trace for a card outside the week fails closed, not added to another card', () => {
  const trace99 = { id: 's99', card: 99, phase: 'build', startedAt: '2026-09-22T10:00:00Z', endedAt: '2026-09-22T10:30:00Z', costUsd: 2, outcome: 'passed' };
  const card140Traces = traces.filter((trace) => trace.card === 140);

  assert.throws(
    () => buildMondayNote({ cards: [stagedCard], traces: [...card140Traces, trace99], ...WEEK }),
    /uncorrelated|not matched|correlat/i,
  );
});

test('a correlated trace with no numeric estimated cost fails closed, never becomes $0', () => {
  const noCost = { id: 's-nocost', card: 140, phase: 'build', startedAt: '2026-09-22T10:00:00Z', endedAt: '2026-09-22T10:30:00Z', costUsd: null, outcome: 'passed' };
  const card140Traces = traces.filter((trace) => trace.card === 140);

  assert.throws(
    () => buildMondayNote({ cards: [stagedCard], traces: [...card140Traces, noCost], ...WEEK }),
    /cost/i,
  );
});

test('an uncorrelated cost-bearing span with no numeric cost fails closed', () => {
  // The old behaviour listed this as "$0.00 not matched to a card". A model
  // span whose cost Mastra did not record is a failed read: it must not be
  // shown as free, and it must not be dropped. The whole note fails.
  const orphanModel = {
    id: 's10',
    card: null,
    correlated: false,
    costBearing: true,
    phase: 'build',
    startedAt: '2026-09-22T10:00:00Z',
    endedAt: '2026-09-22T10:30:00Z',
    costUsd: null,
    outcome: 'passed',
  };
  const card140Traces = traces.filter((trace) => trace.card === 140);

  assert.throws(
    () => buildMondayNote({ cards: [stagedCard], traces: [...card140Traces, orphanModel], ...WEEK }),
    /cost|correlat/i,
  );
});

test('an unlabelled uncorrelated span with no numeric cost is treated as cost-bearing and fails closed', () => {
  // A normalised record always declares `costBearing`. Anything that does not
  // (a hand-shaped span) cannot be proven free, so it fails closed too.
  const unlabelled = { id: 's11', card: null, correlated: false, phase: 'build', startedAt: '2026-09-22T10:00:00Z', endedAt: '2026-09-22T10:30:00Z', costUsd: null, outcome: 'passed' };
  const card140Traces = traces.filter((trace) => trace.card === 140);

  assert.throws(
    () => buildMondayNote({ cards: [stagedCard], traces: [...card140Traces, unlabelled], ...WEEK }),
    /cost|correlat/i,
  );
});

test('a non-cost-bearing span with no cost may be uncorrelated without printing $0.00', () => {
  // A tool/RAG/processor span with no costContext is not billed. It can be
  // uncorrelated, but the body must never invent a $0.00 spend for it.
  const toolSpan = { id: 's12', card: null, correlated: false, costBearing: false, phase: 'build', startedAt: '2026-09-22T10:00:00Z', endedAt: '2026-09-22T10:30:00Z', costUsd: null, outcome: 'passed' };
  const card140Traces = traces.filter((trace) => trace.card === 140);
  const note = buildMondayNote({ cards: [stagedCard], traces: [...card140Traces, toolSpan], ...WEEK });

  assert.equal(note.totalUsd, 6.6);
  assert.doesNotMatch(note.body, /Not matched to a card: \$0\.00/);
});

test('a numeric zero estimated cost is valid and never fails the note', () => {
  const zeroCost = { id: 's-zero', card: 140, phase: 'plan', startedAt: '2026-09-22T09:00:00Z', endedAt: '2026-09-22T09:15:00Z', costUsd: 0, outcome: 'passed' };
  const note = buildMondayNote({ cards: [stagedCard], traces: [zeroCost], ...WEEK });

  assert.equal(note.lines[0].costUsd, 0);
  assert.equal(note.totalUsd, 0);
});

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

test('the scheduled week is the last completed Monday-to-Monday week', () => {
  // Minted on Monday 2026-10-05: the week that just ended, starting at the
  // first Monday after observability was switched on (2026-09-28).
  assert.deepEqual(previousWeekWindow({ now: '2026-10-05T09:00:00Z' }), {
    from: '2026-09-28T00:00:00.000Z',
    to: '2026-10-05T00:00:00.000Z',
  });

  // A timer that fires later the same Monday reports the same week, not a
  // half-empty one.
  assert.deepEqual(previousWeekWindow({ now: '2026-10-05T23:59:00Z' }), {
    from: '2026-09-28T00:00:00.000Z',
    to: '2026-10-05T00:00:00.000Z',
  });

  // Before the first Monday after switch-on there is no completed week. The
  // window is empty at switch-on rather than a partial week, so the first full
  // week cannot count the same card twice.
  assert.deepEqual(previousWeekWindow({ now: '2026-09-28T10:00:00Z' }), {
    from: '2026-09-28T00:00:00.000Z',
    to: '2026-09-28T00:00:00.000Z',
  });
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
  // stale trace for the earlier card attached to this week's card number. Both
  // are outside the window, so neither is in this note at all.
  const afterWeekTrace = { id: 's6', card: 140, phase: 'review', startedAt: '2026-09-29T09:05:00Z', endedAt: '2026-09-29T09:55:00Z', costUsd: 9, outcome: 'failed-attempt' };
  const factoryCardTraces = traces.filter((trace) => trace.card === 140);

  const note = buildMondayNote({
    cards: [earlierCard, factoryCard],
    traces: [...factoryCardTraces, earlierTrace, afterWeekTrace],
    ...WEEK,
  });

  assert.deepEqual(note.lines.map((line) => line.number), [140]);
  assert.equal(note.lines[0].costUsd, 6.6);
  assert.equal(note.uncorrelatedUsd, 0);
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
  const note = buildMondayNote({ cards: [factoryCard], traces: traces.filter((trace) => trace.card === 140), ...WEEK });
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
  const note = buildMondayNote({ cards: [factoryCard], traces: traces.filter((trace) => trace.card === 140), ...WEEK });
  const discussions = fakeDiscussions({ url: DISCUSSION_URL });
  const notifications = fakeNotifications();

  const result = await publishMondayNote({ note, discussions, notifications });

  assert.equal(discussions.calls.posted.length, 0);
  assert.equal(notifications.sent.length, 0);
  assert.deepEqual(result, { posted: false, reason: 'already published', url: DISCUSSION_URL });
});
