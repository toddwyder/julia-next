import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { recordCoordinatorEvent } from './coordinator-events.mjs';

function fakeRelay({ sent = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ sent, record: JSON.parse(init.body) }),
    };
  };
  return { calls, fetchImpl };
}

test('recordCoordinatorEvent posts a julia.journey0.coordinator_<stage> event carrying the run ID', async () => {
  const { calls, fetchImpl } = fakeRelay();
  await recordCoordinatorEvent('started', { runId: 'run-jul43', fetchImpl });
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.event, 'julia.journey0.coordinator_started');
  assert.match(body.context, /run-jul43/);
});

test('every stage name maps to its own event so idle/failed/stalled can be told apart later', async () => {
  for (const stage of ['started', 'progress', 'completed', 'failed']) {
    const { calls, fetchImpl } = fakeRelay();
    await recordCoordinatorEvent(stage, { runId: 'run-x', fetchImpl });
    assert.equal(JSON.parse(calls[0].init.body).event, `julia.journey0.coordinator_${stage}`);
  }
});

test('recordCoordinatorEvent logs locally on success, so a run is visible without querying Axiom', async () => {
  const { fetchImpl } = fakeRelay({ sent: true });
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    await recordCoordinatorEvent('started', { runId: 'run-jul43', fetchImpl });
  } finally {
    console.log = originalLog;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /coordinator_started/);
  assert.match(lines[0], /run-jul43/);
});

test('recordCoordinatorEvent logs to stderr for a failed stage, and also when the relay itself is unreachable', async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (line) => errors.push(line);
  try {
    // failed stage, relay reachable
    await recordCoordinatorEvent('failed', { runId: 'run-jul43', fetchImpl: fakeRelay().fetchImpl });
    // any stage, relay unreachable -- startup failures must be visible
    // locally even when the relay itself cannot be reached.
    await recordCoordinatorEvent('started', {
      runId: 'run-jul43',
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.length, 2);
  assert.match(errors[0], /coordinator_failed/);
  assert.match(errors[1], /coordinator_started/);
  assert.match(errors[1], /sent=false/);
});

test('forwards tokensUsed/quotaRemaining/interrupted through to the relay record instead of hardcoding them (PR #3 review, JUL-43 criterion 4)', async () => {
  const { calls, fetchImpl } = fakeRelay();
  await recordCoordinatorEvent('failed', {
    runId: 'run-jul43', tokensUsed: 12345, quotaRemaining: 6789, interrupted: true, fetchImpl,
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.tokensUsed, 12345);
  assert.equal(body.quotaRemaining, 6789);
  assert.equal(body.interrupted, true);
});

test('has a real CLI entry point (this skill\'s runbook invokes it as a plain shell command, not an import)', () => {
  const scriptPath = new URL('./coordinator-events.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const { stdout, stderr } = spawnSync(process.execPath, [
    scriptPath,
    'started',
    '--run-id', 'run-cli-test',
    '--context-b64', Buffer.from(JSON.stringify({ note: "it's a test with an apostrophe" })).toString('base64'),
  ], {
    env: { ...process.env, JOURNEY_RELAY_URL: 'http://127.0.0.1:1/unreachable-by-design' },
    encoding: 'utf8',
  });
  // Relay is unreachable by design here -- this only proves the CLI parsed
  // argv, base64-decoded a context containing shell-unsafe characters
  // without invoking a shell (no injection, no broken quoting), and
  // actually called recordCoordinatorEvent (visible as its local log
  // line), not that delivery succeeded.
  const output = stdout + stderr;
  assert.match(output, /coordinator_started/);
  assert.match(output, /run-cli-test/);
});

test('the CLI reports a controlled error for malformed --context-b64 instead of an uncaught stack trace (fix-verification finding)', () => {
  const scriptPath = new URL('./coordinator-events.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const { status, stdout, stderr } = spawnSync(process.execPath, [
    scriptPath, 'started', '--run-id', 'run-x', '--context-b64', 'not-valid-base64-json!!!',
  ], { encoding: 'utf8' });
  assert.equal(status, 2);
  assert.doesNotMatch(stdout + stderr, /at Object\.<anonymous>|node:internal/);
});
