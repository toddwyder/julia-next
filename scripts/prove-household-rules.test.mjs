import assert from 'node:assert/strict';
import test from 'node:test';
import { documentBody, verdict } from './prove-household-rules.mjs';

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
