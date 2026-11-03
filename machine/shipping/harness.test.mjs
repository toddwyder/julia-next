// Six review attempts on PR #433 stopped at the controller's default step cap
// and came back with no verdict. These tests pin the two things that made that
// hard to see: a subagent definition that names no limit, and a teardown that
// left the notification timer ticking on storage it had already closed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SUBAGENT_MAX_STEPS, subagentDefinitions, stopHarness } from './harness.mjs';

// The controller stops a definition that names no limit at 50 steps
// (`definition.maxSteps ?? 50` in the installed agent controller).
const CONTROLLER_DEFAULT_STEPS = 50;

const stock = (id, name) => ({ id, name, description: `${name} subagent`, instructions: 'do the work' });

test('the reviewer runs with an explicit step limit, above the controller default', () => {
  const loaded = [stock('explore', 'Explore'), stock('plan', 'Plan'), stock('execute', 'Execute')];

  for (const definition of subagentDefinitions(loaded)) {
    assert.equal(typeof definition.maxSteps, 'number', `${definition.id} must name its own step limit`);
    assert.ok(definition.maxSteps > CONTROLLER_DEFAULT_STEPS, `${definition.id} must not sit at the controller default`);
  }
});

test('the limit is the one the machine’s own interactive runs use', () => {
  // @mastra/code-sdk/dist/index.js streams an interactive session with
  // `maxSteps: 1e3`, so a review gets the same ceiling rather than a new number.
  assert.equal(SUBAGENT_MAX_STEPS, 1000);

  const [execute] = subagentDefinitions([stock('execute', 'Execute')]);
  assert.equal(execute.maxSteps, 1000);
});

test('a definition that already names a limit keeps it', () => {
  const [execute] = subagentDefinitions([{ ...stock('execute', 'Execute'), maxSteps: 12 }]);
  assert.equal(execute.maxSteps, 12);
});

test('the definitions are stamped without being changed in place', () => {
  const loaded = [stock('execute', 'Execute')];
  subagentDefinitions(loaded);
  assert.equal(loaded[0].maxSteps, undefined, 'the loaded stock definition is left as it came');
});

test('teardown stops notification dispatch before it closes storage', async () => {
  const order = [];
  const booted = {
    stopNotificationDispatch: async () => order.push('stopNotificationDispatch'),
    observability: {
      flush: async () => order.push('flush'),
      shutdown: async () => order.push('shutdown'),
    },
    storageMaintenance: { closeStorage: async () => order.push('closeStorage') },
  };

  await stopHarness(booted);

  assert.deepEqual(order, ['stopNotificationDispatch', 'flush', 'shutdown', 'closeStorage']);
});

test('a boot that has no notification timer still tears down', async () => {
  const order = [];
  const booted = {
    observability: { flush: async () => order.push('flush'), shutdown: async () => order.push('shutdown') },
    storageMaintenance: { closeStorage: async () => order.push('closeStorage') },
  };

  await stopHarness(booted);

  assert.deepEqual(order, ['flush', 'shutdown', 'closeStorage']);
});
