// CLI-entry tests for scripts/orca-cli.mjs (JUL-79 step 6).
//
// The unattended coordinator needs a repo command for the Orca run/task
// lookups so it never writes an inline script that is not on its
// --allowedTools list. These tests exercise the argv parsing, the
// ORCA_ENVIRONMENT default, pretty-JSON stdout, and the failure exit
// paths by injecting a fake exec -- the real `orca` binary is never run.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { main } from './orca-cli.mjs';

// A fake `orca` invocation: returns one canned {id, ok, result, _meta}
// envelope (or a function that builds one per call) and records every
// call so the exact flags can be asserted.
function fakeExec(payload) {
  const calls = [];
  const execImpl = async (bin, args) => {
    calls.push({ bin, args });
    const next = typeof payload === 'function' ? payload(bin, args) : payload;
    return { stdout: JSON.stringify(next), stderr: '' };
  };
  return { calls, execImpl };
}

// Run the exported main() with captured streams and a captured exit code,
// so no subprocess and no real orca binary is involved.
async function runCli(argv, { execImpl, env = {} } = {}) {
  let out = '';
  let err = '';
  let code;
  const stdout = { write: (chunk) => { out += chunk; } };
  const stderr = { write: (chunk) => { err += chunk; } };
  await main({ argv, execImpl, env, stdout, stderr, setExitCode: (c) => { code = c; } });
  return { out, err, code };
}

test('run-list parses --environment/--limit/--cursor and prints the unwrapped payload as pretty JSON (no Orca envelope)', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: { runs: [{ id: 'run_1' }], nextCursor: 'c2' }, _meta: {} });
  const { out, err, code } = await runCli(
    ['run-list', '--environment', 'orchestrator-local', '--limit', '5', '--cursor', 'c1'],
    { execImpl },
  );
  assert.equal(code, 0);
  assert.equal(err, '');
  assert.deepEqual(JSON.parse(out), { runs: [{ id: 'run_1' }], nextCursor: 'c2' });
  // Pretty, 2-space indented JSON, not a single compact line.
  assert.match(out, /\n {2}"runs"/);
  // The Orca {id, ok, result, _meta} envelope must not be printed again.
  assert.doesNotMatch(out, /"ok": true|"_meta"/);
  assert.deepEqual(calls[0].args, [
    'orchestration', 'run-list',
    '--environment', 'orchestrator-local',
    '--json',
    '--limit', '5',
    '--cursor', 'c1',
  ]);
});

test('--environment defaults to ORCA_ENVIRONMENT when omitted', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: { runs: [] }, _meta: {} });
  const { code } = await runCli(['run-list'], { execImpl, env: { ORCA_ENVIRONMENT: 'orchestrator-local' } });
  assert.equal(code, 0);
  assert.deepEqual(calls[0].args, ['orchestration', 'run-list', '--environment', 'orchestrator-local', '--json']);
});

test('an explicit --environment overrides the ORCA_ENVIRONMENT default (the coordinator runs on ovh-local but its run lives on orchestrator-local)', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: { runs: [] }, _meta: {} });
  const { code } = await runCli(
    ['run-list', '--environment', 'orchestrator-local'],
    { execImpl, env: { ORCA_ENVIRONMENT: 'ovh-local' } },
  );
  assert.equal(code, 0);
  assert.deepEqual(calls[0].args, ['orchestration', 'run-list', '--environment', 'orchestrator-local', '--json']);
});

test('task-list requires --run and passes it through with the default environment', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: { runId: 'run_9', tasks: [] }, _meta: {} });
  const { out, code } = await runCli(
    ['task-list', '--run', 'run_9'],
    { execImpl, env: { ORCA_ENVIRONMENT: 'orchestrator-local' } },
  );
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { runId: 'run_9', tasks: [] });
  assert.deepEqual(calls[0].args, ['orchestration', 'task-list', '--run', 'run_9', '--environment', 'orchestrator-local', '--json']);
});

test('worker-show requires --dispatch and passes it through with the default environment', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: { projection: { outcome: 'succeeded' } }, _meta: {} });
  const { out, code } = await runCli(
    ['worker-show', '--dispatch', 'ctx_1'],
    { execImpl, env: { ORCA_ENVIRONMENT: 'ovh-local' } },
  );
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { projection: { outcome: 'succeeded' } });
  assert.deepEqual(calls[0].args, ['orchestration', 'worker-show', '--environment', 'ovh-local', '--dispatch', 'ctx_1', '--json']);
});

test('task-list without --run is a one-line usage error on stderr, exits non-zero, and calls no Orca command', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: {}, _meta: {} });
  const { out, err, code } = await runCli(['task-list'], { execImpl, env: { ORCA_ENVIRONMENT: 'orchestrator-local' } });
  assert.notEqual(code, 0);
  assert.equal(out, '');
  assert.match(err, /^usage: /);
  assert.equal(err.trim().split('\n').length, 1);
  assert.equal(calls.length, 0);
});

test('worker-show without --dispatch is a one-line usage error on stderr', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: {}, _meta: {} });
  const { err, code } = await runCli(['worker-show'], { execImpl, env: { ORCA_ENVIRONMENT: 'ovh-local' } });
  assert.notEqual(code, 0);
  assert.match(err, /^usage: /);
  assert.equal(calls.length, 0);
});

test('an unknown option is a one-line usage error, not an Orca call', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: {}, _meta: {} });
  const { err, code } = await runCli(['run-list', '--bogus', 'x'], { execImpl, env: { ORCA_ENVIRONMENT: 'e' } });
  assert.notEqual(code, 0);
  assert.match(err, /^usage: /);
  assert.equal(calls.length, 0);
});

test('a missing value for an option is a one-line usage error', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: {}, _meta: {} });
  const { err, code } = await runCli(['run-list', '--limit'], { execImpl, env: { ORCA_ENVIRONMENT: 'e' } });
  assert.notEqual(code, 0);
  assert.match(err, /^usage: /);
  assert.equal(calls.length, 0);
});

test('an unknown subcommand is a one-line usage error', async () => {
  const { err, code } = await runCli(['frobnicate'], { execImpl: fakeExec({}).execImpl });
  assert.notEqual(code, 0);
  assert.match(err, /^usage: /);
});

test('a missing environment (no flag, no ORCA_ENVIRONMENT) is a usage error, not a malformed Orca call', async () => {
  const { calls, execImpl } = fakeExec({ id: 'x', ok: true, result: {}, _meta: {} });
  const { err, code } = await runCli(['run-list'], { execImpl, env: {} });
  assert.notEqual(code, 0);
  assert.match(err, /^usage: /);
  assert.equal(calls.length, 0);
});

test('a thrown Orca failure prints its message to stderr and exits non-zero (no stack trace)', async () => {
  const execImpl = async () => {
    const error = new Error('command failed');
    error.stderr = 'environment "orchestrator-local" is not paired';
    throw error;
  };
  const { out, err, code } = await runCli(['run-list', '--environment', 'orchestrator-local'], { execImpl });
  assert.notEqual(code, 0);
  assert.equal(out, '');
  assert.match(err, /environment "orchestrator-local" is not paired/);
  assert.doesNotMatch(err, /at Object\.<anonymous>|node:internal/);
});

test('a structured Orca {ok:false} failure surfaces its real code/message on stderr, non-zero', async () => {
  const { execImpl } = fakeExec({ id: 'x', ok: false, error: { code: 'dispatch_not_found', message: 'No dispatch with id missing' }, _meta: {} });
  const { out, err, code } = await runCli(['worker-show', '--dispatch', 'missing', '--environment', 'ovh-local'], { execImpl });
  assert.notEqual(code, 0);
  assert.equal(out, '');
  assert.match(err, /dispatch_not_found.*No dispatch with id missing/s);
});
