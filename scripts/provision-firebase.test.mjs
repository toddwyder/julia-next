import assert from 'node:assert/strict';
import test from 'node:test';

import { HOUSEHOLD, HOUSEHOLD_EMAILS, PROOF, PROOF_EMAILS, membersBody, projectFrom, vaultItemFor } from './provision-firebase.mjs';

test('only a project the account can actually use counts as there', () => {
  assert.equal(projectFrom(200, { projectId: 'julia-household', lifecycleState: 'ACTIVE' }).projectId, 'julia-household');
  assert.equal(projectFrom(404, {}), null);
  assert.equal(projectFrom(403, { error: { status: 'PERMISSION_DENIED' } }), null);
  assert.equal(projectFrom(200, { name: 'projects/whatever' }), null);
});

test('the household list is written as the array of emails the rules check', () => {
  assert.deepEqual(membersBody(['toddwyder@gmail.com', 'katinawyder@gmail.com']), {
    fields: {
      emails: { arrayValue: { values: [{ stringValue: 'toddwyder@gmail.com' }, { stringValue: 'katinawyder@gmail.com' }] } },
    },
  });
});

test('the two projects keep separate keys, and the proof key is the one the proofs read', () => {
  assert.equal(vaultItemFor(HOUSEHOLD), 'Julia Firebase');
  assert.equal(vaultItemFor(PROOF), 'Julia Firebase proof');
});

test('no proof identity is on the household list', () => {
  const household = new Set(HOUSEHOLD_EMAILS);
  for (const email of PROOF_EMAILS) assert.ok(!household.has(email), `${email} is both a proof user and a household member`);
  assert.deepEqual(HOUSEHOLD_EMAILS, ['toddwyder@gmail.com', 'katinawyder@gmail.com']);
  assert.equal(PROOF.id, 'julia-household-proof');
  assert.equal(HOUSEHOLD.id, 'julia-household');
});

test('the household key names the vault the storage proof reads from', async () => {
  const { VAULT_ITEMS } = await import('./prove-household-rules.mjs');
  assert.deepEqual(VAULT_ITEMS, [vaultItemFor(PROOF), vaultItemFor(HOUSEHOLD)]);
});
