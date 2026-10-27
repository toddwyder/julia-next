import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROOF_EMAILS } from './provision-firebase.mjs';
import { EMAILS, password, proofConfig, recipeUrl, storageRead, storageWrite } from './record-proof.mjs';

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

test('the stranger writes with their own token and the answer is the status storage gave', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined });
    return new Response('{}', { status: calls.length === 1 ? 403 : 200 });
  };
  try {
    assert.equal(await storageWrite('julia-household-proof', 'stranger-token', 'intruder-pie'), 403);
    assert.equal(await storageRead('julia-household-proof', 'todd-token', 'proof-recipe'), 200);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].headers.authorization, 'Bearer stranger-token');
  assert.deepEqual(Object.keys(calls[0].body.fields).sort(), ['createdAt', 'id', 'ingredients', 'steps', 'title']);
  assert.equal(calls[0].body.fields.id.stringValue, 'intruder-pie');
  assert.equal(calls[1].method, 'GET');
  assert.equal(calls[1].headers.authorization, 'Bearer todd-token');
});
