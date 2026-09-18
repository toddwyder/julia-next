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
    expectedHeadSha: 'a'.repeat(40),
    fetchImpl: fakeFetch,
    tokenImpl: fakeTokenImpl,
  });

  assert.deepEqual(result, { merged: true, sha: 'deadbeef', message: 'Pull Request successfully merged' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/toddwyder/julia-next/pulls/2/merge');
  assert.equal(calls[0].init.method, 'PUT');
  assert.match(calls[0].init.headers.Authorization, /^Bearer /);
  assert.equal(JSON.parse(calls[0].init.body).sha, 'a'.repeat(40));
});

test('never exposes the installation token in its return value, even on failure', async () => {
  const fakeFetch = async () => ({ ok: false, status: 405, json: async () => ({ message: 'Pull Request is not mergeable' }) });
  const fakeTokenImpl = async () => 'ghs_fake-token';

  await assert.rejects(
    () =>
      mergePullRequest({
        owner: 'toddwyder',
        repo: 'julia-next',
        number: 2,
        expectedHeadSha: 'a'.repeat(40),
        fetchImpl: fakeFetch,
        tokenImpl: fakeTokenImpl,
      }),
    (error) => {
      assert.match(error.message, /Pull Request is not mergeable/);
      assert.doesNotMatch(error.message, /ghs_fake-token/);
      return true;
    },
  );
});

test('rejects a non-positive-integer PR number instead of forwarding caller-supplied text into the API path (PR #3 review)', async () => {
  await assert.rejects(
    () =>
      mergePullRequest({
        owner: 'toddwyder',
        repo: 'julia-next',
        number: '2/../evil',
        expectedHeadSha: 'a'.repeat(40),
        fetchImpl: async () => ({}),
        tokenImpl: async () => 'x',
      }),
    /number must be a positive integer/,
  );
  await assert.rejects(
    () =>
      mergePullRequest({
        owner: 'toddwyder',
        repo: 'julia-next',
        number: -1,
        expectedHeadSha: 'a'.repeat(40),
        fetchImpl: async () => ({}),
        tokenImpl: async () => 'x',
      }),
    /number must be a positive integer/,
  );
});

test('rejects a repo other than toddwyder/julia-next or toddwyder/Julia (no scope creep via CLI args)', async () => {
  await assert.rejects(
    () =>
      mergePullRequest({
        owner: 'someone-else',
        repo: 'unrelated-repo',
        number: 1,
        expectedHeadSha: 'a'.repeat(40),
        fetchImpl: async () => ({}),
        tokenImpl: async () => 'x',
      }),
    /not an approved publisher target/,
  );
});

test('rejects a missing or malformed expectedHeadSha before ever calling the API (JUL-61 step 4)', async () => {
  const fetchImpl = async () => {
    throw new Error('must not call the network without a valid expectedHeadSha');
  };
  await assert.rejects(
    () => mergePullRequest({ owner: 'toddwyder', repo: 'julia-next', number: 2, fetchImpl, tokenImpl: async () => 'x' }),
    /expectedHeadSha must be a 40-character commit SHA/,
  );
  await assert.rejects(
    () => mergePullRequest({ owner: 'toddwyder', repo: 'julia-next', number: 2, expectedHeadSha: 'not-a-sha', fetchImpl, tokenImpl: async () => 'x' }),
    /expectedHeadSha must be a 40-character commit SHA/,
  );
});

test('a PR head that moved since review is refused, not merged (JUL-61 step 4: merge pins the reviewed commit)', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    // GitHub returns 409 when the supplied `sha` no longer matches the PR head.
    return { ok: false, status: 409, json: async () => ({ message: 'Head branch was modified. Review and try the merge again.' }) };
  };

  await assert.rejects(
    () =>
      mergePullRequest({
        owner: 'toddwyder',
        repo: 'julia-next',
        number: 2,
        expectedHeadSha: 'a'.repeat(40),
        fetchImpl: fakeFetch,
        tokenImpl: async () => 'ghs_fake-token',
      }),
    /Head branch was modified/,
  );
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).sha, 'a'.repeat(40));
});
