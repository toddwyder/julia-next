import assert from 'node:assert/strict';
import test from 'node:test';
import { documentBody, serviceAccount, verdict } from './prove-household-rules.mjs';

test('a whole recipe is what the proof writes, under the id it names', () => {
  const body = documentBody('proof-recipe', 'Proof Coq au Vin');
  assert.deepEqual(Object.keys(body.fields).sort(), ['createdAt', 'id', 'ingredients', 'steps', 'title']);
  assert.equal(body.fields.id.stringValue, 'proof-recipe');
});

test('one wrong check fails the whole proof and says which', () => {
  const checks = [
    { what: 'a stranger is refused', expected: 403, got: 403, pass: true },
    { what: 'an overwrite is refused', expected: 'not 200', got: 200, pass: false },
  ];
  assert.deepEqual(verdict(checks), { pass: false, wrong: ['an overwrite is refused: expected not 200, got 200'] });
  assert.deepEqual(verdict(checks.slice(0, 1)), { pass: true, wrong: [] });
});

test('the real run finds its key in the vault provisioning filled, not in a human', () => {
  const asked = [];
  const found = serviceAccount((tool, args) => {
    asked.push([tool, ...args]);
    return asked.length === 2
      ? { status: 0, stdout: '{ "project_id": "julia-household-proof" }' }
      : { status: 1, stdout: '' };
  });
  assert.equal(found.project_id, 'julia-household-proof');
  assert.deepEqual(asked, [
    ['op', 'read', 'op://Julia Agents/Julia Firebase proof/FIREBASE_SERVICE_ACCOUNT'],
    ['op', 'read', 'op://Julia Agents/Julia Firebase/FIREBASE_SERVICE_ACCOUNT'],
  ]);
});

test('no vault entry and no key in the environment means no real run', () => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  assert.equal(serviceAccount(() => ({ status: 1, stdout: '' })), null);
});
