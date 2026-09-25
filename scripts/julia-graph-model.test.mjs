import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolvePair } from './julia-graph-model.mjs';

test('the selected Codex builder and Gemini reviewer resolve through the model catalog', () => {
  const pair = resolvePair('builder-codex', 'adversary-gemini-flash');
  assert.deepEqual(pair.builder, {
    label: 'builder-codex', entry: 'codex', model: null,
    maker: 'OpenAI', account: 'runner', name: 'Codex',
  });
  assert.deepEqual(pair.reviewer, {
    label: 'adversary-gemini-flash', entry: 'gemini', model: 'gemini-3.8-flash',
    maker: 'Google', account: 'gemini-worker', name: 'Gemini 3.8 Flash',
  });
});

test('an unknown choice and a same-maker pair are refused before either worker starts', () => {
  assert.throws(() => resolvePair('builder-unknown', 'adversary-gemini-flash'), /unknown model choice/);
  assert.throws(() => resolvePair('builder-claude-opus', 'adversary-gemini-flash'), /no installed graph launch route/);
  assert.throws(() => resolvePair('builder-gemini-flash', 'adversary-gemini-flash'), /different model makers/);
});
