import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkReadiness } from './check-readiness.mjs';

function fakes({
  runtimeReachable = true,
  runtimeConnectionState = 'connected',
  projectRegistered = true,
  publisherInstalled = true,
  relayReachable = true,
} = {}) {
  return {
    orcaStatusImpl: async () => ({
      result: { runtime: { reachable: runtimeReachable, connectionState: runtimeConnectionState } },
    }),
    orcaProjectSetupsImpl: async () => ({
      result: {
        setups: projectRegistered
          ? [{ projectId: 'github:toddwyder/julia-next', setupState: 'ready', path: '/home/runner/julia-next' }]
          : [],
      },
    }),
    publisherCheckImpl: async () => (publisherInstalled
      ? { installed: true, detail: 'julia-graph-publisher is installed on toddwyder/julia-next' }
      : { installed: false, detail: 'julia-graph-publisher is not installed on toddwyder/julia-next (HTTP 404)' }),
    relayCheckImpl: async () => (relayReachable
      ? { reachable: true, detail: 'sent:true' }
      : { reachable: false, detail: 'curl on the OVH runner could not reach 127.0.0.1:8943' }),
  };
}

test('all checks pass -> ok: true', async () => {
  const result = await checkReadiness({ ...fakes() });
  assert.equal(result.ok, true);
  assert.ok(result.checks.some((c) => c.name === 'OVH runner reachable'));
  assert.ok(result.checks.some((c) => c.name === 'julia-next project registered'));
  assert.ok(result.checks.some((c) => c.name === 'julia-graph-publisher installed on julia-next'));
  assert.ok(result.checks.some((c) => c.name === 'journey-relay reachable'));
  assert.ok(result.checks.every((c) => c.ok));
});

test('OVH runner unreachable fails clearly and by name', async () => {
  const result = await checkReadiness({ ...fakes({ runtimeReachable: false, runtimeConnectionState: 'disconnected' }) });
  assert.equal(result.ok, false);
  const runner = result.checks.find((c) => c.name === 'OVH runner reachable');
  assert.equal(runner.ok, false);
  assert.match(runner.detail, /disconnected/);
});

test('julia-next not yet registered on the runner fails only that check', async () => {
  const result = await checkReadiness({ ...fakes({ projectRegistered: false }) });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((c) => c.name === 'julia-next project registered').ok, false);
  assert.equal(result.checks.find((c) => c.name === 'OVH runner reachable').ok, true);
});

test('publisher App not installed on julia-next is its own named, actionable failure', async () => {
  const result = await checkReadiness({ ...fakes({ publisherInstalled: false }) });
  assert.equal(result.ok, false);
  const publisher = result.checks.find((c) => c.name === 'julia-graph-publisher installed on julia-next');
  assert.equal(publisher.ok, false);
  assert.match(publisher.detail, /not installed/);
});

test('journey-relay unreachable from the runner fails clearly, not silently', async () => {
  const result = await checkReadiness({ ...fakes({ relayReachable: false }) });
  assert.equal(result.ok, false);
  const relay = result.checks.find((c) => c.name === 'journey-relay reachable');
  assert.equal(relay.ok, false);
  assert.match(relay.detail, /127\.0\.0\.1:8943/);
});

test('an Orca CLI failure (not installed, environment not paired) is its own failed check, not an uncaught throw', async () => {
  const result = await checkReadiness({
    orcaStatusImpl: async () => { throw new Error('environment "OVH runner" is not paired'); },
    orcaProjectSetupsImpl: async () => { throw new Error('environment "OVH runner" is not paired'); },
    publisherCheckImpl: fakes().publisherCheckImpl,
    relayCheckImpl: async () => { throw new Error('no reachable terminal to run the check from'); },
  });
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => !c.ok && /not paired/.test(c.detail)));
});
