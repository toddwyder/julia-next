import assert from 'node:assert/strict';
import test from 'node:test';

import { branchesWithoutOpenPullRequests } from './check-branch-pr.mjs';

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
