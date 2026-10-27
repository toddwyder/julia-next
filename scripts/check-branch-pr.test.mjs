import assert from 'node:assert/strict';
import test from 'node:test';

import { branchUnderTest, branchesWithoutOpenPullRequests } from './check-branch-pr.mjs';

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

// Replays CI run 40410255143 (26 Oct 2026): the first push of feat/jul-274-run-scorecard,
// made before its pull request could exist, failed this check and blocked the merge
// until CI was rerun. #357 and #358 hit the same failure on their first push.
test('the branch being pushed is not failed for lacking a pull request it cannot have yet', () => {
  const branches = [{ name: 'main' }, { name: 'feat/jul-274-run-scorecard' }];
  const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'feat/jul-274-run-scorecard' };
  assert.deepEqual(branchesWithoutOpenPullRequests({ branches, pulls: [], repository, ...branchUnderTest(env) }), []);
});

test('every other branch without a pull request still fails on a push', () => {
  const branches = [{ name: 'main' }, { name: 'feat/new' }, { name: 'orphan' }];
  const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'feat/new' };
  assert.deepEqual(branchesWithoutOpenPullRequests({ branches, pulls: [], repository, ...branchUnderTest(env) }), ['orphan']);
});

test('pull request runs and pushes to main exempt nothing', () => {
  assert.deepEqual(branchUnderTest({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF_NAME: '360/merge' }), {});
  assert.deepEqual(branchUnderTest({ GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main' }), {});
});
