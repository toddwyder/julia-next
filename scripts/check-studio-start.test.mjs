import assert from 'node:assert/strict';
import test from 'node:test';
import { runForm } from './check-studio-start.mjs';

const served = schema => [{ name: 'card-path', inputSchema: JSON.stringify({ json: schema }) }];

const form = {
  type: 'object',
  properties: { card: { type: 'string' }, kind: { type: 'string' } },
  required: ['card', 'kind'],
  additionalProperties: false,
};

test('the run form that asks only for the card and its kind passes', () => {
  const { fields, failures } = runForm(served(form));
  assert.deepEqual(fields, ['card', 'kind']);
  assert.deepEqual(failures, []);
});

test('a run form that asks for more than the card and its kind fails', () => {
  const extra = { ...form, properties: { ...form.properties, detail: { type: 'string' } } };
  const { failures } = runForm(served(extra));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /asks for card, kind, detail instead of card and kind/);
});

test('a run form that leaves a field optional fails', () => {
  const loose = { ...form, required: ['card'] };
  const { failures } = runForm(served(loose));
  assert.match(failures.join('\n'), /does not require kind/);
});

test('a run form that takes unnamed fields fails', () => {
  const open = { ...form, additionalProperties: true };
  const { failures } = runForm(served(open));
  assert.match(failures.join('\n'), /accepts fields the card does not name/);
});

test('a server that serves another workflow fails and says which one is missing', () => {
  const { failures } = runForm([{ name: 'other', inputSchema: JSON.stringify({ json: form }) }]);
  assert.match(failures.join('\n'), /does not serve a workflow named card-path/);
});
