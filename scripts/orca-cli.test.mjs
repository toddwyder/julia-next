import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCreate, terminalWait, workerShow, workerStart } from './orca-cli.mjs';

function fakeExec(stdout) {
  const calls = [];
  const execImpl = async (bin, args) => {
    calls.push({ bin, args });
    return { stdout: JSON.stringify(stdout), stderr: '' };
  };
  return { calls, execImpl };
}

test('runCreate invokes orca orchestration run-create with --json and returns the parsed run', async () => {
  const { calls, execImpl } = fakeExec({ run_id: 'run_abc' });
  const result = await runCreate({
    environment: 'OVH runner', from: 'term-1', objective: 'JUL-43 coordinator run', execImpl,
  });
  assert.equal(result.run_id, 'run_abc');
  assert.equal(calls[0].bin, 'orca');
  assert.deepEqual(calls[0].args, [
    'orchestration', 'run-create',
    '--environment', 'OVH runner',
    '--from', 'term-1',
    '--objective', 'JUL-43 coordinator run',
    '--json',
  ]);
});

test('workerStart passes every required flag through, including --agent codex', async () => {
  const { calls, execImpl } = fakeExec({ dispatch_id: 'ctx_1', task_id: 'task_1' });
  const result = await workerStart({
    run: 'run_abc', environment: 'OVH runner', from: 'term-1', spec: 'do the thing',
    worktree: 'new-top-level', name: 'jul43-run', execImpl,
  });
  assert.equal(result.dispatch_id, 'ctx_1');
  assert.deepEqual(calls[0].args, [
    'orchestration', 'worker-start',
    '--run', 'run_abc',
    '--environment', 'OVH runner',
    '--from', 'term-1',
    '--spec', 'do the thing',
    '--worktree', 'new-top-level',
    '--name', 'jul43-run',
    '--agent', 'codex',
    '--setup', 'skip',
    '--json',
  ]);
});

test('terminalWait polls with --for tui-idle and the given timeout', async () => {
  const { calls, execImpl } = fakeExec({ state: 'tui-idle' });
  await terminalWait({ environment: 'OVH runner', terminal: 'term-2', timeoutMs: 60000, execImpl });
  assert.deepEqual(calls[0].args, [
    'terminal', 'wait',
    '--environment', 'OVH runner',
    '--terminal', 'term-2',
    '--for', 'tui-idle',
    '--timeout-ms', '60000',
    '--json',
  ]);
});

test('workerShow returns the parsed projection, including outcome', async () => {
  const { execImpl } = fakeExec({ projection: { outcome: 'succeeded' } });
  const result = await workerShow({ environment: 'OVH runner', dispatch: 'ctx_1', execImpl });
  assert.equal(result.projection.outcome, 'succeeded');
});

test('a non-JSON response from orca fails clearly instead of returning undefined', async () => {
  const execImpl = async () => ({ stdout: 'not json', stderr: '' });
  await assert.rejects(
    () => runCreate({ environment: 'OVH runner', from: 'term-1', objective: 'x', execImpl }),
    /orchestration run-create .* did not return valid JSON/,
  );
});

test('a failing orca process (non-zero exit) surfaces stderr, not a silent empty result', async () => {
  const execImpl = async () => {
    const error = new Error('command failed');
    error.stderr = 'environment "OVH runner" is not paired';
    throw error;
  };
  await assert.rejects(
    () => runCreate({ environment: 'OVH runner', from: 'term-1', objective: 'x', execImpl }),
    /environment "OVH runner" is not paired/,
  );
});
