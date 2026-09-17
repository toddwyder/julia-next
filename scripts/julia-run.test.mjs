import test from 'node:test';
import assert from 'node:assert/strict';

import {
  juliaRun, assertIssueId, assertAccount, assertReady, ensureCheckoutSynced, findExistingRun, startOrchestrator,
  prepareServerEnvironment, getRemoteMainHead, defaultPostCommentImpl,
} from './julia-run.mjs';

const READY = { ok: true, checks: [{ name: 'OVH runner reachable', ok: true, detail: 'connected' }] };
const NOT_READY = {
  ok: false,
  checks: [
    { name: 'OVH runner reachable', ok: true, detail: 'connected' },
    { name: 'julia-graph-publisher installed on julia-next', ok: false, detail: 'JULIA_PUBLISHER_APP_ID / JULIA_PUBLISHER_APP_PRIVATE_KEY are not set' },
  ],
};

function fakeImpls(overrides = {}) {
  const calls = { comments: [], runsCreated: [], terminalsCreated: [], syncTriggered: false };
  return {
    calls,
    impls: {
      usernameImpl: () => 'orchestrator-svc',
      env: { ORCA_BIN: 'fake-orca', ORCA_ENVIRONMENT: 'fake-env', JULIA_PUBLISHER_APP_ID: 'x', JULIA_PUBLISHER_APP_PRIVATE_KEY: 'y' },
      loadEnvFileImpl: () => { throw new Error('should not need to load the env file when publisher creds are already present'); },
      checkReadinessImpl: async () => READY,
      execImpl: async (cmd, args) => {
        if (cmd === 'git' && args.includes('rev-parse')) return { stdout: 'abc123\n' };
        if (cmd === 'sudo') { calls.syncTriggered = true; return { stdout: '' }; }
        throw new Error(`unexpected execImpl call: ${cmd} ${args.join(' ')}`);
      },
      getRemoteMainHeadImpl: async () => 'abc123',
      runListImpl: async () => ({ runs: [] }),
      fromHandle: 'term_fake123',
      runCreateImpl: async ({ objective }) => {
        calls.runsCreated.push(objective);
        return { run: { id: 'run_fake456', objective } };
      },
      terminalCreateImpl: async (args) => {
        calls.terminalsCreated.push(args);
        return { terminal: { handle: 'term_fake789' } };
      },
      postCommentImpl: async (issueId, body) => {
        calls.comments.push({ issueId, body });
      },
      ...overrides,
    },
  };
}

test('rejects a malformed issue id before touching anything else', () => {
  assert.throws(() => assertIssueId('not-an-issue'), /issueId must look like JUL-63/);
  assert.throws(() => assertIssueId(''), /issueId must look like JUL-63/);
  assert.doesNotThrow(() => assertIssueId('JUL-63'));
});

test('refuses to run as any account other than orchestrator-svc', async () => {
  const { impls } = fakeImpls();
  assert.throws(
    () => assertAccount({ ...impls, usernameImpl: () => 'runner' }),
    /must run as orchestrator-svc, not runner/,
  );
  assert.doesNotThrow(() => assertAccount(impls));
});

test('a failing readiness check stops and names the specific failing check', async () => {
  await assert.rejects(
    () => assertReady({ checkReadinessImpl: async () => NOT_READY }),
    /readiness check failed: julia-graph-publisher installed on julia-next -- JULIA_PUBLISHER_APP_ID/,
  );
});

test('a synced checkout does not trigger a sync', async () => {
  const { impls, calls } = fakeImpls();
  const result = await ensureCheckoutSynced(impls);
  assert.equal(result.triggeredSync, false);
  assert.equal(calls.syncTriggered, false);
});

test('a stale checkout triggers exactly one sync, then re-checks', async () => {
  let revParseCalls = 0;
  const execImpl = async (cmd, args) => {
    if (cmd === 'git' && args.includes('rev-parse')) {
      revParseCalls += 1;
      // First check: stale. After the triggered sync: matches remote.
      return { stdout: revParseCalls === 1 ? 'oldhead\n' : 'newhead\n' };
    }
    if (cmd === 'sudo') return { stdout: '' };
    throw new Error(`unexpected: ${cmd}`);
  };
  const result = await ensureCheckoutSynced({ execImpl, getRemoteMainHeadImpl: async () => 'newhead' });
  assert.equal(result.triggeredSync, true);
  assert.equal(result.head, 'newhead');
  assert.equal(revParseCalls, 2);
});

test('a checkout still stale after the triggered sync is a hard failure, not a silent pass', async () => {
  const execImpl = async (cmd, args) => {
    if (cmd === 'git' && args.includes('rev-parse')) return { stdout: 'oldhead\n' };
    if (cmd === 'sudo') return { stdout: '' };
    throw new Error(`unexpected: ${cmd}`);
  };
  await assert.rejects(
    () => ensureCheckoutSynced({ execImpl, getRemoteMainHeadImpl: async () => 'newhead' }),
    /checkout still at oldhead after triggering a sync, expected newhead/,
  );
});

test('getRemoteMainHead resolves via the GitHub API with the publisher token, not git credentials', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://api.github.com/repos/toddwyder/julia-next/git/ref/heads/main');
    assert.match(init.headers.Authorization, /^Bearer /);
    return { ok: true, json: async () => ({ object: { sha: 'deadbeef' } }) };
  };
  const tokenImpl = async (env) => {
    assert.equal(env.JULIA_PUBLISHER_REPO, 'julia-next');
    return 'ghs_fake';
  };
  const sha = await getRemoteMainHead({ tokenImpl, fetchImpl });
  assert.equal(sha, 'deadbeef');
});

test('getRemoteMainHead surfaces a clear error on an API failure, not a hang', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) });
  await assert.rejects(
    () => getRemoteMainHead({ tokenImpl: async () => 'x', fetchImpl }),
    /could not resolve origin\/main via the GitHub API \(HTTP 404\): Not Found/,
  );
});

test('double-start: a second invocation for the same issue refuses, naming the existing run id', async () => {
  const { impls } = fakeImpls({
    runListImpl: async () => ({ runs: [{ id: 'run_existing111', objective: 'JUL-63' }] }),
  });
  await assert.rejects(() => juliaRun('JUL-63', impls), /a run is already active for JUL-63: run_existing111/);
});

test('findExistingRun matches on exact objective only', async () => {
  const runs = [{ id: 'run_a', objective: 'JUL-62' }, { id: 'run_b', objective: 'JUL-63' }];
  const found = await findExistingRun('JUL-63', { runListImpl: async () => ({ runs }) });
  assert.equal(found.id, 'run_b');
  const notFound = await findExistingRun('JUL-99', { runListImpl: async () => ({ runs }) });
  assert.equal(notFound, null);
});

test('startOrchestrator refuses outside an Orca-managed terminal (no ORCA_TERMINAL_HANDLE)', async () => {
  await assert.rejects(
    () => startOrchestrator('JUL-63', { fromHandle: undefined, runCreateImpl: async () => ({ run: { id: 'x' } }), terminalCreateImpl: async () => ({}) }),
    /ORCA_TERMINAL_HANDLE is not set/,
  );
});

test('happy path: readiness, synced checkout, no existing run -> orchestrator starts, run id returned, comment posted with the trailer', async () => {
  const { impls, calls } = fakeImpls();
  const result = await juliaRun('JUL-63', impls);

  assert.equal(result.runId, 'run_fake456');
  assert.deepEqual(calls.runsCreated, ['JUL-63']);
  assert.equal(calls.terminalsCreated.length, 1);
  assert.match(calls.terminalsCreated[0].command, /julia-coordinator skill.*JUL-63/);

  assert.equal(calls.comments.length, 1);
  const { issueId, body } = calls.comments[0];
  assert.equal(issueId, 'JUL-63');
  assert.match(body, /^Instruction: run started by julia-run at .+, orchestrator run_fake456/);
  assert.match(body, /For Todd:/);
});

test('prepareServerEnvironment fills in ORCA_BIN/ORCA_ENVIRONMENT and loads the publisher env file only when needed', () => {
  const env = {};
  let loaderCalled = false;
  prepareServerEnvironment({ env, loadEnvFileImpl: () => { loaderCalled = true; env.JULIA_PUBLISHER_APP_ID = 'loaded'; } });
  assert.equal(env.ORCA_BIN, '/opt/Orca/orca-ide');
  assert.equal(env.ORCA_ENVIRONMENT, 'ovh-local');
  assert.equal(loaderCalled, true);
  assert.equal(env.JULIA_PUBLISHER_APP_ID, 'loaded');
});

test('prepareServerEnvironment never overwrites an explicit override', () => {
  const env = { ORCA_BIN: '/custom/orca', ORCA_ENVIRONMENT: 'custom-env', JULIA_PUBLISHER_APP_ID: 'already-set', JULIA_PUBLISHER_APP_PRIVATE_KEY: 'already-set' };
  prepareServerEnvironment({ env, loadEnvFileImpl: () => { throw new Error('must not load when creds are already present'); } });
  assert.equal(env.ORCA_BIN, '/custom/orca');
  assert.equal(env.ORCA_ENVIRONMENT, 'custom-env');
});

test('defaultPostCommentImpl allows both Linear tool names, so whichever the model picks is permitted', async () => {
  let calledArgs;
  const execImpl = async (cmd, args) => {
    calledArgs = args;
    return { stdout: JSON.stringify({ is_error: false, permission_denials: [], result: 'posted' }) };
  };
  await defaultPostCommentImpl('JUL-64', 'body text', { execImpl });
  const allowedToolsIndex = calledArgs.indexOf('--allowedTools');
  assert.equal(calledArgs[allowedToolsIndex + 1], 'mcp__linear__save_comment,mcp__claude_ai_Linear__save_comment');
  assert.deepEqual(calledArgs.slice(-2), ['--output-format', 'json']);
});

test('defaultPostCommentImpl throws when the tool call was denied, even though claude -p itself exits 0 (JUL-63, hit live)', async () => {
  const execImpl = async () => ({
    stdout: JSON.stringify({
      is_error: false,
      permission_denials: [{ tool_name: 'mcp__claude_ai_Linear__save_comment' }],
      result: "I couldn't post the comment -- permission needed first.",
    }),
  });
  await assert.rejects(
    () => defaultPostCommentImpl('JUL-64', 'body text', { execImpl }),
    /failed to post the start comment on JUL-64: I couldn't post the comment/,
  );
});

test('defaultPostCommentImpl throws on is_error even with no permission_denials', async () => {
  const execImpl = async () => ({ stdout: JSON.stringify({ is_error: true, permission_denials: [], result: 'something else went wrong' }) });
  await assert.rejects(
    () => defaultPostCommentImpl('JUL-64', 'body text', { execImpl }),
    /failed to post the start comment on JUL-64: something else went wrong/,
  );
});
