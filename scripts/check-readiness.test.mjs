import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkReadiness } from './check-readiness.mjs';

function gh({ runnerStatus = 'online', secretNames = ['JULIA_NEXT_DEPLOY_KEY', 'JULIA_PUBLISHER_APP_ID', 'JULIA_PUBLISHER_APP_PRIVATE_KEY', 'LINEAR_API_KEY'] } = {}) {
  return async (args) => {
    if (args.join(' ') === 'api repos/toddwyder/AI-Stack/actions/runners') {
      return JSON.stringify({ runners: [{ name: 'BERTHA', status: runnerStatus, os: 'Windows' }] });
    }
    if (args.join(' ') === 'secret list -R toddwyder/AI-Stack') {
      return secretNames.join('\n');
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
}

test('all checks pass -> ok: true', async () => {
  const result = await checkReadiness({ ghImpl: gh() });
  assert.equal(result.ok, true);
  assert.equal(result.checks.every((c) => c.ok), true);
  assert.ok(result.checks.some((c) => c.name === 'BERTHA runner online'));
  assert.ok(result.checks.some((c) => c.name === 'JULIA_NEXT_DEPLOY_KEY configured'));
  assert.ok(result.checks.some((c) => c.name === 'JULIA_PUBLISHER_APP_ID configured'));
  assert.ok(result.checks.some((c) => c.name === 'JULIA_PUBLISHER_APP_PRIVATE_KEY configured'));
  assert.ok(result.checks.some((c) => c.name === 'LINEAR_API_KEY configured'));
});

test('BERTHA offline fails clearly and by name, not a generic error', async () => {
  const result = await checkReadiness({ ghImpl: gh({ runnerStatus: 'offline' }) });
  assert.equal(result.ok, false);
  const runner = result.checks.find((c) => c.name === 'BERTHA runner online');
  assert.equal(runner.ok, false);
  assert.match(runner.detail, /offline/);
});

test('a missing secret fails only that check; the rest still run and report', async () => {
  const result = await checkReadiness({ ghImpl: gh({ secretNames: ['JULIA_PUBLISHER_APP_ID', 'JULIA_PUBLISHER_APP_PRIVATE_KEY'] }) });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((c) => c.name === 'JULIA_NEXT_DEPLOY_KEY configured').ok, false);
  assert.equal(result.checks.find((c) => c.name === 'LINEAR_API_KEY configured').ok, false);
  assert.equal(result.checks.find((c) => c.name === 'JULIA_PUBLISHER_APP_ID configured').ok, true);
});

test('a gh CLI failure (e.g. not authenticated) is reported as its own failed check, not an uncaught throw', async () => {
  const ghImpl = async () => { throw new Error('gh: not logged in'); };
  const result = await checkReadiness({ ghImpl });
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => !c.ok && /not logged in/.test(c.detail)));
});
