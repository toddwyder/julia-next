import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTHORISED_DOMAIN } from './provision-firebase.mjs';
import { smokeEnvironment } from './production-smoke.mjs';

test('the smoke checks the address Google sign-in authorises, at the exact commit', () => {
  const commit = '5061e94ec3ac321bb74399b3004b1b25e7dce71f';
  assert.deepEqual(smokeEnvironment({ commit }), { JULIA_VERIFY_URL: `https://${AUTHORISED_DOMAIN}`, JULIA_SMOKE_COMMIT: commit });
});

test('a short or missing commit is refused, so the release test cannot skip itself', () => {
  assert.throws(() => smokeEnvironment({ commit: '5061e94' }), /40-character/);
  assert.throws(() => smokeEnvironment({}), /40-character/);
});
