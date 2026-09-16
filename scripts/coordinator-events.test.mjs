import { test } from 'node:test';
import assert from 'node:assert/strict';

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
