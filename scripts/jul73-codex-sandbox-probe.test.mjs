import test from 'node:test';
import assert from 'node:assert/strict';
import { probeCodexSandbox } from './jul73-codex-sandbox-probe.mjs';

test('both readable and reachable -> pass', async () => {
  const result = await probeCodexSandbox({
    accessImpl: () => {},
    checkReadinessImpl: async () => ({ checks: [{ name: 'OVH runner reachable', ok: true, detail: 'connected' }] }),
  });
  assert.deepEqual(result, { publisherReadable: true, orcaReachable: true });
});

test('publisher file unreadable -> fails that half, orca result unaffected', async () => {
  const result = await probeCodexSandbox({
    accessImpl: () => { throw new Error('EACCES'); },
    checkReadinessImpl: async () => ({ checks: [{ name: 'OVH runner reachable', ok: true, detail: 'connected' }] }),
  });
  assert.deepEqual(result, { publisherReadable: false, orcaReachable: true });
});

test('Orca unreachable -> fails that half, publisher result unaffected', async () => {
  const result = await probeCodexSandbox({
    accessImpl: () => {},
    checkReadinessImpl: async () => ({ checks: [{ name: 'OVH runner reachable', ok: false, detail: 'disconnected' }] }),
  });
  assert.deepEqual(result, { publisherReadable: true, orcaReachable: false });
});

test('checkReadiness throwing outright counts as orca unreachable, not a crash', async () => {
  const result = await probeCodexSandbox({
    accessImpl: () => {},
    checkReadinessImpl: async () => { throw new Error('ORCA_BIN is not set'); },
  });
  assert.deepEqual(result, { publisherReadable: true, orcaReachable: false });
});
