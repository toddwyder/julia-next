// controller-eligibility.test.mjs -- JUL-98 step 2, items 2 and 3.
//
// The eligibility machinery is NOT rewritten here. `evaluateEligibility`,
// `pickTopCard`/`sortCardsByBoardOrder`, `openBlockers`, `isBlockerClosed`,
// `ineligibleCommentBody` and the Decision/Parent label constants already live
// in scripts/ready-queue.mjs and are reused as-is (triage note on JUL-98,
// 2026-09-20: "Refusing Decision and Parent cards exists today"). The ONLY new
// refusal is a card with no section headed exactly `## UAT plan`.
//
// This file pins: the three refusals each produce one comment and no start; the
// controller takes the TOP ELIGIBLE card in board order, skipping ineligible
// ones rather than stalling on them; a blocker at UAT or later counts as
// unblocked; and the one-full-check rule -- a card dropped into Ready and taken
// out again before the next check never starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DECISION_LABEL,
  PARENT_LABEL,
  evaluateEligibility,
  ineligibleCommentBody,
  isBlockerClosed,
  openBlockers,
  sortCardsByBoardOrder,
} from './ready-queue.mjs';
import {
  UAT_PLAN_HEADING,
  NO_UAT_PLAN_REASON,
  hasUatPlanSection,
  evaluateControllerEligibility,
  controllerIneligibleCommentBody,
  selectStartableCard,
} from '../graph/controller/eligibility.mjs';

// A card the controller would accept: in Ready, no coordinate-only label, no
// open blocker, and a `## UAT plan` section. Shaped like ready-queue.mjs's
// normalizeIssue output, plus the description the new refusal reads.
function card(overrides = {}) {
  return {
    id: overrides.id ?? 'uuid-1',
    identifier: overrides.identifier ?? 'JUL-92',
    title: 'Docs and settings match how things run now',
    sortOrder: overrides.sortOrder ?? -2889,
    state: { name: 'Ready', type: 'unstarted' },
    labels: overrides.labels ?? [],
    blockers: overrides.blockers ?? [],
    description: 'description' in overrides ? overrides.description : '## What to build\n\nstuff\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## UAT plan\n\n1. I look at it.\n',
  };
}

test('the controller reuses ready-queue\'s machinery rather than a second copy of it', () => {
  // Not a style point: two copies of "is this card eligible" drift, and the
  // board would then refuse a card in one place and admit it in another.
  assert.equal(typeof evaluateEligibility, 'function');
  assert.equal(typeof openBlockers, 'function');
  assert.equal(typeof isBlockerClosed, 'function');
  assert.equal(typeof sortCardsByBoardOrder, 'function');
  assert.equal(DECISION_LABEL, 'Decision');
  assert.equal(PARENT_LABEL, 'Parent');
  // The controller's comment body IS ready-queue's, so one card never gets two
  // differently-worded refusals depending on which program looked at it.
  const reasons = ['a reason'];
  assert.equal(
    controllerIneligibleCommentBody(card(), reasons),
    ineligibleCommentBody(card(), reasons),
  );
});

test('refusal 1: a Decision card is refused, with the existing reason, and nothing starts', () => {
  const decision = card({ labels: [DECISION_LABEL] });
  const verdict = evaluateControllerEligibility(decision);
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.reasons.some((reason) => reason.includes('Decision')));
  const { chosen, skipped } = selectStartableCard({ issues: [decision], previousReady: { 'uuid-1': 'seen' } });
  assert.equal(chosen, null, 'a Decision card must not start');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].status, 'ineligible');
  assert.equal(skipped[0].comment, controllerIneligibleCommentBody(decision, skipped[0].reasons), 'exactly one comment body');
});

test('refusal 2: a Parent card is refused and nothing starts', () => {
  const parent = card({ labels: [PARENT_LABEL] });
  const verdict = evaluateControllerEligibility(parent);
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.reasons.some((reason) => reason.includes('Parent')));
  const { chosen } = selectStartableCard({ issues: [parent], previousReady: { 'uuid-1': 'seen' } });
  assert.equal(chosen, null);
});

test('refusal 3 (the only new one): a card with no `## UAT plan` section is refused', () => {
  assert.equal(UAT_PLAN_HEADING, '## UAT plan');
  const noPlan = card({ description: '## What to build\n\nstuff, and no plan at all\n\n## Acceptance criteria\n\n- [ ] It works.\n' });
  const verdict = evaluateControllerEligibility(noPlan);
  assert.equal(verdict.eligible, false);
  assert.deepEqual(verdict.reasons, [NO_UAT_PLAN_REASON]);
  // ready-queue's own rules would have admitted it: this refusal is genuinely new.
  assert.equal(evaluateEligibility(noPlan).eligible, true);
  const { chosen, skipped } = selectStartableCard({ issues: [noPlan], previousReady: { 'uuid-1': 'seen' } });
  assert.equal(chosen, null);
  assert.equal(skipped[0].reasons.length, 1, 'one reason, so one comment');
});

test('the `## UAT plan` heading must be exact: a near-miss is not a plan', () => {
  assert.equal(hasUatPlanSection('## UAT plan\n\n1. step'), true);
  assert.equal(hasUatPlanSection('text\n\n## UAT plan   \n1. step'), true, 'trailing spaces on the heading line are fine');
  assert.equal(hasUatPlanSection('##  UAT plan\n'), true, 'extra space after the hashes is still the heading');
  assert.equal(hasUatPlanSection('### UAT plan\n'), false, 'a deeper heading is a different section');
  assert.equal(hasUatPlanSection('## UAT plans\n'), false);
  assert.equal(hasUatPlanSection('## uat plan\n'), false, 'the card\'s own spelling is the rule');
  assert.equal(hasUatPlanSection('I will write a ## UAT plan later\n'), false, 'the heading must start its own line');
  assert.equal(hasUatPlanSection(''), false);
  assert.equal(hasUatPlanSection(null), false);
  assert.equal(hasUatPlanSection(undefined), false, 'a card whose description was not fetched is refused, never admitted');
});

test('a card with every fault is refused once, with every reason in the one comment', () => {
  const bad = card({ labels: [DECISION_LABEL, PARENT_LABEL], description: 'nothing' });
  const { skipped } = selectStartableCard({ issues: [bad], previousReady: { 'uuid-1': 'seen' } });
  assert.equal(skipped.length, 1, 'one refusal, not four');
  assert.equal(skipped[0].reasons.length, 4, 'Decision, Parent, no UAT plan, no acceptance criteria');
  assert.equal(skipped[0].comment.split('Ready queue:').length - 1, 1, 'one comment body');
});

test('the TOP ELIGIBLE card in board order is taken: ineligible cards are skipped, not stalled on', () => {
  const issues = [
    card({ id: 'a', identifier: 'JUL-10', sortOrder: 30 }),
    card({ id: 'b', identifier: 'JUL-11', sortOrder: -50, labels: [DECISION_LABEL] }),
    card({ id: 'c', identifier: 'JUL-12', sortOrder: -10, description: 'no plan here' }),
    card({ id: 'd', identifier: 'JUL-13', sortOrder: 5 }),
  ];
  const previousReady = { a: 's', b: 's', c: 's', d: 's' };
  const { chosen, skipped } = selectStartableCard({ issues, previousReady });
  assert.equal(chosen.identifier, 'JUL-13', 'the first ELIGIBLE card in board order, not the first card');
  assert.deepEqual(skipped.map((entry) => entry.issue), ['JUL-11', 'JUL-12']);
  assert.ok(skipped.every((entry) => entry.status === 'ineligible'));
});

test('a blocker that has reached UAT counts as unblocked; one still in Code review does not', () => {
  const atUat = card({ blockers: [{ identifier: 'JUL-97', state: { name: 'UAT', type: 'started' } }] });
  assert.equal(isBlockerClosed(atUat.blockers[0]), true);
  assert.equal(evaluateControllerEligibility(atUat).eligible, true);

  const inReview = card({ id: 'x', blockers: [{ identifier: 'JUL-97', state: { name: 'Code review', type: 'started' } }] });
  const verdict = evaluateControllerEligibility(inReview);
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.reasons.some((reason) => reason.includes('blocked by JUL-97')));
});

test('the one-full-check rule: a card the previous check did not see cannot start', () => {
  const fresh = card({ id: 'new-card' });
  const { chosen, skipped } = selectStartableCard({ issues: [fresh], previousReady: {} });
  assert.equal(chosen, null, 'a card seen for the first time waits one full check');
  assert.equal(skipped[0].status, 'first-sighting');
  assert.equal(skipped[0].comment, null, 'a first sighting is not a refusal and gets no comment');
});

test('the one-full-check rule: a card dropped into Ready and removed before the next check NEVER starts', () => {
  const dropped = card({ id: 'flicker', identifier: 'JUL-99' });

  // Check 1: the card is in Ready for the first time. Nothing starts, and the
  // check records what it saw.
  const first = selectStartableCard({ issues: [dropped], previousReady: {} });
  assert.equal(first.chosen, null);
  assert.ok('flicker' in first.nextReady, 'the sighting is recorded for the next check');

  // Check 2: the card has been taken out of Ready again. It is not in the list,
  // so there is nothing to start, and the sighting is forgotten.
  const second = selectStartableCard({ issues: [], previousReady: first.nextReady });
  assert.equal(second.chosen, null);
  assert.deepEqual(second.nextReady, {}, 'the sighting must not survive the card leaving Ready');

  // Check 3: the card comes back. It is a first sighting again and STILL does
  // not start -- the one full check is earned afresh, never inherited.
  const third = selectStartableCard({ issues: [dropped], previousReady: second.nextReady });
  assert.equal(third.chosen, null, 'a card that flickered through Ready must never start');
  assert.equal(third.skipped[0].status, 'first-sighting');

  // Check 4: it has now been in Ready across one whole check, so it starts.
  const fourth = selectStartableCard({ issues: [dropped], previousReady: third.nextReady });
  assert.equal(fourth.chosen.identifier, 'JUL-99');
});

test('a card is passed over for one full check on its own account: a neighbour being seen does not admit it', () => {
  const older = card({ id: 'older', identifier: 'JUL-1', sortOrder: -100 });
  const newer = card({ id: 'newer', identifier: 'JUL-2', sortOrder: -90 });
  const { chosen, skipped } = selectStartableCard({ issues: [older, newer], previousReady: { newer: 'seen' } });
  assert.equal(chosen.identifier, 'JUL-2');
  assert.deepEqual(skipped.map((entry) => [entry.issue, entry.status]), [['JUL-1', 'first-sighting']]);
});

test('an ineligible card is commented on once per distinct fingerprint, and then stays quiet', () => {
  const bad = card({ id: 'bad', identifier: 'JUL-5', labels: [DECISION_LABEL] });
  const first = selectStartableCard({ issues: [bad], previousReady: { bad: 'seen' }, previousCommented: {} });
  assert.ok(first.skipped[0].comment, 'the first refusal posts a comment');

  const second = selectStartableCard({ issues: [bad], previousReady: { bad: 'seen' }, previousCommented: first.nextCommented });
  assert.equal(second.skipped[0].comment, null, 'the same refusal must not be posted twice');

  // The card changes (the Decision label comes off, but it still has no plan):
  // a different refusal, so one more comment.
  const changed = card({ id: 'bad', identifier: 'JUL-5', description: 'no plan' });
  const third = selectStartableCard({ issues: [changed], previousReady: { bad: 'seen' }, previousCommented: second.nextCommented });
  assert.ok(third.skipped[0].comment, 'a card whose refusal changed is told about it once more');
});

// The acceptance check (Todd, 23 Sep) refuses a step at the end unless every
// criterion and every UAT-plan item is answered, so a card with none of either
// is refused before any seat is paid for.
test('refusal 4: a card with a UAT plan but no numbered items, or no acceptance criteria, is refused', async () => {
  const { NO_ACCEPTANCE_CRITERIA_REASON, NO_UAT_ITEMS_REASON } = await import('../graph/controller/eligibility.mjs');
  const noItems = card({ description: '## Acceptance criteria\n\n- [ ] It works.\n\n## UAT plan\n\nTodd looks at it.\n' });
  assert.deepEqual(evaluateControllerEligibility(noItems).reasons, [NO_UAT_ITEMS_REASON]);
  const noCriteria = card({ description: '## What to build\n\nstuff\n\n## UAT plan\n\n1. I look at it.\n' });
  assert.deepEqual(evaluateControllerEligibility(noCriteria).reasons, [NO_ACCEPTANCE_CRITERIA_REASON]);
  const struckOnly = card({ description: '**Acceptance criteria:**\n\n- ~~moved off~~\n\n## UAT plan\n\n1. I look at it.\n' });
  assert.deepEqual(evaluateControllerEligibility(struckOnly).reasons, [NO_ACCEPTANCE_CRITERIA_REASON], 'a struck-through line is not a criterion');
  assert.equal(evaluateControllerEligibility(card()).eligible, true);
});

