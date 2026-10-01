// monday-note.test.mjs -- issue #140, seam 1 (Todd approved 2026-09-30):
// the weekly report built from Factory's own card records and Mastra's trace
// costs. The fixtures below are sample records, never live Factory data.
//
// The note is what Todd reads, so the assertions are on the note's own lines:
// what each card cost (failed attempts included), how long it took, and
// whether every step was done by Factory or by him.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMondayNote, publishMondayNote, MONDAY_NOTE_CATEGORY, previousWeekWindow, completedWeeks } from './monday-note.mjs';

const WEEK = { from: '2026-09-21T00:00:00Z', to: '2026-09-28T00:00:00Z' };

test('invalid token breakdowns stay gaps and project overhead contributes to face totals', () => {
  const invalid = { id: 'invalid', card: 180, startedAt: '2026-09-22T10:00:00Z', phase: 'build', costBearing: true,
    model: 'broken-count', provider: 'deepseek', namedGaps: ['invalid_token_count'], tokens: { freshInput: 0, cachedInput: 500, output: 10, thinking: 0 } };
  const overhead = { id: 'overhead', card: null, projectOverhead: true, startedAt: invalid.startedAt, costBearing: true,
    model: 'measured', provider: 'openai', whatYouPayCost: 0, faceCost: 5, tokens: { freshInput: 100, cachedInput: 0, output: 10, thinking: 0 } };
  const note = buildMondayNote({ cards: [{ number: 180, title: 'Invalid', enteredAt: invalid.startedAt }], traces: [invalid, overhead], ...WEEK });
  assert.match(note.body, /broken-count \(deepseek\): invalid token count \(no token count\)/);
  assert.doesNotMatch(note.body, /500 cached/);
  assert.equal(note.faceTotalUsd, 5);
});

test('missing usage and missing board phase remain gaps beside a recorded reviewer call', () => {
  const note = buildMondayNote({ cards: [{ number: 'PR-184', title: 'Open review', enteredAt: '2026-09-22T09:00:00Z',
    stageHistory: [{ stage: 'intake', by: 'factory', enteredAt: '2026-09-22T09:00:00Z' }] }],
    traces: [{ id: 'missing-usage', card: 'PR-184', startedAt: '2026-09-22T10:00:00Z',
      phase: 'review', costBearing: true, model: 'deepseek-v4-pro', provider: 'deepseek', namedGaps: ['no_token_count'] }], ...WEEK });
  assert.doesNotMatch(note.body, /0 thinking tokens|Done by Factory/);
  assert.match(note.body, /review.*no recorded board step/);
  assert.match(note.body, /no token count thinking tokens/);
  assert.match(note.body, /steps\/run: no recorded run count/);
});

test('a phase snapshot supplies effort even when its model traces are missing', () => {
  const note = buildMondayNote({ cards: [{ number: 180, title: 'Recorded phase', enteredAt: '2026-09-22T09:00:00Z',
    stageHistory: [{ stage: 'planning', by: 'factory', enteredAt: '2026-09-22T09:00:00Z', exitedAt: '2026-09-22T10:00:00Z' }],
    phaseSnapshots: [{ threadId: 'thread', at: '2026-09-22T09:10:00Z', effort: 'high', model: 'openai/gpt-6-sol', phase: 'Planning' }]
  }], traces: [], ...WEEK });
  assert.match(note.body, /effort: high/);
});

test('a card with no recorded model calls shows named gaps at card, step, effort and token drivers', () => {
  const note = buildMondayNote({ cards: [{ number: 180, title: 'Unmeasured', enteredAt: '2026-09-22T09:00:00Z',
    stageHistory: [{ stage: 'execute', by: 'factory', enteredAt: '2026-09-22T09:00:00Z' }] }], traces: [], ...WEEK });
  assert.doesNotMatch(note.body, /\$0\.00/);
  assert.match(note.body, /no recorded model calls/);
  assert.match(note.body, /effort: no recorded effort/);
  assert.match(note.body, /tokens\/step: no token count/);
  assert.match(note.body, /cached input: no token count/);
});

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
      'plan — Factory — $0.40 — 15m — effort: no recorded effort (no token count thinking tokens)',
      'build — Factory — $5.60 — 3h 15m — 1 failed attempt — effort: no recorded effort (no token count thinking tokens)',
      'review — Factory — $0.60 — 40m — effort: no recorded effort (no token count thinking tokens)',
      'done — Factory — no recorded model calls — effort: no recorded effort (no token count thinking tokens)',
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
    'plan — Factory — no recorded model calls — 30m — effort: no recorded effort (no token count thinking tokens)',
    'done — Todd — no recorded model calls — effort: no recorded effort (no token count thinking tokens)',
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

test('backfill does not include future steps or future elapsed time', () => {
  const card = {
    number: 401, title: 'Cross-week build', enteredAt: '2026-09-22T09:00:00Z',
    doneAt: '2026-09-29T12:00:00Z',
    stageHistory: [
      { stage: 'planning', enteredAt: '2026-09-22T09:00:00Z', exitedAt: '2026-09-22T09:30:00Z', by: 'agent:a', exitedBy: 'agent:a' },
      { stage: 'execute', enteredAt: '2026-09-29T09:00:00Z', exitedAt: '2026-09-29T12:00:00Z', by: 'agent:a', exitedBy: 'todd' },
    ],
  };
  const first = buildMondayNote({ cards: [card], traces: [], from: '2026-09-21T00:00:00Z', to: '2026-09-28T00:00:00Z' });
  assert.equal(first.lines.length, 1);
  assert.equal(first.lines[0].doneByFactory, true);
  assert.equal(first.lines[0].elapsedMs, 30 * 60 * 1000);
  assert.doesNotMatch(first.body, /build — Todd/);
  const second = buildMondayNote({ cards: [card], traces: [], from: '2026-09-28T00:00:00Z', to: '2026-10-05T00:00:00Z' });
  assert.equal(second.lines.length, 1, 'a trace-free hand move is still reported in its week');
  assert.equal(second.lines[0].doneByFactory, false);
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

test('completedWeeks lists every full week since switch-on, oldest first', () => {
  // Switch-on Monday is 2026-09-28. On Monday 2026-10-19, three full weeks
  // have completed; before the first Monday after switch-on there are none.
  assert.deepEqual(completedWeeks({ now: '2026-09-28T10:00:00Z' }), []);
  assert.deepEqual(completedWeeks({ now: '2026-10-05T09:00:00Z' }), [
    { from: '2026-09-28T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' },
  ]);
  assert.deepEqual(completedWeeks({ now: '2026-10-19T23:59:00Z' }), [
    { from: '2026-09-28T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' },
    { from: '2026-10-05T00:00:00.000Z', to: '2026-10-12T00:00:00.000Z' },
    { from: '2026-10-12T00:00:00.000Z', to: '2026-10-19T00:00:00.000Z' },
  ]);
  // Weeks are contiguous and non-overlapping, so no card is counted twice.
  const weeks = completedWeeks({ now: '2026-11-02T09:00:00Z' });
  for (let i = 1; i < weeks.length; i += 1) {
    assert.equal(weeks[i].from, weeks[i - 1].to);
  }
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

test('a card accepted earlier is included in the week its cost and failed attempts landed in', () => {
  // A card that entered last week but whose build runs this week is this
  // week's work: the note must name it, attribute only this week's cost and
  // failed attempts, and never hide the trace by dropping the card (which
  // would fail closed as uncorrelated).
  const continued = {
    number: 200,
    title: 'Continued from last week',
    enteredAt: '2026-09-19T09:00:00Z',
    doneAt: '2026-09-22T13:00:00Z',
    stageHistory: [
      { stage: 'planning', enteredAt: '2026-09-19T09:00:00Z', exitedAt: '2026-09-19T09:15:00Z', by: 'agent:r1', exitedBy: 'agent:r1' },
      { stage: 'execute', enteredAt: '2026-09-22T10:00:00Z', exitedAt: '2026-09-22T12:30:00Z', by: 'agent:r2', exitedBy: 'agent:r2' },
    ],
  };
  // A trace for the same card that landed last week must NOT count this week.
  const lastWeekTrace = { id: 'old', card: 200, phase: 'plan', startedAt: '2026-09-19T09:05:00Z', endedAt: '2026-09-19T09:15:00Z', costUsd: 99, outcome: 'passed' };
  const thisWeekTrace = { id: 'new', card: 200, phase: 'build', startedAt: '2026-09-22T10:00:00Z', endedAt: '2026-09-22T12:30:00Z', costUsd: 2, outcome: 'failed-attempt' };

  const note = buildMondayNote({ cards: [continued], traces: [lastWeekTrace, thisWeekTrace], ...WEEK });

  assert.deepEqual(note.lines.map((line) => line.number), [200]);
  // Only this week's trace is attributed: not the 99 dollars spent before the week.
  assert.equal(note.lines[0].costUsd, 2);
  assert.equal(note.lines[0].failedAttempts, 1);
  assert.equal(note.totalUsd, 2);
  assert.equal(note.failedAttempts, 1);
  // The card's elapsed time is this week's activity (10:00 build start to the
  // 13:00 completion), not its whole lifetime back to the 19th.
  assert.equal(note.lines[0].elapsedMs, 3 * 60 * 60 * 1000);
});

test('a card accepted earlier still says not all by Factory when Todd moved a step by hand before the week', () => {
  // The classification is about every step after Todd's Intake tap, whether or
  // not that step falls in the week being reported. This card entered last
  // week; Todd closed its plan stage by hand (a hand move on a later step, not
  // his Intake tap), then Factory built this week. The week's visible steps are
  // all Factory, but the card is not "Done by Factory" -- reading only the
  // filtered week steps would wrongly claim it was.
  const card = {
    number: 302,
    title: 'Hand move last week',
    enteredAt: '2026-09-19T09:00:00Z',
    doneAt: '2026-09-23T10:00:00Z',
    stageHistory: [
      // `by` is the Intake move (Factory's first processing stage); `exitedBy`
      // is Todd closing that stage himself -- a hand move, not the Intake tap.
      { stage: 'planning', enteredAt: '2026-09-19T09:00:00Z', exitedAt: '2026-09-19T09:15:00Z', by: 'agent:r1', exitedBy: 'todd' },
      { stage: 'execute', enteredAt: '2026-09-23T09:00:00Z', exitedAt: '2026-09-23T09:30:00Z', by: 'agent:r2', exitedBy: 'agent:r2' },
    ],
  };
  const buildTrace = { id: 'b', card: 302, phase: 'build', startedAt: '2026-09-23T09:05:00Z', endedAt: '2026-09-23T09:25:00Z', costUsd: 2, outcome: 'passed' };

  const note = buildMondayNote({ cards: [card], traces: [buildTrace], ...WEEK });

  assert.equal(note.lines[0].doneByFactory, false);
  assert.match(note.body, /not all by Factory: Todd/);
});

test('a card accepted earlier says not all by Factory when Todd acts in the week', () => {
  // The reviewer's case: a card accepted before the week where Todd's hand move
  // is the first step the week shows, then Factory builds. The week's filtered
  // steps start with Todd's move, not with the Intake tap, so slicing the
  // filtered list drops the one hand move and falsely reports "Done by
  // Factory". Classification must read all the card's steps.
  const card = {
    number: 303,
    title: 'Todd approves plan in week',
    enteredAt: '2026-09-19T09:00:00Z',
    doneAt: '2026-09-23T10:00:00Z',
    stageHistory: [
      { stage: 'planning', enteredAt: '2026-09-19T09:00:00Z', exitedAt: '2026-09-19T09:15:00Z', by: 'agent:r1', exitedBy: 'agent:r1' },
      // Todd closes the planning stage by hand in the week; the next stage
      // enters in the week too, so the filtered week steps start with Todd.
      { stage: 'planning', enteredAt: '2026-09-23T09:00:00Z', exitedAt: '2026-09-23T09:15:00Z', by: 'agent:r1', exitedBy: 'todd' },
      { stage: 'execute', enteredAt: '2026-09-23T09:15:00Z', exitedAt: '2026-09-23T09:30:00Z', by: 'agent:r2', exitedBy: 'agent:r2' },
    ],
  };
  const weekTrace = { id: 'w', card: 303, phase: 'build', startedAt: '2026-09-23T09:16:00Z', endedAt: '2026-09-23T09:28:00Z', costUsd: 1, outcome: 'passed' };

  const note = buildMondayNote({ cards: [card], traces: [weekTrace], ...WEEK });

  assert.equal(note.lines[0].doneByFactory, false);
  assert.match(note.body, /not all by Factory: Todd/);
});

test('a card with no cost or activity in the week is left out even when it entered earlier', () => {
  const staleCard = {
    number: 201,
    title: 'Idle since last week',
    enteredAt: '2026-09-01T09:00:00Z',
    doneAt: '2026-09-01T10:00:00Z',
    movements: [
      { at: '2026-09-01T09:00:00Z', by: 'todd', what: 'started the card' },
      { at: '2026-09-01T10:00:00Z', by: 'factory', what: 'merged the pull request' },
    ],
  };

  const note = buildMondayNote({ cards: [staleCard], traces: [], ...WEEK });

  assert.deepEqual(note.lines, []);
  assert.equal(note.quiet, true);
});

test('an earlier accepted card appears in exactly one week of the split period', () => {
  // The card entered last week, so it is last week's acceptance; only the
  // activity this week brings it into this week's note. Both notes together
  // name the card once per its active week and no trace is counted twice.
  const continued = {
    number: 200,
    title: 'Continued from last week',
    enteredAt: '2026-09-22T09:00:00Z',
    doneAt: '2026-09-29T13:00:00Z',
    movements: [
      { at: '2026-09-22T09:00:00Z', by: 'todd', what: 'started the card' },
      { at: '2026-09-29T13:00:00Z', by: 'factory', what: 'merged the pull request' },
    ],
  };
  const firstTrace = { id: 'first', card: 200, phase: 'plan', startedAt: '2026-09-22T09:00:00Z', endedAt: '2026-09-22T09:15:00Z', costUsd: 1, outcome: 'passed' };
  const secondTrace = { id: 'second', card: 200, phase: 'build', startedAt: '2026-09-29T09:00:00Z', endedAt: '2026-09-29T09:30:00Z', costUsd: 2, outcome: 'failed-attempt' };
  const weekA = { from: '2026-09-21T00:00:00Z', to: '2026-09-28T00:00:00Z' };
  const weekB = { from: '2026-09-28T00:00:00Z', to: '2026-10-05T00:00:00Z' };

  const first = buildMondayNote({ cards: [continued], traces: [firstTrace, secondTrace], ...weekA });
  const second = buildMondayNote({ cards: [continued], traces: [firstTrace, secondTrace], ...weekB });

  assert.deepEqual(first.lines.map((line) => line.number), [200]);
  assert.deepEqual(second.lines.map((line) => line.number), [200]);
  assert.equal(first.lines[0].costUsd, 1);
  assert.equal(first.lines[0].failedAttempts, 0);
  assert.equal(second.lines[0].costUsd, 2);
  assert.equal(second.lines[0].failedAttempts, 1);
  assert.equal(first.totalUsd + second.totalUsd, 3, 'no trace cost is counted twice');
  assert.equal(first.failedAttempts + second.failedAttempts, 1);
});

test('a card in the week is named once even when it has several traces in that week', () => {
  const note = buildMondayNote({ cards: [stagedCard], traces: traces.filter((trace) => trace.card === 140), ...WEEK });

  assert.equal(note.lines.filter((line) => line.number === 140).length, 1);
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

// --- Issue #180 tests: what-you-pay cost, step/model breakdown, effort, drivers, provider totals, named gaps

const richTraces = [
  {
    id: 't1',
    card: 140,
    phase: 'plan',
    startedAt: '2026-09-22T09:00:00Z',
    endedAt: '2026-09-22T09:15:00Z',
    provider: 'deepseek',
    model: 'deepseek/deepseek-chat',
    whatYouPayCost: 0.05,
    faceCost: 0.05,
    costUsd: 0.05,
    payFactor: 1.0,
    tokens: { freshInput: 10000, cachedInput: 40000, output: 2000, thinking: 0, total: 52000 },
    effort: null,
    namedGaps: ['no_recorded_effort'],
    outcome: 'passed',
    costBearing: true,
  },
  {
    id: 't2',
    card: 140,
    phase: 'build',
    startedAt: '2026-09-22T09:15:00Z',
    endedAt: '2026-09-22T10:57:00Z',
    provider: 'deepseek',
    model: 'deepseek/deepseek-reasoner',
    whatYouPayCost: 0.30,
    faceCost: 0.30,
    costUsd: 0.30,
    payFactor: 1.0,
    tokens: { freshInput: 20000, cachedInput: 80000, output: 10000, thinking: 4000, total: 110000 },
    effort: null,
    namedGaps: ['no_recorded_effort'],
    outcome: 'failed-attempt',
    costBearing: true,
  },
  {
    id: 't3',
    card: 140,
    phase: 'build',
    startedAt: '2026-09-22T10:57:00Z',
    endedAt: '2026-09-22T12:30:00Z',
    provider: 'commandcode',
    model: 'anthropic/claude-3-7-sonnet',
    whatYouPayCost: 0.20,
    faceCost: 1.40,
    costUsd: 0.20,
    payFactor: 10 / 70,
    tokens: { freshInput: 5000, cachedInput: 20000, output: 3000, thinking: 1000, total: 28000 },
    effort: null,
    namedGaps: ['no_recorded_effort'],
    outcome: 'passed',
    costBearing: true,
  },
  {
    id: 't4',
    card: 140,
    phase: 'review',
    startedAt: '2026-09-22T12:30:00Z',
    endedAt: '2026-09-22T13:10:00Z',
    provider: 'openai',
    model: 'openai/gpt-4o',
    whatYouPayCost: 0.00,
    faceCost: 0.15,
    costUsd: 0.00,
    payFactor: 0.0,
    tokens: { freshInput: 1000, cachedInput: 4000, output: 500, thinking: 0, total: 5500 },
    effort: null,
    namedGaps: ['no_recorded_effort'],
    outcome: 'passed',
    costBearing: true,
  },
];

test('the note displays what-you-pay cost, step breakdown with model split, and effort beside thinking tokens', () => {
  const note = buildMondayNote({ cards: [stagedCard], traces: richTraces, ...WEEK });

  assert.equal(note.lines[0].costUsd, 0.55); // 0.05 + 0.30 + 0.20 + 0.00
  assert.equal(note.lines[0].faceCostUsd, 1.90); // 0.05 + 0.30 + 1.40 + 0.15
  assert.equal(note.totalUsd, 0.55);

  // Model breakdown lines under steps
  assert.match(note.body, /deepseek\/deepseek-chat \(deepseek\): \$0\.05/);
  assert.match(note.body, /deepseek\/deepseek-reasoner \(deepseek\): \$0\.30/);
  assert.match(note.body, /anthropic\/claude-3-7-sonnet \(commandcode\): \$0\.20/);
  assert.match(note.body, /openai\/gpt-4o \(openai\): \$0\.00/);

  // Effort level beside thinking tokens
  assert.match(note.body, /effort: no recorded effort \(0 thinking tokens\)/);
  assert.match(note.body, /effort: no recorded effort \(5\.0k thinking tokens\)/); // build step total: 4k + 1k
});

test('the card line displays drivers: steps, tokens sent per step, cached share, review rounds, failed attempts, waits on Todd outside UAT', () => {
  const note = buildMondayNote({ cards: [stagedCard], traces: richTraces, ...WEEK });

  // 4 steps in stagedCard (planning, execute, review, done). Total input tokens = 10k+40k + 20k+80k + 5k+20k + 1k+4k = 180k.
  // Cached input = 40k+80k+20k+4k = 144k (80% cached).
  assert.match(note.body, /Drivers: 4 steps/);
  assert.match(note.body, /80% cached input/);
  assert.match(note.body, /1 review round/);
  assert.match(note.body, /1 failed attempt/);
  assert.match(note.body, /0 waits on Todd outside UAT/);
});

test('the note reports weekly totals per provider in what-you-pay dollars', () => {
  const note = buildMondayNote({ cards: [stagedCard], traces: richTraces, ...WEEK });

  assert.deepEqual(note.providerTotals, {
    deepseek: { whatYouPayCost: 0.35, faceCost: 0.35 },
    commandcode: { whatYouPayCost: 0.20, faceCost: 1.40 },
    openai: { whatYouPayCost: 0.00, faceCost: 0.15 },
  });

  assert.match(note.body, /Provider weekly totals \(what-you-pay\):/);
  assert.match(note.body, /• deepseek: \$0\.35/);
  assert.match(note.body, /• commandcode: \$0\.20 \(face value \$1\.40\)/);
  assert.match(note.body, /• openai \(subscription\): \$0\.00 \(face value \$0\.15\)/);
});

test('named gaps (no token count, unpriced model, no recorded effort) are reported by name and count, and the rest of the note prints without throwing', () => {
  const traceWithGaps = [
    ...richTraces,
    {
      id: 't-unpriced',
      card: 140,
      phase: 'build',
      startedAt: '2026-09-22T12:00:00Z',
      endedAt: '2026-09-22T12:10:00Z',
      provider: 'custom',
      model: 'unknown/model-xyz',
      whatYouPayCost: null,
      faceCost: null,
      costUsd: 0.00,
      payFactor: 1.0,
      tokens: { freshInput: 1000, cachedInput: 0, output: 100, thinking: 0, total: 1100 },
      effort: null,
      namedGaps: ['unpriced_model:unknown/model-xyz', 'no_recorded_effort'],
      outcome: 'passed',
      costBearing: true,
    },
    {
      id: 't-notokens',
      card: 140,
      phase: 'build',
      startedAt: '2026-09-22T12:10:00Z',
      endedAt: '2026-09-22T12:20:00Z',
      provider: 'deepseek',
      model: 'deepseek/deepseek-uncounted',
      whatYouPayCost: null,
      faceCost: null,
      costUsd: 0.00,
      payFactor: 1.0,
      tokens: { freshInput: 0, cachedInput: 0, output: 0, thinking: 0, total: 0 },
      effort: null,
      namedGaps: ['no_token_count', 'no_recorded_effort'],
      outcome: 'passed',
      costBearing: true,
    },
  ];

  const note = buildMondayNote({ cards: [stagedCard], traces: traceWithGaps, ...WEEK });

  assert.match(note.body, /unknown\/model-xyz \(custom\): unpriced/);
  assert.match(note.body, /deepseek\/deepseek-uncounted \(deepseek\): no token count/);
  assert.match(note.body, /Named gaps:/);
  assert.match(note.body, /• No recorded effort: 4 step\(s\)/);
  assert.match(note.body, /• Unpriced models: 1 call\(s\)/);
  assert.match(note.body, /• No token count: 1 call\(s\)/);
});

test('waits on Todd outside UAT correctly counts non-Factory actor steps between intake and done', () => {
  const cardWithIntervention = {
    ...stagedCard,
    number: 145,
    stageHistory: [
      { stage: 'triage', enteredAt: '2026-09-22T09:00:00Z', exitedAt: '2026-09-22T09:05:00Z', by: 'todd', exitedBy: 'todd' },
      { stage: 'planning', enteredAt: '2026-09-22T09:05:00Z', exitedAt: '2026-09-22T09:30:00Z', by: 'agent:r1', exitedBy: 'todd' }, // Todd intervention: wait #1
      { stage: 'execute', enteredAt: '2026-09-22T09:30:00Z', exitedAt: '2026-09-22T10:30:00Z', by: 'agent:r2', exitedBy: 'agent:r2' },
      { stage: 'done', enteredAt: '2026-09-22T10:30:00Z', by: 'agent:r2' },
    ],
  };

  const note = buildMondayNote({ cards: [cardWithIntervention], traces: [], ...WEEK });

  assert.equal(note.lines[0].waitsOnTodd, 1);
  assert.match(note.body, /1 wait on Todd outside UAT/);
});
