import assert from 'node:assert/strict';
import test from 'node:test';

import { branchesWithoutOpenPullRequests, scorecardGaps } from './check-branch-pr.mjs';

const repository = 'toddwyder/julia-next';

test('non-main branches without an open pull request fail', () => {
  const branches = [{ name: 'main' }, { name: 'build/jul-253' }, { name: 'orphan' }];
  const pulls = [{ state: 'open', base: { ref: 'main' }, head: { ref: 'build/jul-253', repo: { full_name: repository } } }];
  assert.deepEqual(branchesWithoutOpenPullRequests({ branches, pulls, repository }), ['orphan']);
});

test('closed, cross-repository and non-main pull requests do not satisfy the policy', () => {
  const branches = [{ name: 'closed' }, { name: 'fork' }, { name: 'wrong-base' }];
  const pulls = [
    { state: 'closed', base: { ref: 'main' }, head: { ref: 'closed', repo: { full_name: repository } } },
    { state: 'open', base: { ref: 'main' }, head: { ref: 'fork', repo: { full_name: 'elsewhere/fork' } } },
    { state: 'open', base: { ref: 'release' }, head: { ref: 'wrong-base', repo: { full_name: repository } } },
  ];
  assert.deepEqual(branchesWithoutOpenPullRequests({ branches, pulls, repository }), ['closed', 'fork', 'wrong-base']);
});

const scorecard = (cost) => `# JUL-282\n\n- Cost: ${cost} at published API prices, every row priced.\n`;

function pull({ number = 7, title = 'Do a thing (JUL-282)', body = '', ref = 'feat/jul-282' } = {}) {
  return { number, title, body, head: { ref } };
}

test('a card pull request passes with a scorecard that shows a cost', () => {
  const gaps = scorecardGaps({
    pulls: [pull()],
    headRef: 'feat/jul-282',
    readFile: path => { assert.equal(path, 'docs/scorecards/JUL-282.md'); return scorecard('**$1.69**'); },
  });
  assert.deepEqual(gaps, []);
});

test('a scorecard whose cost could not be measured fails the pull request', () => {
  const gaps = scorecardGaps({ pulls: [pull()], headRef: 'feat/jul-282', readFile: () => scorecard('**unknown**') });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /docs\/scorecards\/JUL-282\.md with cost "unknown"/);
  assert.match(gaps[0], /node scripts\/scorecard\.mjs JUL-282 --write/, 'the gap says what to run');
});

test('a card pull request with no scorecard on the branch fails', () => {
  const gaps = scorecardGaps({ pulls: [pull()], headRef: 'feat/jul-282', readFile: () => { throw new Error('ENOENT'); } });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /is not on the branch/);
});

test('a cost the scorecard says is short fails the pull request even though it is a number', () => {
  const written = `${scorecard('**$1.69**')}- Cost incomplete: 1 session of this card started after the launcher and recorded no trace rows.\n`;
  const gaps = scorecardGaps({ pulls: [pull()], headRef: 'feat/jul-282', readFile: () => written });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /known to be short: 1 session of this card started after the launcher and recorded no trace rows/);
});

test('a pull request that names no card, or is another branch, is not checked', () => {
  assert.equal(scorecardGaps({ pulls: [pull({ title: 'Fix the font flake' })], headRef: 'feat/jul-282', readFile: () => scorecard('**$3.00**') }).length, 1);
  assert.deepEqual(scorecardGaps({ pulls: [pull({ ref: 'other' })], headRef: 'feat/jul-282', readFile: () => scorecard('**$3.00**') }), []);
});

test('work that is not a card passes when the body says so and gives a reason', () => {
  const body = 'Todd asked for this correction as its own pull request, with no card.\n\nNo card: a correction Todd asked for, not a card.\n';
  assert.deepEqual(scorecardGaps({ pulls: [pull({ title: 'Require a verdict before green', body })], headRef: 'feat/jul-282', readFile: () => scorecard('**$3.00**') }), []);
});

test('a No card line with no reason does not pass', () => {
  const body = 'No card:\n';
  const gaps = scorecardGaps({ pulls: [pull({ title: 'Require a verdict before green', body })], headRef: 'feat/jul-282', readFile: () => scorecard('**$3.00**') });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /say "No card: <reason>" in the body/);
});

test('a pull request that names a card still needs that card\'s scorecard, whatever its body says', () => {
  const body = 'No card: this is not a card.\n';
  const gaps = scorecardGaps({ pulls: [pull({ body })], headRef: 'feat/jul-282', readFile: () => { throw new Error('ENOENT'); } });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /names JUL-282 but docs\/scorecards\/JUL-282\.md is not on the branch/);
});
