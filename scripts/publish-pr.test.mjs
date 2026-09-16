import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pushBranch, openPullRequest } from './publish-pr.mjs';

test('pushBranch mints a scoped token, writes an askpass helper with no token in its own file content, and pushes via env only', async () => {
  const calls = [];
  let capturedAskpassPath;
  const execImpl = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    capturedAskpassPath = opts.env.GIT_ASKPASS;
    return { stdout: '', stderr: '' };
  };
  const fakeTokenImpl = async (env) => {
    assert.equal(env.JULIA_PUBLISHER_OWNER, 'toddwyder');
    assert.equal(env.JULIA_PUBLISHER_REPO, 'julia-next');
    return 'ghs_super-secret-token';
  };
  const written = [];
  const fakeWriteAskpass = () => {
    const p = '/tmp/fake-askpass.sh';
    written.push(p);
    return p;
  };

  const result = await pushBranch({
    owner: 'toddwyder', repo: 'julia-next', branch: 'jul43-linear-coordinator-support', cwd: 'C:\\Dev\\julia-next',
    // A realistic ambient env, including the App's own signing credentials
    // -- proving they specifically get excluded, not just absent by luck.
    env: { PATH: '/usr/bin', JULIA_PUBLISHER_APP_ID: '4948330', JULIA_PUBLISHER_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----' },
    tokenImpl: fakeTokenImpl, execImpl, writeAskpass: fakeWriteAskpass,
  });

  assert.deepEqual(result, { pushed: true, branch: 'jul43-linear-coordinator-support' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'git');
  // -c credential.helper= and -c core.hooksPath=<empty dir> must precede
  // the push itself, so no configured credential helper or repo hook runs
  // (JUL-43 PR #3 review, finding S2).
  assert.equal(calls[0].args[0], '-c');
  assert.equal(calls[0].args[1], 'credential.helper=');
  assert.equal(calls[0].args[2], '-c');
  assert.match(calls[0].args[3], /^core\.hooksPath=/);
  assert.deepEqual(calls[0].args.slice(4), ['push', 'https://x-access-token@github.com/toddwyder/julia-next.git', 'HEAD:refs/heads/jul43-linear-coordinator-support']);
  assert.equal(calls[0].opts.cwd, 'C:\\Dev\\julia-next');
  // The token must travel only via a named env var the askpass helper reads
  // at run time -- never as a literal in argv, never in the helper's own
  // file content (asserted below against the real default writer).
  assert.equal(calls[0].opts.env.JULIA_PUBLISHER_ASKPASS_TOKEN, 'ghs_super-secret-token');
  assert.equal(capturedAskpassPath, '/tmp/fake-askpass.sh');
  assert.ok(!JSON.stringify(calls[0].args).includes('ghs_super-secret-token'));
  // The App's own signing credentials must never reach the git subprocess's
  // environment -- a repo hook or credential helper running inside that
  // process could otherwise read and leak them (finding S1).
  assert.equal(calls[0].opts.env.JULIA_PUBLISHER_APP_PRIVATE_KEY, undefined);
  assert.equal(calls[0].opts.env.JULIA_PUBLISHER_APP_ID, undefined);
  // System/global git config layers are neutralized so an ambient
  // credential.helper or url.insteadOf rewrite outside this repo can't
  // apply (finding S2's global/system-config half).
  assert.equal(calls[0].opts.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.ok(calls[0].opts.env.GIT_CONFIG_GLOBAL);
});

test('the real askpass helper file never contains the token itself, only a reference to the env var', async () => {
  const execImpl = async () => ({ stdout: '', stderr: '' });
  let askpassPath;
  const fakeTokenImpl = async () => 'ghs_super-secret-token';
  const { defaultWriteAskpass } = await import('./publish-pr.mjs');
  askpassPath = defaultWriteAskpass();
  const content = readFileSync(askpassPath, 'utf8');
  assert.ok(!content.includes('ghs_super-secret-token'));
  assert.match(content, /JULIA_PUBLISHER_ASKPASS_TOKEN/);
});

test('pushBranch rejects a repo outside the approved publisher targets', async () => {
  await assert.rejects(
    () => pushBranch({ owner: 'someone-else', repo: 'unrelated', branch: 'x', cwd: '.', tokenImpl: async () => 'x', execImpl: async () => ({}) }),
    /not an approved publisher target/,
  );
});

test('pushBranch never exposes the token in its return value or a thrown error', async () => {
  const execImpl = async () => { throw new Error('git push failed: some git stderr, no secret here'); };
  await assert.rejects(
    () => pushBranch({
      owner: 'toddwyder', repo: 'julia-next', branch: 'b', cwd: '.',
      tokenImpl: async () => 'ghs_super-secret-token', execImpl, writeAskpass: () => '/tmp/x.sh',
    }),
    (error) => {
      assert.doesNotMatch(error.message, /ghs_super-secret-token/);
      return true;
    },
  );
});

test('pushBranch never repeats raw git stderr in its thrown error, even if a hook printed a credential into it (finding S1)', async () => {
  const execImpl = async () => {
    const error = new Error('command failed');
    // A rogue pre-push hook could print anything, including a credential
    // it read out of its own process environment, to stderr.
    error.stderr = 'pre-push hook: leaked JULIA_PUBLISHER_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----FAKE-----END-----';
    throw error;
  };
  await assert.rejects(
    () => pushBranch({
      owner: 'toddwyder', repo: 'julia-next', branch: 'b', cwd: '.',
      tokenImpl: async () => 'ghs_super-secret-token', execImpl, writeAskpass: () => '/tmp/x.sh',
    }),
    (error) => {
      assert.doesNotMatch(error.message, /PRIVATE KEY/);
      assert.doesNotMatch(error.message, /leaked/);
      return true;
    },
  );
});

test('openPullRequest mints a token, opens the PR via the REST API, and returns only {url, number}', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ html_url: 'https://github.com/toddwyder/julia-next/pull/3', number: 3 }) };
  };
  const fakeTokenImpl = async () => 'ghs_super-secret-token';

  const result = await openPullRequest({
    owner: 'toddwyder', repo: 'julia-next', head: 'jul43-linear-coordinator-support', base: 'main',
    title: 'JUL-43: coordinator', body: 'body text', fetchImpl: fakeFetch, tokenImpl: fakeTokenImpl,
  });

  assert.deepEqual(result, { url: 'https://github.com/toddwyder/julia-next/pull/3', number: 3 });
  assert.equal(calls[0].url, 'https://api.github.com/repos/toddwyder/julia-next/pulls');
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].init.headers.Authorization, /^Bearer /);
  // The token legitimately travels in the Authorization header sent to
  // GitHub; what must never happen is it appearing in this function's own
  // return value.
  assert.ok(!JSON.stringify(result).includes('ghs_super-secret-token'));
});

test('openPullRequest rejects a repo outside the approved publisher targets', async () => {
  await assert.rejects(
    () => openPullRequest({
      owner: 'someone-else', repo: 'unrelated', head: 'x', base: 'main', title: 't', body: 'b',
      fetchImpl: async () => ({}), tokenImpl: async () => 'x',
    }),
    /not an approved publisher target/,
  );
});
