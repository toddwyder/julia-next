import test from 'node:test';
import assert from 'node:assert/strict';

import { mergePullRequest } from './merge-pr.mjs';

test('mints a publisher token scoped to the target repo, then merges via the REST API', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ merged: true, sha: 'deadbeef', message: 'Pull Request successfully merged' }) };
  };
  const fakeTokenImpl = async (env) => {
    assert.equal(env.JULIA_PUBLISHER_OWNER, 'toddwyder');
    assert.equal(env.JULIA_PUBLISHER_REPO, 'julia-next');
    return 'ghs_fake-token';
  };

  const result = await mergePullRequest({
    owner: 'toddwyder',
    repo: 'julia-next',
    number: 2,
    fetchImpl: fakeFetch,
    tokenImpl: fakeTokenImpl,
  });

  assert.deepEqual(result, { merged: true, sha: 'deadbeef', message: 'Pull Request successfully merged' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/toddwyder/julia-next/pulls/2/merge');
  assert.equal(calls[0].init.method, 'PUT');
  assert.match(calls[0].init.headers.Authorization, /^Bearer /);
});

test('never exposes the installation token in its return value, even on failure', async () => {
  const fakeFetch = async () => ({ ok: false, status: 405, json: async () => ({ message: 'Pull Request is not mergeable' }) });
  const fakeTokenImpl = async () => 'ghs_fake-token';

  await assert.rejects(
    () => mergePullRequest({ owner: 'toddwyder', repo: 'julia-next', number: 2, fetchImpl: fakeFetch, tokenImpl: fakeTokenImpl }),
    (error) => {
      assert.match(error.message, /Pull Request is not mergeable/);
      assert.doesNotMatch(error.message, /ghs_fake-token/);
      return true;
    },
  );
});

test('rejects a non-positive-integer PR number instead of forwarding caller-supplied text into the API path (PR #3 review)', async () => {
  await assert.rejects(
    () => mergePullRequest({ owner: 'toddwyder', repo: 'julia-next', number: '2/../evil', fetchImpl: async () => ({}), tokenImpl: async () => 'x' }),
    /number must be a positive integer/,
  );
  await assert.rejects(
    () => mergePullRequest({ owner: 'toddwyder', repo: 'julia-next', number: -1, fetchImpl: async () => ({}), tokenImpl: async () => 'x' }),
    /number must be a positive integer/,
  );
});

test('rejects a repo other than toddwyder/julia-next or toddwyder/Julia (no scope creep via CLI args)', async () => {
  await assert.rejects(
    () => mergePullRequest({ owner: 'someone-else', repo: 'unrelated-repo', number: 1, fetchImpl: async () => ({}), tokenImpl: async () => 'x' }),
    /not an approved publisher target/,
  );
});
