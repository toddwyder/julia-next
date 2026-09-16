import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCoordinator } from './run-jul43-coordinator.mjs';

function harness(overrides = {}) {
  const events = [];
  const selection = {
    tracker: 'linear', issue: 'JUL-43', issueId: 'uuid-jul-43', issueTitle: 'Prepare the remote builder',
    workItemId: 'JUL-43', issueUrl: 'https://linear.app/julia-next/issue/JUL-43',
    workDefinitionPath: '/tmp/wd.md', contextPath: '/tmp/ctx.md', selectionPath: '/tmp/selection.json',
  };
  const deps = {
    expectedIssue: 'JUL-43',
    runId: 'run-jul43',
    environment: 'OVH runner',
    fromTerminal: 'term-1',
    worktreeName: 'new-top-level',
    baseCommit: 'a'.repeat(40),
    readFileImpl: async () => 'file contents',
    prepareImpl: async () => selection,
    runCreateImpl: async () => ({ run_id: 'run_abc' }),
    workerStartImpl: async () => ({ dispatch_id: 'ctx_1', terminal: 'term-2', worktree: 'C:\\runner\\wt' }),
    terminalWaitImpl: async () => ({ state: 'tui-idle' }),
    workerShowImpl: async () => ({ projection: { outcome: 'succeeded' } }),
    collectResultImpl: async () => ({
      runId: 'run-jul43', workItemId: 'JUL-43', branch: 'graph/JUL-43/run-jul43', commit: 'b'.repeat(40),
      baseCommit: 'a'.repeat(40), worktree: 'C:\\runner\\wt', pullRequest: null, evidenceRefs: ['x'],
      process: { launched: true, exitCode: 0, timedOut: false }, outcome: 'completed',
    }),
    publishStartImpl: async () => ({ html_url: 'https://linear.app/c1' }),
    publishFinishImpl: async () => ({ outcome: 'completed', published: true, pullRequest: { html_url: 'https://github.com/toddwyder/julia-next/pull/9' } }),
    recordEventImpl: async (stage, ctx) => { events.push({ stage, ctx }); },
    ...overrides,
  };
  return { deps, events };
}

test('a successful run emits started, progress (at least once), then completed -- in that order', async () => {
  const { deps, events } = harness();
  await runCoordinator(deps);
  const stages = events.map((e) => e.stage);
  assert.equal(stages[0], 'started');
  assert.equal(stages.at(-1), 'completed');
  assert.ok(stages.includes('progress'));
});

test('every emitted event carries the same run ID', async () => {
  const { deps, events } = harness();
  await runCoordinator(deps);
  assert.ok(events.every((e) => e.ctx.runId === 'run-jul43'));
});

test('publishStart receives a real run URL built from the actual Orca run and dispatch ids, not a placeholder', async () => {
  const calls = [];
  const { deps } = harness({ publishStartImpl: async (args) => { calls.push(args); return { html_url: 'x' }; } });
  await runCoordinator(deps);
  assert.equal(calls.length, 1);
  assert.match(calls[0].runUrl, /run_abc/);
  assert.match(calls[0].runUrl, /ctx_1/);
  assert.doesNotMatch(calls[0].runUrl, /<.*>/); // no unfilled angle-bracket placeholder
});

test('the worker result is collected from real git/Orca state, not hand-authored, and flows into publishFinish', async () => {
  const collectCalls = [];
  const finishCalls = [];
  const { deps } = harness({
    collectResultImpl: async (args) => { collectCalls.push(args); return { outcome: 'completed', evidenceRefs: ['orca-worker-outcome:succeeded'], branch: 'b', commit: 'c'.repeat(40), baseCommit: 'a'.repeat(40), worktree: 'wt', pullRequest: null, runId: 'run-jul43', workItemId: 'JUL-43', process: { launched: true, exitCode: 0, timedOut: false } }; },
    publishFinishImpl: async (args) => { finishCalls.push(args); return { outcome: 'completed', published: true, pullRequest: { html_url: 'https://github.com/x/pull/1' } }; },
  });
  await runCoordinator(deps);
  assert.equal(collectCalls[0].orcaOutcome, 'succeeded');
  assert.equal(collectCalls[0].worktree, 'C:\\runner\\wt');
  assert.equal(finishCalls[0].result.evidenceRefs[0], 'orca-worker-outcome:succeeded');
});

test('a step that throws emits a failed event with the real error message and rethrows -- it does not swallow the failure', async () => {
  const { deps, events } = harness({
    workerStartImpl: async () => { throw new Error('environment "OVH runner" is not paired'); },
  });
  await assert.rejects(() => runCoordinator(deps), /not paired/);
  const failed = events.find((e) => e.stage === 'failed');
  assert.ok(failed);
  assert.match(failed.ctx.error, /not paired/);
});

test('a worker outcome other than success still publishes a finish report and completes the run (not an unhandled crash)', async () => {
  const { deps, events } = harness({
    workerShowImpl: async () => ({ projection: { outcome: 'failed' } }),
    collectResultImpl: async () => ({
      runId: 'run-jul43', workItemId: 'JUL-43', branch: 'b', commit: 'c'.repeat(40), baseCommit: 'a'.repeat(40),
      worktree: 'wt', pullRequest: null, evidenceRefs: ['orca-worker-outcome:failed'],
      process: { launched: true, exitCode: 1, timedOut: false }, outcome: 'failed',
    }),
    publishFinishImpl: async () => ({ outcome: 'failed', published: false, pullRequest: null }),
  });
  const result = await runCoordinator(deps);
  assert.equal(result.finish.published, false);
  assert.ok(events.some((e) => e.stage === 'failed'));
});
