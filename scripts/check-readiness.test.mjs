import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkReadiness } from './check-readiness.mjs';

const config = { tracker: 'linear', linear: { teamKey: 'JUL' } };

function relay({ status = 200, sent = true, throwError = null } = {}) {
  return async () => {
    if (throwError) throw throwError;
    return { ok: status >= 200 && status < 300, status, json: async () => ({ sent, record: {} }) };
  };
}

test('all checks pass -> ok: true, with a plain-English line per check', async () => {
  const result = await checkReadiness({
    config,
    env: { JULIA_PUBLISHER_APP_ID: '4948330', JULIA_PUBLISHER_APP_PRIVATE_KEY: 'pem', LINEAR_API_KEY: 'k' },
    fetchImpl: relay(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks.every((c) => c.ok), true);
  assert.ok(result.checks.some((c) => c.name === 'publisher App credentials'));
  assert.ok(result.checks.some((c) => c.name === 'linear credential'));
  assert.ok(result.checks.some((c) => c.name === 'relay reachable and accepted the event'));
});

test('missing publisher App credentials fails that check only, others still run and report', async () => {
  const result = await checkReadiness({
    config, env: { LINEAR_API_KEY: 'k' }, fetchImpl: relay(),
  });
  assert.equal(result.ok, false);
  const cred = result.checks.find((c) => c.name === 'publisher App credentials');
  assert.equal(cred.ok, false);
  assert.match(cred.detail, /JULIA_PUBLISHER_APP_ID.*JULIA_PUBLISHER_APP_PRIVATE_KEY/s);
  const linear = result.checks.find((c) => c.name === 'linear credential');
  assert.equal(linear.ok, true);
});

test('publisher App credentials check reports which of the two is missing', async () => {
  const idOnly = await checkReadiness({ config, env: { JULIA_PUBLISHER_APP_ID: '4948330', LINEAR_API_KEY: 'k' }, fetchImpl: relay() });
  assert.match(idOnly.checks.find((c) => c.name === 'publisher App credentials').detail, /JULIA_PUBLISHER_APP_PRIVATE_KEY is not set/);

  const keyOnly = await checkReadiness({ config, env: { JULIA_PUBLISHER_APP_PRIVATE_KEY: 'pem', LINEAR_API_KEY: 'k' }, fetchImpl: relay() });
  assert.match(keyOnly.checks.find((c) => c.name === 'publisher App credentials').detail, /JULIA_PUBLISHER_APP_ID is not set/);
});

test('relay reachable with HTTP 200 but sent:false is reported as a failed check, not swallowed', async () => {
  const result = await checkReadiness({
    config,
    env: { JULIA_PUBLISHER_APP_ID: '4948330', JULIA_PUBLISHER_APP_PRIVATE_KEY: 'pem', LINEAR_API_KEY: 'k' },
    fetchImpl: relay({ status: 200, sent: false }),
  });
  assert.equal(result.ok, false);
  const relayCheck = result.checks.find((c) => c.name === 'relay reachable and accepted the event');
  assert.equal(relayCheck.ok, false);
  assert.match(relayCheck.detail, /HTTP 200 but sent:false/);
});

test('relay unreachable is reported as a failed check with the real error, not a silent pass', async () => {
  const result = await checkReadiness({
    config,
    env: { JULIA_PUBLISHER_APP_ID: '4948330', JULIA_PUBLISHER_APP_PRIVATE_KEY: 'pem', LINEAR_API_KEY: 'k' },
    fetchImpl: relay({ throwError: new Error('ECONNREFUSED') }),
  });
  assert.equal(result.ok, false);
  const relayCheck = result.checks.find((c) => c.name === 'relay reachable and accepted the event');
  assert.equal(relayCheck.ok, false);
  assert.match(relayCheck.detail, /ECONNREFUSED/);
});

test('the readiness probe uses a distinct event name, never coordinator_started', async () => {
  let sentEvent = null;
  const fetchImpl = async (url, init) => {
    sentEvent = JSON.parse(init.body).event;
    return { ok: true, status: 200, json: async () => ({ sent: true }) };
  };
  await checkReadiness({ config, env: { JULIA_PUBLISHER_APP_ID: '4948330', JULIA_PUBLISHER_APP_PRIVATE_KEY: 'pem', LINEAR_API_KEY: 'k' }, fetchImpl });
  assert.equal(sentEvent, 'julia.journey0.coordinator_readiness_check');
  assert.notEqual(sentEvent, 'julia.journey0.coordinator_started');
});
