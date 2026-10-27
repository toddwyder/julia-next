import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROOF_EMAILS } from './provision-firebase.mjs';
import { EMAILS, identityFailure, password, proofConfig, recipeUrl } from './record-proof.mjs';

test('without the proof project config the recorder says what to run', () => {
  assert.throws(() => proofConfig({}), /run node scripts\/provision-firebase\.mjs first/);
  assert.throws(() => proofConfig({ web: { projectId: 'x' } }), /does not hold a web config/);
});

test('the proof web config is read as it was written', () => {
  const web = { apiKey: 'k', authDomain: 'julia-household-proof.firebaseapp.com', projectId: 'julia-household-proof', appId: '1:1:web:1' };
  assert.deepEqual(proofConfig({ web }), web);
});

test('every identity the recorder signs in is on the proof membership list', () => {
  for (const email of Object.values(EMAILS)) assert.ok(PROOF_EMAILS.includes(email), `${email} is not in PROOF_EMAILS`);
});

test('each run makes a fresh password nobody wrote down', () => {
  const first = password();
  assert.ok(first.length >= 20);
  assert.notEqual(first, password());
});

test('the storage URL names the project and the recipe', () => {
  assert.equal(
    recipeUrl('julia-household-proof', 'proof-recipe'),
    'https://firestore.googleapis.com/v1/projects/julia-household-proof/databases/(default)/documents/recipes/proof-recipe',
  );
});

test('a project with no sign-in config names the one click that fixes it', () => {
  const said = identityFailure('julia-household-proof', EMAILS.todd, '{"error":{"message":"CONFIGURATION_NOT_FOUND"}}');
  assert.match(said, /julia-household-proof has no Firebase Authentication config yet/);
  assert.match(said, /console\.firebase\.google\.com\/project\/julia-household-proof\/authentication/);
  assert.match(identityFailure('julia-household-proof', EMAILS.todd, '{"error":"SOMETHING_ELSE"}'), /could not get a token for todd@household\.test/);
});
