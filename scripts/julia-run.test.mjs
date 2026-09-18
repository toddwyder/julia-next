import test from 'node:test';
import assert from 'node:assert/strict';

import {
  juliaRun, assertIssueId, assertAccount, assertReady, ensureCheckoutSynced, findExistingRun, isRunFinished, startOrchestrator,
  startOrchestratorEntry, orchestratorLaunchCommandFor, waitForEarlyCapError, CAP_ERROR_PATTERN,
  prepareServerEnvironment, getRemoteMainHead,
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
  const calls = { runsCreated: [], terminalsCreated: [], syncTriggered: false };
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
      isRunFinishedImpl: async () => false,
      fromHandle: 'term_fake123',
      runCreateImpl: async ({ objective }) => {
        calls.runsCreated.push(objective);
        return { run: { id: 'run_fake456', objective } };
      },
      terminalCreateImpl: async (args) => {
        calls.terminalsCreated.push(args);
        return { terminal: { handle: 'term_fake789' } };
      },
      waitForEarlyCapErrorImpl: async () => false,
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
  const isRunFinishedImpl = async () => false;
  const found = await findExistingRun('JUL-63', { runListImpl: async () => ({ runs }), isRunFinishedImpl });
  assert.equal(found.id, 'run_b');
  const notFound = await findExistingRun('JUL-99', { runListImpl: async () => ({ runs }), isRunFinishedImpl });
  assert.equal(notFound, null);
});

test('findExistingRun does not treat a finished run as blocking (restart guard, JUL-70)', async () => {
  const runs = [{ id: 'run_b', objective: 'JUL-63' }];
  const found = await findExistingRun('JUL-63', { runListImpl: async () => ({ runs }), isRunFinishedImpl: async () => true });
  assert.equal(found, null);
});

test('isRunFinished: a run with an active task still refuses (JUL-70)', async () => {
  const taskListImpl = async () => ({ tasks: [{ id: 't1', status: 'running' }] });
  const finished = await isRunFinished({ id: 'run_x', updated_at: new Date().toISOString() }, { taskListImpl });
  assert.equal(finished, false);
});

test('isRunFinished: every task terminal -> finished, restart allowed (JUL-70)', async () => {
  const taskListImpl = async () => ({ tasks: [{ id: 't1', status: 'completed' }, { id: 't2', status: 'failed' }] });
  const finished = await isRunFinished({ id: 'run_x', updated_at: new Date().toISOString() }, { taskListImpl });
  assert.equal(finished, true);
});

test('isRunFinished: a zero-task run just created is still within its preflight grace window, not finished', async () => {
  const taskListImpl = async () => ({ tasks: [] });
  const finished = await isRunFinished(
    { id: 'run_x', updated_at: new Date().toISOString() },
    { taskListImpl, now: () => Date.now() },
  );
  assert.equal(finished, false);
});

test('isRunFinished: a zero-task run stopped at preflight (JUL-44s real case) is finished once past the grace window', async () => {
  const taskListImpl = async () => ({ tasks: [] });
  const oldTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const finished = await isRunFinished(
    { id: 'run_c404a384fb43', updated_at: oldTimestamp },
    { taskListImpl, now: () => Date.now() },
  );
  assert.equal(finished, true);
});

test('startOrchestratorEntry refuses outside an Orca-managed terminal (no ORCA_TERMINAL_HANDLE)', async () => {
  // This test must simulate the "outside an Orca-managed terminal" state
  // explicitly: when the suite itself is run from inside an Orca terminal,
  // the ambient ORCA_TERMINAL_HANDLE would satisfy the default and the
  // expected refusal would never happen. Clear it for the assertion only.
  const savedHandle = process.env.ORCA_TERMINAL_HANDLE;
  delete process.env.ORCA_TERMINAL_HANDLE;
  try {
    await assert.rejects(
      () => startOrchestratorEntry('JUL-63', 'claude', { fromHandle: undefined, runCreateImpl: async () => ({ run: { id: 'x' } }), terminalCreateImpl: async () => ({}) }),
      /ORCA_TERMINAL_HANDLE is not set/,
    );
  } finally {
    if (savedHandle !== undefined) process.env.ORCA_TERMINAL_HANDLE = savedHandle;
  }
});

test('happy path: readiness, synced checkout, no existing run -> orchestrator starts on the table primary, run id returned, no start-comment call', async () => {
  const { impls, calls } = fakeImpls();
  const result = await juliaRun('JUL-63', impls);

  assert.equal(result.runId, 'run_fake456');
  assert.equal(result.usedEntry, 'claude');
  assert.equal(result.failedOverFrom, undefined);
  assert.deepEqual(calls.runsCreated, ['JUL-63']);
  assert.equal(calls.terminalsCreated.length, 1);
  assert.match(calls.terminalsCreated[0].command, /export ORCA_BIN=\/opt\/Orca\/orca-ide ORCA_ENVIRONMENT=ovh-local/);
  assert.match(calls.terminalsCreated[0].command, /set -a; \. \/etc\/orchestrator-svc\/\.env\.publisher; set \+a/);
  assert.match(calls.terminalsCreated[0].command, /\/julia-coordinator JUL-63/);
  assert.match(calls.terminalsCreated[0].command, /--allowedTools/);
  assert.match(calls.terminalsCreated[0].command, /mcp__linear__\*/);
  assert.match(calls.terminalsCreated[0].command, /mcp__claude_ai_Linear__\*/);
  assert.match(calls.terminalsCreated[0].command, /Bash\(node --env-file=\/etc\/orchestrator-svc\/\.env\.publisher scripts\/publish-pr\.mjs:\*\)/);
  assert.match(calls.terminalsCreated[0].command, /Bash\(node --env-file=\/etc\/orchestrator-svc\/\.env\.publisher scripts\/merge-pr\.mjs:\*\)/);
  assert.match(calls.terminalsCreated[0].command, /Bash\(node scripts\/coordinator-events\.mjs:\*\)/);
});

test('orchestratorLaunchCommandFor: claude is the table primary, unchanged shape', () => {
  const command = orchestratorLaunchCommandFor('claude', 'JUL-63');
  assert.match(command, /claude --permission-mode acceptEdits/);
});

test('orchestratorLaunchCommandFor: pi-glm (the table backup) pipes the skill into run-pi-seat.mjs, orchestrator-backup seat, no secret in the string', () => {
  const command = orchestratorLaunchCommandFor('pi-glm', 'JUL-63');
  assert.match(command, /export ORCA_BIN=\/opt\/Orca\/orca-ide ORCA_ENVIRONMENT=ovh-local/);
  assert.match(command, /set -a; \. \/etc\/orchestrator-svc\/\.env\.publisher; set \+a/);
  assert.match(command, /cat \.claude\/skills\/julia-coordinator\/SKILL\.md/);
  assert.match(command, /\| node ops\/service-dropbox\/run-pi-seat\.mjs orchestrator-backup --effort medium/);
  assert.match(command, /JUL-63/);
  assert.doesNotMatch(command, /claude --permission-mode/);
  assert.doesNotMatch(command, /codex exec/);
  // No API key, no ZAI/DeepSeek-shaped literal anywhere in the launch string.
  assert.doesNotMatch(command, /ZAI_PAYG_API_KEY|DEEPSEEK_API_KEY/);
});

test('orchestratorLaunchCommandFor refuses an unknown table entry', () => {
  assert.throws(() => orchestratorLaunchCommandFor('gemini', 'JUL-63'), /unknown orchestrator seat-table entry: gemini/);
});

// JUL-79 step 3: the launch commands carry the ticket's per-agent effort.
// Claude and Codex have graded settings; Pi translates Low to "no --thinking"
// and Medium/High to the flag inside run-pi-seat.mjs (the launcher passes the
// neutral label through, never a vendor flag). Every command is asserted as
// its exact string so a silently dropped ENV_PREFIX, skill path, issue id or
// sandbox level cannot pass review.
const ENV_PREFIX_EXPECTED = 'export ORCA_BIN=/opt/Orca/orca-ide ORCA_ENVIRONMENT=ovh-local; set -a; . /etc/orchestrator-svc/.env.publisher; set +a;';
const PIPED_PROMPT_EXPECTED = (issueId) => `{ cat .claude/skills/julia-coordinator/SKILL.md; printf '\\n\\nIssue: %s\\n' '${issueId}'; }`;

test('orchestratorLaunchCommandFor: codex pipes the skill + issue id to `codex exec -` with full-access sandbox and the translated effort', () => {
  assert.equal(
    orchestratorLaunchCommandFor('codex', 'JUL-79', { effort: 'high' }),
    `${ENV_PREFIX_EXPECTED} ${PIPED_PROMPT_EXPECTED('JUL-79')} | codex exec - -s danger-full-access -c model_reasoning_effort=high`,
  );
});

test('orchestratorLaunchCommandFor: pi-deepseek pipes the skill + issue id to the new orchestrator-deepseek seat with the effort label', () => {
  assert.equal(
    orchestratorLaunchCommandFor('pi-deepseek', 'JUL-79', { effort: 'high' }),
    `${ENV_PREFIX_EXPECTED} ${PIPED_PROMPT_EXPECTED('JUL-79')} | node ops/service-dropbox/run-pi-seat.mjs orchestrator-deepseek --effort high`,
  );
});

test('orchestratorLaunchCommandFor: an omitted effort is exactly Medium on every entry', () => {
  for (const entry of ['claude', 'codex', 'pi-deepseek', 'pi-glm']) {
    assert.equal(
      orchestratorLaunchCommandFor(entry, 'JUL-79'),
      orchestratorLaunchCommandFor(entry, 'JUL-79', { effort: 'medium' }),
      `${entry} default-medium`,
    );
  }
});

test('orchestratorLaunchCommandFor: claude still gets its full tool grant list, with --effort inserted after --permission-mode', () => {
  const command = orchestratorLaunchCommandFor('claude', 'JUL-79', { effort: 'low' });
  assert.match(command, /claude --permission-mode acceptEdits --effort low --allowedTools /);
  assert.match(command, /mcp__linear__\*/);
  assert.match(command, /mcp__claude_ai_Linear__\*/);
  assert.match(command, /Bash\(node --env-file=\/etc\/orchestrator-svc\/\.env\.publisher scripts\/publish-pr\.mjs:\*\)/);
  assert.match(command, /Bash\(orca \*\)/);
  assert.match(command, /-p "\/julia-coordinator JUL-79"$/);
});

test('orchestratorLaunchCommandFor: pi-glm passes the effort label to its seat, and never a vendor flag or a secret', () => {
  const command = orchestratorLaunchCommandFor('pi-glm', 'JUL-79', { effort: 'low' });
  assert.equal(
    command,
    `${ENV_PREFIX_EXPECTED} ${PIPED_PROMPT_EXPECTED('JUL-79')} | node ops/service-dropbox/run-pi-seat.mjs orchestrator-backup --effort low`,
  );
  assert.doesNotMatch(command, /--thinking|model_reasoning_effort/);
  assert.doesNotMatch(command, /ZAI_PAYG_API_KEY|DEEPSEEK_API_KEY/);
});

test('an unknown seat-table entry fails before a run is created, so retrying after fixing it never blocks on an orphan run (JUL-73 review finding, preserved under the seat table)', async () => {
  const { impls, calls } = fakeImpls({ seatTable: { orchestrator: { primary: 'gemini', backup: 'pi-glm' } } });
  await assert.rejects(() => juliaRun('JUL-63', impls), /unknown orchestrator seat-table entry: gemini/);
  assert.deepEqual(calls.runsCreated, []);
  assert.equal(calls.terminalsCreated.length, 0);
});

test('startOrchestrator: no cap error -> stays on the table primary', async () => {
  const { impls, calls } = fakeImpls();
  const result = await startOrchestrator('JUL-63', impls);
  assert.equal(result.usedEntry, 'claude');
  assert.equal(result.failedOverFrom, undefined);
  assert.equal(calls.runsCreated.length, 1);
  assert.equal(calls.terminalsCreated.length, 1);
});

test('startOrchestrator: an early cap error on the primary fails over to the table backup, same objective, one retry', async () => {
  const { impls, calls } = fakeImpls({ waitForEarlyCapErrorImpl: async () => true });
  const result = await startOrchestrator('JUL-63', impls);
  assert.equal(result.usedEntry, 'pi-glm');
  assert.equal(result.failedOverFrom, 'claude');
  // Both attempts target the same issue, and both a run and a terminal exist for each.
  assert.deepEqual(calls.runsCreated, ['JUL-63', 'JUL-63']);
  assert.equal(calls.terminalsCreated.length, 2);
  assert.match(calls.terminalsCreated[0].command, /claude --permission-mode/);
  assert.match(calls.terminalsCreated[1].command, /run-pi-seat\.mjs orchestrator-backup/);
});

test('startOrchestrator: no retry on any other error -- waitForEarlyCapError never resolving true for a non-cap failure means the primary run stands', async () => {
  // A non-cap error (or a still-running session past the check window) is
  // exactly what waitForEarlyCapError reports as `false` -- only the cap
  // pattern itself triggers a retry, nothing else does.
  const { impls, calls } = fakeImpls({ waitForEarlyCapErrorImpl: async () => false });
  const result = await startOrchestrator('JUL-63', impls);
  assert.equal(result.usedEntry, 'claude');
  assert.equal(calls.terminalsCreated.length, 1);
});

test('waitForEarlyCapError: detects the verbatim Codex cap text captured live this session', async () => {
  const terminalReadImpl = async () => ({ terminal: { tail: ["■ You've hit your usage limit. Upgrade to Pro..., try again at Sep 19th, 2026 7:28 PM."] } });
  const capped = await waitForEarlyCapError('term_x', { terminalWaitImpl: async () => {}, terminalReadImpl });
  assert.equal(capped, true);
});

test('waitForEarlyCapError: a terminalWait timeout is not itself evidence of a cap -- falls through to reading current output', async () => {
  const terminalReadImpl = async () => ({ terminal: { tail: ['still working, no cap message here'] } });
  const capped = await waitForEarlyCapError('term_x', {
    terminalWaitImpl: async () => { throw new Error('timed out waiting for tui-idle'); },
    terminalReadImpl,
  });
  assert.equal(capped, false);
});

test('waitForEarlyCapError: ordinary output, no cap pattern -> false (no retry on any other error)', async () => {
  const terminalReadImpl = async () => ({ terminal: { tail: ['some unrelated error: ECONNRESET'] } });
  const capped = await waitForEarlyCapError('term_x', { terminalWaitImpl: async () => {}, terminalReadImpl });
  assert.equal(capped, false);
});

test('CAP_ERROR_PATTERN matches common vendor cap phrasing', () => {
  assert.match("You've hit your usage limit", CAP_ERROR_PATTERN);
  assert.match('quota exceeded for this project', CAP_ERROR_PATTERN);
  assert.match('rate limit exceeded, try again later', CAP_ERROR_PATTERN);
  assert.doesNotMatch('connection refused', CAP_ERROR_PATTERN);
});

test('no defaultPostCommentImpl and no separate start-comment call: the coordinator posts its own comments during its wake', async () => {
  const { impls } = fakeImpls();
  const postCommentImpl = async () => { throw new Error('julia-run must not post a start comment itself'); };
  await assert.doesNotReject(() => juliaRun('JUL-63', { ...impls, postCommentImpl }));
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

