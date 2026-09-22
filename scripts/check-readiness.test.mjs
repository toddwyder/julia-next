import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkReadiness, defaultRelayCheckImpl, defaultGroupDriftCheckImpl, getEnvironment } from './check-readiness.mjs';

function fakes({
  runtimeReachable = true,
  runtimeConnectionState = 'connected',
  projectRegistered = true,
  publisherInstalled = true,
  relayReachable = true,
  groupsMatch = true,
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
    groupDriftCheckImpl: async () => (groupsMatch
      ? { ok: true, detail: 'this terminal\'s groups match /etc/group (ACTUAL:runner,deepseek-readers,commandcode-readers,)' }
      : { ok: false, detail: 'this terminal is missing commandcode-readers, though /etc/group lists them for this account right now -- the Orca daemon ... was very likely started before that group existed' }),
  };
}

test('all checks pass -> ok: true', async () => {
  const result = await checkReadiness({ ...fakes() });
  assert.equal(result.ok, true);
  assert.ok(result.checks.some((c) => c.name === 'OVH runner reachable'));
  assert.ok(result.checks.some((c) => c.name === 'julia-next project registered'));
  assert.ok(result.checks.some((c) => c.name === 'julia-graph-publisher installed on julia-next'));
  assert.ok(result.checks.some((c) => c.name === 'journey-relay reachable'));
  assert.ok(result.checks.some((c) => c.name === 'worker terminal groups match /etc/group'));
  assert.ok(result.checks.every((c) => c.ok));
});

test('a stale-supplementary-groups daemon fails clearly and by name, not silently (JUL-44/JUL-98)', async () => {
  const result = await checkReadiness({ ...fakes({ groupsMatch: false }) });
  assert.equal(result.ok, false);
  const groups = result.checks.find((c) => c.name === 'worker terminal groups match /etc/group');
  assert.equal(groups.ok, false);
  assert.match(groups.detail, /commandcode-readers/);
  assert.match(groups.detail, /started before that group existed/);
  // Every other check still passes -- one drifted daemon is not read as the
  // whole environment being down.
  assert.equal(result.checks.find((c) => c.name === 'OVH runner reachable').ok, true);
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

test('defaultRelayCheckImpl unwraps the real nested {terminal: {handle, tail}} shape from both calls', async () => {
  const result = await defaultRelayCheckImpl({
    terminalCreateImpl: async () => ({ terminal: { handle: 'term_abc', tabId: 't1' } }),
    terminalReadImpl: async ({ terminal }) => {
      assert.equal(terminal, 'term_abc');
      return { terminal: { handle: 'term_abc', tail: ['$ curl ...', '{"sent":true,"event":"journey-relay.readiness-check"}', '$'] } };
    },
  });
  assert.equal(result.reachable, true);
  assert.match(result.detail, /"sent":true/);
});

test('defaultRelayCheckImpl reports not-reachable, with the tail as evidence, when the relay never confirms', async () => {
  const result = await defaultRelayCheckImpl({
    terminalCreateImpl: async () => ({ terminal: { handle: 'term_abc' } }),
    terminalReadImpl: async () => ({ terminal: { handle: 'term_abc', tail: ['$ curl ...', 'curl: (7) Failed to connect', '$'] } }),
  });
  assert.equal(result.reachable, false);
  assert.match(result.detail, /127\.0\.0\.1:8943/);
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

test('defaultGroupDriftCheckImpl passes when the probe reports no missing groups', async () => {
  const result = await defaultGroupDriftCheckImpl({
    terminalCreateImpl: async () => ({ terminal: { handle: 'term_abc' } }),
    terminalReadImpl: async ({ terminal }) => {
      assert.equal(terminal, 'term_abc');
      return {
        terminal: {
          handle: 'term_abc',
          tail: [
            '$ u=$(id -un); ...',
            'ACTUAL:commandcode-readers,deepseek-readers,runner,',
            'EXPECTED:commandcode-readers,deepseek-readers,runner,',
            'MISSING:',
            '$',
          ],
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.match(result.detail, /ACTUAL:/);
});

test('defaultGroupDriftCheckImpl fails, naming exactly the missing group, when the daemon is stale (JUL-44/JUL-98)', async () => {
  const result = await defaultGroupDriftCheckImpl({
    terminalCreateImpl: async () => ({ terminal: { handle: 'term_abc' } }),
    terminalReadImpl: async () => ({
      terminal: {
        handle: 'term_abc',
        tail: [
          '$ u=$(id -un); ...',
          'ACTUAL:deepseek-readers,runner,',
          'EXPECTED:commandcode-readers,deepseek-readers,runner,',
          'MISSING:commandcode-readers,',
          '$',
        ],
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /commandcode-readers/);
  assert.match(result.detail, /restart/i);
});

test('defaultGroupDriftCheckImpl refuses to guess when the probe printed no MISSING line at all', async () => {
  const result = await defaultGroupDriftCheckImpl({
    terminalCreateImpl: async () => ({ terminal: { handle: 'term_abc' } }),
    terminalReadImpl: async () => ({ terminal: { handle: 'term_abc', tail: ['$ some unrelated crash', '$'] } }),
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /no MISSING line/);
});

test('getEnvironment() defaults to "OVH runner" but ORCA_ENVIRONMENT overrides it, so this check can target a different Orca pairing (e.g. orchestrator-svc\'s own local "ovh-local" pairing, JUL-61 step 7)', () => {
  const original = process.env.ORCA_ENVIRONMENT;
  try {
    delete process.env.ORCA_ENVIRONMENT;
    assert.equal(getEnvironment(), 'OVH runner');

    process.env.ORCA_ENVIRONMENT = 'ovh-local';
    assert.equal(getEnvironment(), 'ovh-local');
  } finally {
    if (original === undefined) delete process.env.ORCA_ENVIRONMENT;
    else process.env.ORCA_ENVIRONMENT = original;
  }
});
