import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectWorkerResult } from './collect-worker-result.mjs';

function fakeGit(responses) {
  const calls = [];
  const gitImpl = async (args) => {
    calls.push(args);
    const key = args.join(' ');
    if (!(key in responses)) throw new Error(`unexpected git call: ${key}`);
    return { stdout: responses[key] };
  };
  return { calls, gitImpl };
}

// Stand-in for AI-Stack's createWorkerResult, injected rather than imported
// across repos from inside this module -- the real one is wired in by the
// script that already has the AI-Stack checkout path.
function fakeCreateWorkerResult(args) {
  return { ...args, frozenBy: 'fakeCreateWorkerResult' };
}

test('collectWorkerResult reads the real branch and commit from the worktree, not a caller-supplied guess', async () => {
  const { calls, gitImpl } = fakeGit({
    'branch --show-current': 'graph/JUL-43/run-jul43',
    'rev-parse HEAD': 'a'.repeat(40),
  });
  const result = await collectWorkerResult({
    runId: 'run-jul43', workItemId: 'JUL-43', worktree: 'C:\\runner\\wt', baseCommit: 'b'.repeat(40),
    orcaOutcome: 'succeeded', gitImpl, createWorkerResultImpl: fakeCreateWorkerResult,
  });
  assert.equal(result.branch, 'graph/JUL-43/run-jul43');
  assert.equal(result.commit, 'a'.repeat(40));
  assert.equal(result.baseCommit, 'b'.repeat(40));
  assert.equal(result.worktree, 'C:\\runner\\wt');
  assert.deepEqual(calls, [['branch', '--show-current'], ['rev-parse', 'HEAD']]);
});

test('an Orca "succeeded" outcome maps to launched:true, exitCode:0, timedOut:false', async () => {
  const { gitImpl } = fakeGit({ 'branch --show-current': 'b', 'rev-parse HEAD': 'c'.repeat(40) });
  const result = await collectWorkerResult({
    runId: 'r', workItemId: 'w', worktree: 'wt', baseCommit: 'd'.repeat(40),
    orcaOutcome: 'succeeded', gitImpl, createWorkerResultImpl: fakeCreateWorkerResult,
  });
  assert.deepEqual(result.process, { launched: true, exitCode: 0, timedOut: false });
});

test('an Orca "timed_out" outcome maps to timedOut:true', async () => {
  const { gitImpl } = fakeGit({ 'branch --show-current': 'b', 'rev-parse HEAD': 'c'.repeat(40) });
  const result = await collectWorkerResult({
    runId: 'r', workItemId: 'w', worktree: 'wt', baseCommit: 'd'.repeat(40),
    orcaOutcome: 'timed_out', gitImpl, createWorkerResultImpl: fakeCreateWorkerResult,
  });
  assert.equal(result.process.timedOut, true);
});

test('an unrecognized Orca outcome maps to launched:false rather than guessing success', async () => {
  const { gitImpl } = fakeGit({ 'branch --show-current': 'b', 'rev-parse HEAD': 'c'.repeat(40) });
  const result = await collectWorkerResult({
    runId: 'r', workItemId: 'w', worktree: 'wt', baseCommit: 'd'.repeat(40),
    orcaOutcome: 'abandoned', gitImpl, createWorkerResultImpl: fakeCreateWorkerResult,
  });
  assert.equal(result.process.launched, false);
});

test('evidenceRefs names the real Orca outcome, not a placeholder', async () => {
  const { gitImpl } = fakeGit({ 'branch --show-current': 'b', 'rev-parse HEAD': 'c'.repeat(40) });
  const result = await collectWorkerResult({
    runId: 'r', workItemId: 'w', worktree: 'wt', baseCommit: 'd'.repeat(40),
    orcaOutcome: 'succeeded', gitImpl, createWorkerResultImpl: fakeCreateWorkerResult,
  });
  assert.ok(result.evidenceRefs.some((ref) => ref.includes('succeeded')));
});
