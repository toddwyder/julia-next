import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOUSEHOLD,
  HOUSEHOLD_EMAILS,
  PROOF,
  PROOF_EMAILS,
  jwtClaims,
  membersBody,
  projectFrom,
  rulesBody,
  vaultItemFor,
  vaultTemplate,
  webConfigBody,
} from './provision-firebase.mjs';

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
  assert.equal(HOUSEHOLD.id, 'julia-household-512904');
});

test('the household key names the vault the storage proof reads from', async () => {
  const { VAULT_ITEMS } = await import('./prove-household-rules.mjs');
  assert.deepEqual(VAULT_ITEMS, [vaultItemFor(PROOF), vaultItemFor(HOUSEHOLD)]);
});

test('the service account asks Google for the one token the Firebase calls need', () => {
  const claims = jwtClaims('proof-agent@julia-household-proof.iam.gserviceaccount.com', 1_700_000_000);
  assert.equal(claims.iss, 'proof-agent@julia-household-proof.iam.gserviceaccount.com');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/cloud-platform');
  assert.equal(claims.exp - claims.iat, 3600);
});

test('the rules sent to Firebase are the file the tests and the browser run', () => {
  const body = rulesBody('rules_version = "2";');
  assert.deepEqual(body.source.files, [{ name: 'firestore.rules', content: 'rules_version = "2";' }]);
});

test('the config written for the browser carries no secret', () => {  const written = webConfigBody({
    apiKey: 'a-key',
    authDomain: 'julia-household-512904.firebaseapp.com',
    projectId: 'julia-household-512904',
    appId: 'an-app',
  });
  assert.match(written, /export const HOUSEHOLD_WEB_CONFIG = \{/);
  assert.match(written, /projectId: "julia-household-512904"/);
  assert.doesNotMatch(written, /private_key|refresh_token/);
});

test('the vault item is one 1Password accepts, with the key where the proof reads it', () => {
  const item = vaultTemplate('Julia Firebase proof', '{"type":"service_account"}');
  assert.equal(item.category, 'SECURE_NOTE');
  assert.equal(item.vault.name, 'Julia Agents');
  assert.deepEqual(item.fields.map(field => [field.label, field.type]).at(0), ['FIREBASE_SERVICE_ACCOUNT', 'CONCEALED']);
  assert.match(item.fields[0].value, /service_account/);
});
