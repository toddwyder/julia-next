// controller-columns.test.mjs -- JUL-98 step 2, item 4: the nine columns, in
// order, and the two that may be skipped.
//
// The column list is NOT retyped here or in the controller: it comes from
// graph/board-spec.mjs's WORKFLOW_STATES, which is what scripts/board-setup.mjs
// actually built the live board from (JUL-97). A second copy would let the
// board and the controller disagree about what comes next.
//
// The rules, from the card's Sep 20 amendment and its added criteria:
//   * the controller knows all nine and moves a card between them in order;
//   * a card whose work has nothing a person could look at skips Staging/smoke
//     test and Evidence review, with one comment saying why;
//   * a card that DOES have something to look at cannot skip them;
//   * no card ever skips Code review;
//   * every column move is exactly one comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WORKFLOW_STATE_NAMES } from '../graph/board-spec.mjs';
import {
  CONTROLLER_COLUMNS,
  SKIPPABLE_COLUMNS,
  NEVER_SKIPPED_COLUMN,
  FIRST_WORKED_COLUMN,
  LAST_COLUMN,
  nextColumnFor,
  columnMoveComment,
  walkColumns,
} from '../graph/controller/columns.mjs';

test('the controller knows all nine columns, in board order, from the board spec itself', () => {
  assert.deepEqual(CONTROLLER_COLUMNS, [
    'Backlog',
    'Ready',
    'Implementation',
    'Code review',
    'Remediation',
    'Staging/smoke test',
    'Evidence review',
    'UAT',
    'Complete',
  ]);
  assert.equal(CONTROLLER_COLUMNS.length, 9);
  assert.deepEqual([...CONTROLLER_COLUMNS], [...WORKFLOW_STATE_NAMES], 'the spec is the source, not a copy');
  assert.equal(FIRST_WORKED_COLUMN, 'Implementation');
  assert.equal(LAST_COLUMN, 'Complete');
  assert.equal(NEVER_SKIPPED_COLUMN, 'Code review');
  assert.deepEqual(SKIPPABLE_COLUMNS, ['Staging/smoke test', 'Evidence review']);
});

test('a card with nothing to look at walks Ready -> Implementation -> Code review -> UAT, skipping the two', () => {
  // This is JUL-92's shape: real doc fixes, nothing a person could open and
  // look at (the card's Sep 20 amendment says so in as many words).
  const walk = walkColumns('Ready', { hasReviewableOutput: false });
  assert.deepEqual(walk.map((step) => step.to), ['Implementation', 'Code review', 'UAT']);
  // Every column passed over is named, so the one comment can say what was
  // skipped and why: Remediation because the review found nothing, and the two
  // evidence columns because there is nothing a person could look at.
  assert.deepEqual(walk.at(-1).skipped, ['Remediation', 'Staging/smoke test', 'Evidence review']);
  assert.match(walk.at(-1).skipReason, /nothing a person could look at/);
  // The controller stops at UAT. Acceptance is Todd's, and it is not built yet.
  assert.ok(!walk.some((step) => step.to === 'Complete'), 'the controller never moves a card to Complete');
});

test('a card that DOES have something to look at crosses both columns, and cannot skip them', () => {
  const walk = walkColumns('Ready', { hasReviewableOutput: true });
  assert.deepEqual(walk.map((step) => step.to), [
    'Implementation', 'Code review', 'Staging/smoke test', 'Evidence review', 'UAT',
  ]);
  // Neither evidence column may be skipped. (Remediation is passed over on a
  // passing review, which is not the same thing.)
  for (const step of walk) {
    for (const column of SKIPPABLE_COLUMNS) {
      assert.ok(!step.skipped.includes(column), `${column} must not be skipped for a card with something to look at`);
    }
  }
});

test('the refusal: asking to skip the two columns while the card HAS something to look at is refused', () => {
  const refused = nextColumnFor('Code review', { hasReviewableOutput: true, skipStagingAndEvidence: true });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /Staging\/smoke test/);
  assert.match(refused.reason, /Evidence review/);
  assert.match(refused.reason, /something a person could look at/);
  assert.equal(refused.to, undefined, 'a refused move names no destination');

  // The same request on a card with nothing to look at is allowed.
  const allowed = nextColumnFor('Code review', { hasReviewableOutput: false, skipStagingAndEvidence: true });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.to, 'UAT');
  assert.deepEqual(allowed.skipped, ['Remediation', 'Staging/smoke test', 'Evidence review']);
});

test('no card ever skips Code review -- not even one with nothing to look at', () => {
  for (const hasReviewableOutput of [true, false]) {
    const move = nextColumnFor('Implementation', { hasReviewableOutput });
    assert.equal(move.ok, true);
    assert.equal(move.to, 'Code review', 'Implementation always hands over to Code review');
    assert.deepEqual(move.skipped, []);
  }
  // And it is never in the skippable set, whatever a caller asks for.
  assert.ok(!SKIPPABLE_COLUMNS.includes('Code review'));
  const asked = nextColumnFor('Implementation', { hasReviewableOutput: false, skipStagingAndEvidence: true });
  assert.equal(asked.to, 'Code review');
});

test('Remediation is entered only when the review actually found something', () => {
  const passed = nextColumnFor('Code review', { hasReviewableOutput: true });
  assert.equal(passed.to, 'Staging/smoke test', 'a passing review skips Remediation');
  assert.deepEqual(passed.skipped, ['Remediation']);

  const failed = nextColumnFor('Code review', { hasReviewableOutput: true, needsRemediation: true });
  assert.equal(failed.to, 'Remediation');
  assert.deepEqual(failed.skipped, []);

  // Out of Remediation the card goes back for another review: nothing reaches
  // UAT without a review of the work that actually landed.
  const back = nextColumnFor('Remediation', { hasReviewableOutput: true });
  assert.equal(back.to, 'Code review');
});

test('moving in order is enforced: an unknown column, and the end of the board, are refused not guessed', () => {
  const unknown = nextColumnFor('Wishlist', { hasReviewableOutput: false });
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /Wishlist/);
  assert.match(unknown.reason, /not one of the board's nine columns/);

  const end = nextColumnFor('Complete', { hasReviewableOutput: false });
  assert.equal(end.ok, false);
  assert.match(end.reason, /Complete/);

  const uat = nextColumnFor('UAT', { hasReviewableOutput: false });
  assert.equal(uat.ok, false, 'the controller stops at UAT: Complete is Todd\'s acceptance');
  assert.match(uat.reason, /acceptance/);
});

test('every column move is exactly one comment, written by the controller, naming both columns', () => {
  const move = nextColumnFor('Ready', { hasReviewableOutput: false });
  const body = columnMoveComment({ identifier: 'JUL-92', from: 'Ready', move });
  assert.equal(typeof body, 'string');
  assert.match(body, /JUL-92/);
  assert.match(body, /Ready/);
  assert.match(body, /Implementation/);
  // One comment: a single body, not a list of them.
  assert.equal(body.split('\n')[0].startsWith('**'), true, 'it reads as one controller note');
});

test('the skip is explained in the move\'s own one comment, naming both skipped columns and why', () => {
  const move = nextColumnFor('Code review', { hasReviewableOutput: false });
  const body = columnMoveComment({ identifier: 'JUL-92', from: 'Code review', move });
  assert.match(body, /Staging\/smoke test/);
  assert.match(body, /Evidence review/);
  assert.match(body, /nothing a person could look at/);
  assert.equal(body.match(/Skipped/g)?.length, 1, 'the skip is explained once, in the one move comment');
});

test('a move with nothing skipped says nothing about skipping', () => {
  const move = nextColumnFor('Ready', { hasReviewableOutput: true });
  const body = columnMoveComment({ identifier: 'JUL-92', from: 'Ready', move });
  assert.doesNotMatch(body, /Skipped/);
});
