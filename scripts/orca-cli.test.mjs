import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runCreate, terminalCreate, terminalRead, terminalWait, workerShow, workerStart,
} from './orca-cli.mjs';

// Fixtures below are real `orca <cmd> --json` output, captured live against
// the installed CLI on 2026-09-16 (JUL-43 coordinator session), not guessed.
// Every orchestration/terminal command wraps its payload in
// {id, ok, result, _meta}, and a failure is {id, ok:false, error:{code,message}}
// -- the CLI's --help text does not show this envelope, only each command's
// own flags, so this had to be checked by actually running it.

function fakeExec(stdout) {
  const calls = [];
  const execImpl = async (bin, args) => {
    calls.push({ bin, args });
    return { stdout: JSON.stringify(stdout), stderr: '' };
  };
  return { calls, execImpl };
}

test('runCreate unwraps the {result: {run, mutation}} envelope and returns it', async () => {
  const { calls, execImpl } = fakeExec({
    id: '1651f47f-0102-4fd0-901f-f131caac6787',
    ok: true,
    result: {
      run: {
        id: 'run_37ae713edd5c',
        objective: 'JUL-43 coordinator run',
        coordinator_handle: 'term_edd1057b-c44b-4e95-b513-05851efcc6c2',
        consumer_generation: 1,
        legacy: 0,
        created_at: '2026-09-16T16:31:18Z',
        updated_at: '2026-09-16T16:31:18Z',
      },
      mutation: { requestId: '1cf8548e-1db5-428e-b50b-4e8f0fdac01b', replayed: false },
    },
    _meta: { runtimeId: '88ad9f01-fcf3-473b-ad82-0fe01b2a8961' },
  });
  const result = await runCreate({
    environment: 'OVH runner', from: 'term-1', objective: 'JUL-43 coordinator run', execImpl,
  });
  assert.equal(result.run.id, 'run_37ae713edd5c');
  assert.equal(calls[0].bin, 'orca');
  assert.deepEqual(calls[0].args, [
    'orchestration', 'run-create',
    '--environment', 'OVH runner',
    '--from', 'term-1',
    '--objective', 'JUL-43 coordinator run',
    '--json',
  ]);
});

test('a structured {ok:false, error} response throws with the real code and message, not a silent undefined', async () => {
  const { execImpl } = fakeExec({
    id: 'local',
    ok: false,
    error: {
      code: 'no_active_sender_terminal',
      message: 'Could not determine the sender terminal for this orchestration command. Pass --from <terminal-handle> or run the command inside a live Orca terminal with ORCA_TERMINAL_HANDLE set.',
    },
    _meta: { runtimeId: null },
  });
  await assert.rejects(
    () => runCreate({ environment: 'OVH runner', from: '', objective: 'x', execImpl }),
    /no_active_sender_terminal.*Could not determine the sender terminal/s,
  );
});

test('workerStart passes every required flag through, including --agent codex', async () => {
  const { calls, execImpl } = fakeExec({
    id: 'probe', ok: true, result: { dispatch: { id: 'ctx_1', taskId: 'task_1' } }, _meta: {},
  });
  const result = await workerStart({
    run: 'run_abc', environment: 'OVH runner', from: 'term-1', spec: 'do the thing',
    worktree: 'new-top-level', name: 'jul43-run', execImpl,
  });
  assert.equal(result.dispatch.id, 'ctx_1');
  assert.deepEqual(calls[0].args, [
    'orchestration', 'worker-start',
    '--environment', 'OVH runner',
    '--run', 'run_abc',
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
  const { calls, execImpl } = fakeExec({ id: 'p', ok: true, result: { state: 'tui-idle' }, _meta: {} });
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
  const { execImpl } = fakeExec({ id: 'p', ok: true, result: { projection: { outcome: 'succeeded' } }, _meta: {} });
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

test('a real nonzero-exit failure carrying structured {ok:false,error} JSON on stdout surfaces that code/message, not a generic wrapper error (PR #3 review finding C1)', async () => {
  // Confirmed live: `orca orchestration worker-show --dispatch <missing> --json`
  // exits 1 with the structured failure body on STDOUT, not stderr.
  // execFile's promisified rejection still carries it on error.stdout.
  const execImpl = async () => {
    const error = new Error('Command failed: orca orchestration worker-show --dispatch missing --json');
    error.stdout = JSON.stringify({ id: 'x', ok: false, error: { code: 'dispatch_not_found', message: 'No dispatch with id missing' }, _meta: {} });
    error.stderr = '';
    throw error;
  };
  await assert.rejects(
    () => workerShow({ environment: 'OVH runner', dispatch: 'missing', execImpl }),
    /dispatch_not_found.*No dispatch with id missing/s,
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

test('terminalCreate runs a plain shell command in the given worktree, not an agent -- real nested terminal.handle shape', async () => {
  const { calls, execImpl } = fakeExec({
    id: '1a71987d-1d1d-4b2b-b68c-edeabe3b5f90',
    ok: true,
    result: {
      terminal: {
        handle: 'term_edd1057b-c44b-4e95-b513-05851efcc6c2',
        tabId: 'd22d9849-f665-40a4-8862-de01738784fc',
        title: 'coordinator-diag',
        hostPlatform: 'linux',
        surface: 'background',
      },
    },
    _meta: { runtimeId: '88ad9f01-fcf3-473b-ad82-0fe01b2a8961' },
  });
  const result = await terminalCreate({
    environment: 'OVH runner',
    worktree: 'path:/home/runner/julia-next',
    command: 'curl -s -X POST http://127.0.0.1:8943/events',
    title: 'coordinator-diag',
    execImpl,
  });
  assert.equal(result.terminal.handle, 'term_edd1057b-c44b-4e95-b513-05851efcc6c2');
  assert.deepEqual(calls[0].args, [
    'terminal', 'create',
    '--environment', 'OVH runner',
    '--worktree', 'path:/home/runner/julia-next',
    '--command', 'curl -s -X POST http://127.0.0.1:8943/events',
    '--title', 'coordinator-diag',
    '--json',
  ]);
});

test('terminalRead returns the real {terminal: {tail: [...]}} shape, not a flat output string', async () => {
  const { calls, execImpl } = fakeExec({
    id: 'c87fe957-152a-48df-bed5-7fcd120488a9',
    ok: true,
    result: {
      terminal: {
        handle: 'term_edd1057b-c44b-4e95-b513-05851efcc6c2',
        status: 'running',
        tail: [
          'runner@vps-ce27cb55:~/julia-next$ curl ...',
          '{"sent":true,"event":"journey-relay.readiness-check"}',
          'runner@vps-ce27cb55:~/julia-next$',
        ],
        truncated: false,
        nextCursor: '2',
      },
    },
    _meta: { runtimeId: '88ad9f01-fcf3-473b-ad82-0fe01b2a8961' },
  });
  const result = await terminalRead({ environment: 'OVH runner', terminal: 'term_edd1057b-c44b-4e95-b513-05851efcc6c2', execImpl });
  assert.ok(Array.isArray(result.terminal.tail));
  assert.match(result.terminal.tail.join('\n'), /"sent":true/);
  assert.deepEqual(calls[0].args, [
    'terminal', 'read',
    '--environment', 'OVH runner',
    '--terminal', 'term_edd1057b-c44b-4e95-b513-05851efcc6c2',
    '--json',
  ]);
});
