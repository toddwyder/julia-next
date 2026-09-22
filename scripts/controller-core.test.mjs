// controller-core.test.mjs -- JUL-98 step 2: the pieces of the controller core
// wired into one check cycle.
//
// This is the seam the later steps hang off. It deliberately does NOT dispatch
// a worker and does NOT read a mailbox -- that is step 3 -- so what it proves
// is exactly the five things this step owns: the three refusals, the top
// eligible card in board order, the one-full-check rule, width 1 through Orca's
// own run lock, and one comment per column move written by the controller.
//
// Every boundary is injected: no Linear call, no Orca call, no disk, no clock.
// The Orca stand-in is graph/controller/fixture-orca.mjs, built from the real
// recorded responses in graph/fixtures/orca-1.4.205/.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DECISION_LABEL, PARENT_LABEL } from './ready-queue.mjs';
import { createFixtureOrca } from '../graph/controller/fixture-orca.mjs';
import { runControllerCheck } from '../graph/controller/core.mjs';

const NOW = '2026-09-21T13:00:00.000Z';

function card(overrides = {}) {
  const identifier = overrides.identifier ?? 'JUL-92';
  return {
    id: overrides.id ?? `uuid-${identifier}`,
    identifier,
    title: 'a card',
    sortOrder: overrides.sortOrder ?? 0,
    state: { name: 'Ready', type: 'unstarted' },
    labels: overrides.labels ?? [],
    blockers: overrides.blockers ?? [],
    description: 'description' in overrides ? overrides.description : '## UAT plan\n\n1. I look at it.\n',
  };
}

// A stand-in board. It records every comment and every column move, so "exactly
// one comment per move, and the controller is the only writer" is checkable.
function fakeBoard({ issues = [] } = {}) {
  const comments = [];
  const moves = [];
  return {
    comments,
    moves,
    board: {
      listReadyCards: async () => issues,
      comment: async ({ issueId, body }) => {
        comments.push({ issueId, body });
        return { id: `c${comments.length}` };
      },
      moveCard: async ({ issueId, to }) => {
        moves.push({ issueId, to });
        return { id: issueId };
      },
    },
  };
}

function deps({ board, orca = createFixtureOrca(), previousReady = {}, previousCommented = {}, ...rest }) {
  return {
    board,
    runCreateImpl: orca.runCreate,
    checkImpl: orca.check,
    environment: 'orchestrator-local',
    from: 'term_controller',
    previousReady,
    previousCommented,
    requestIdFor: (identifier, purpose) => `req-${identifier}-${purpose}`,
    now: () => NOW,
    ...rest,
  };
}

test('the happy path: the top eligible card starts, with exactly one comment for the one column move', async () => {
  const jul92 = card({ identifier: 'JUL-92', sortOrder: -2889 });
  const { board, comments, moves } = fakeBoard({ issues: [jul92] });
  const orca = createFixtureOrca();

  const result = await runControllerCheck(deps({
    board,
    orca,
    previousReady: { 'uuid-JUL-92': 'seen last check' },
  }));

  assert.equal(result.status, 'started');
  assert.equal(result.issue, 'JUL-92');
  assert.ok(result.runId.startsWith('run_'), 'the card now has its Orca run: that IS the in-flight record');
  assert.equal(result.replayed, false);

  assert.deepEqual(moves, [{ issueId: 'uuid-JUL-92', to: 'Implementation' }]);
  assert.equal(comments.length, 1, 'exactly one comment for the one column move');
  assert.match(comments[0].body, /Ready -> Implementation/);
  assert.match(comments[0].body, /Moved by the controller/);
  assert.match(comments[0].body, /JUL-92/);
});

test('width 1 through Orca: while a card is in flight, nothing else is looked at or started', async () => {
  const inFlight = card({ identifier: 'JUL-92', sortOrder: -100 });
  const waiting = card({ identifier: 'JUL-88', sortOrder: -50 });
  const { board, comments, moves } = fakeBoard({ issues: [inFlight, waiting] });
  const orca = createFixtureOrca();
  const previousReady = { 'uuid-JUL-92': 'seen', 'uuid-JUL-88': 'seen' };

  const first = await runControllerCheck(deps({ board, orca, previousReady }));
  assert.equal(first.issue, 'JUL-92');

  // The next check finds the run still open.
  const second = await runControllerCheck(deps({
    board,
    orca,
    previousReady,
    activeRunImpl: async () => ({ id: first.runId, objective: 'JUL-92' }),
  }));
  assert.equal(second.status, 'slot-busy');
  assert.equal(second.issue, 'JUL-92', 'and it says which card holds the slot');
  assert.equal(moves.length, 1, 'JUL-88 was not moved');
  assert.equal(comments.length, 1, 'and not commented on: a waiting card is not told it is waiting');
  assert.equal(orca.runsCreated(), 1, 'no second run: width 1 is Orca\'s lock, not ours');
});

test('a fenced controller stands down: it starts nothing and reports why', async () => {
  const { board, comments, moves } = fakeBoard({ issues: [card()] });
  const orca = createFixtureOrca();
  // Another controller owns the run; ours is fenced on its next call.
  await orca.runCreate({ from: 'term_other', objective: 'JUL-92', requestId: 'r' });

  const result = await runControllerCheck(deps({
    board,
    orca,
    previousReady: { 'uuid-JUL-92': 'seen' },
    activeRunImpl: async () => { throw Object.assign(new Error('fenced'), { code: 'consumer_fenced' }); },
  }));

  assert.equal(result.status, 'fenced');
  assert.equal(moves.length, 0);
  assert.equal(comments.length, 0, 'a fenced controller writes nothing: the other one owns the card');
});

test('the three refusals: one comment each, nothing started, and the next eligible card still runs', async () => {
  const decision = card({ identifier: 'JUL-70', sortOrder: -300, labels: [DECISION_LABEL] });
  const parent = card({ identifier: 'JUL-71', sortOrder: -200, labels: [PARENT_LABEL] });
  const noPlan = card({ identifier: 'JUL-72', sortOrder: -100, description: 'no plan at all' });
  const good = card({ identifier: 'JUL-92', sortOrder: 0 });
  const { board, comments, moves } = fakeBoard({ issues: [decision, parent, noPlan, good] });

  const result = await runControllerCheck(deps({
    board,
    previousReady: Object.fromEntries([decision, parent, noPlan, good].map((issue) => [issue.id, 'seen'])),
  }));

  assert.equal(result.status, 'started');
  assert.equal(result.issue, 'JUL-92', 'the controller does not stall on a card it cannot run');
  assert.equal(comments.length, 4, 'three refusals plus the one column move');

  const refusals = comments.slice(0, 3);
  assert.deepEqual(refusals.map((entry) => entry.issueId), ['uuid-JUL-70', 'uuid-JUL-71', 'uuid-JUL-72']);
  assert.match(refusals[0].body, /Decision label/);
  assert.match(refusals[1].body, /Parent label/);
  assert.match(refusals[2].body, /UAT plan/);
  assert.deepEqual(moves, [{ issueId: 'uuid-JUL-92', to: 'Implementation' }], 'only the started card moved');
});

test('a refusal is posted once: the next check with the card unchanged says nothing', async () => {
  const noPlan = card({ identifier: 'JUL-72', description: 'no plan' });
  const { board, comments } = fakeBoard({ issues: [noPlan] });
  const previousReady = { 'uuid-JUL-72': 'seen' };

  const first = await runControllerCheck(deps({ board, previousReady }));
  assert.equal(comments.length, 1);

  const second = await runControllerCheck(deps({
    board,
    previousReady,
    previousCommented: first.nextCommented,
  }));
  assert.equal(comments.length, 1, 'the same refusal must not be posted twice');
  assert.equal(second.status, 'nothing-eligible');
});

test('the one-full-check rule holds through the real cycle: a card that flickered never starts', async () => {
  const flicker = card({ identifier: 'JUL-99' });
  const present = fakeBoard({ issues: [flicker] });
  const absent = fakeBoard({ issues: [] });

  const one = await runControllerCheck(deps({ board: present.board, previousReady: {} }));
  assert.equal(one.status, 'nothing-eligible');
  assert.equal(present.moves.length, 0);

  // Taken out of Ready before the next check.
  const two = await runControllerCheck(deps({ board: absent.board, previousReady: one.nextReady }));
  assert.deepEqual(two.nextReady, {});

  // Back in: a first sighting again, so still nothing starts.
  const three = await runControllerCheck(deps({ board: present.board, previousReady: two.nextReady }));
  assert.equal(three.status, 'nothing-eligible');
  assert.equal(present.moves.length, 0, 'a card that flickered through Ready must never have started');
});

test('a repeated check with the same request id starts no second run and posts no second comment', async () => {
  const jul92 = card({ identifier: 'JUL-92' });
  const { board, comments, moves } = fakeBoard({ issues: [jul92] });
  const orca = createFixtureOrca();
  const seen = new Map();
  const previousReady = { 'uuid-JUL-92': 'seen' };

  const first = await runControllerCheck(deps({ board, orca, previousReady, commentsSeen: seen }));
  assert.equal(first.replayed, false);

  // The controller crashed after the run existed and is run again from the same
  // recorded state: Orca replays the run, the comment guard replays the comment.
  const again = await runControllerCheck(deps({ board, orca, previousReady, commentsSeen: seen }));
  assert.equal(again.replayed, true, 'Orca reported the replay');
  assert.equal(orca.runsCreated(), 1);
  assert.equal(comments.length, 1, 'the card must not get two identical move comments');
  assert.equal(moves.length, 2, 'the state move itself is idempotent on Linear and is simply repeated');
});

test('an empty Ready column is a quiet no-op', async () => {
  const { board, comments, moves } = fakeBoard({ issues: [] });
  const result = await runControllerCheck(deps({ board }));
  assert.equal(result.status, 'empty-ready');
  assert.equal(comments.length, 0);
  assert.equal(moves.length, 0);
});

// ---------------------------------------------------------------------------
// JUL-98 step 2, item 6, attempt 2: the ONE comment for the capped-builder move
// ---------------------------------------------------------------------------
//
// The automatic partner move lives in seat-labels.mjs and is pinned there. What
// is pinned HERE is the half the criterion actually asks for and attempt 1 left
// undone: the controller calls `fallbackSeatChoice`, and when a partner really
// moved it says so on the card -- once, and only then.

const CAPPED_BUILDER = { cappedSeat: 'builder' };

test('a capped builder moves its partner and the controller posts that reason as exactly ONE comment on the card', async () => {
  // No model labels on the card, so the seat table answers: builder Gemini,
  // reviewer Claude. The builder's backup IS claude, so the pair would collide
  // and the reviewer moves to its own backup, Codex (JUL-98 step 6).
  const jul92 = card({ identifier: 'JUL-92' });
  const { board, comments, moves } = fakeBoard({ issues: [jul92] });

  const result = await runControllerCheck(deps({
    board,
    previousReady: { [jul92.id]: 'seen' },
    ...CAPPED_BUILDER,
  }));

  assert.equal(result.status, 'started');
  assert.deepEqual(result.partnerMoved, {
    seat: 'reviewer',
    from: 'claude',
    to: 'codex',
    modelLabel: 'adversary-codex',
  });
  assert.equal(result.seatChoices.builder.entry, 'claude', 'the capped seat really did fall back');
  assert.equal(result.seatChoices.reviewer.entry, 'codex');

  // Two comments in all: the column move, and the seat move. The seat one is
  // the reason verbatim -- nothing re-worded, so the card and the code cannot
  // drift apart.
  const seatComments = comments.filter((entry) => /moved to its own backup/.test(entry.body));
  assert.equal(seatComments.length, 1, 'exactly one comment for the partner move');
  assert.equal(seatComments[0].issueId, jul92.id, 'posted on the card that was started');
  assert.equal(
    seatComments[0].body,
    'the builder fell back to claude, so the reviewer moved to its own backup adversary-codex to keep builder and reviewer in different families',
  );
  assert.equal(comments.length, 2, 'the column move comment and this one, and nothing else');
  assert.deepEqual(moves, [{ issueId: jul92.id, to: 'Implementation' }]);
});

test('no partner move, no comment: a capped builder whose reviewer is already on Codex is told nothing', async () => {
  const jul92 = card({ identifier: 'JUL-92', labels: ['adversary-codex'] });
  const { board, comments } = fakeBoard({ issues: [jul92] });

  const result = await runControllerCheck(deps({
    board,
    previousReady: { [jul92.id]: 'seen' },
    ...CAPPED_BUILDER,
  }));

  assert.equal(result.status, 'started');
  assert.equal(result.partnerMoved, null, 'nothing else had to move');
  assert.equal(result.seatChoices.builder.entry, 'claude');
  assert.equal(comments.length, 1, 'only the column-move comment');
  assert.ok(!/moved to its own backup/.test(comments[0].body));
});

test('a cycle with no capped seat resolves no fallback and posts no seat comment at all', async () => {
  const jul92 = card({ identifier: 'JUL-92' });
  const { board, comments } = fakeBoard({ issues: [jul92] });

  const result = await runControllerCheck(deps({ board, previousReady: { [jul92.id]: 'seen' } }));

  assert.equal(result.status, 'started');
  assert.equal(result.partnerMoved, null);
  assert.equal(result.seatChoices, null, 'fallbackSeatChoice was not called');
  assert.equal(comments.length, 1);
});

test('the partner-move comment is written once even when the same cycle is replayed', async () => {
  const jul92 = card({ identifier: 'JUL-92' });
  const { board, comments } = fakeBoard({ issues: [jul92] });
  const orca = createFixtureOrca();
  const seen = new Map();
  const previousReady = { [jul92.id]: 'seen' };

  await runControllerCheck(deps({ board, orca, previousReady, commentsSeen: seen, ...CAPPED_BUILDER }));
  await runControllerCheck(deps({ board, orca, previousReady, commentsSeen: seen, ...CAPPED_BUILDER }));

  assert.equal(comments.filter((entry) => /moved to its own backup/.test(entry.body)).length, 1);
});

test('a fallback the seat table cannot make legal stops the card where it is: no comment, no move', async () => {
  const jul92 = card({ identifier: 'JUL-92' });
  const { board, comments, moves } = fakeBoard({ issues: [jul92] });

  const result = await runControllerCheck(deps({
    board,
    previousReady: { [jul92.id]: 'seen' },
    cappedSeat: 'builder',
    // Stand-in for a seat table in which the partner has no legal backup --
    // the refusal fallbackSeatChoice still makes, which the controller must
    // not paper over by starting the card anyway.
    seatFallbackImpl: () => ({ ok: false, reason: 'refusing the builder backup (pi-deepseek): same family' }),
  }));

  assert.equal(result.status, 'seat-refused');
  assert.equal(result.issue, 'JUL-92');
  assert.match(result.reason, /refusing the builder backup/);
  assert.equal(comments.length, 0, 'the card is not commented on for a refusal it did not cause');
  assert.deepEqual(moves, [], 'the card stays in Ready');
  assert.ok(jul92.id in result.nextReady, 'the card keeps its sighting: it never left Ready');
});
