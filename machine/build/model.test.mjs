// The card's model is pstack's choice, kept in pstack's file. These tests pin
// the two ways the build step could quietly stop following it: a parser that
// reads the wrong line, and a model id written into the build step's own source.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BUILD_ROLE, buildModel, MODELS_FILE, roleModel } from './model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const MODELS = [
  '# pstack model configuration. One line per role.',
  '# budget: medium (high)',
  `feature, refactoring: ${'commandcode'}/deepseek/deepseek-v4.1-flash`,
  'judgment and prose: openai/gpt-6.1-sol',
  'swarm workers: auto',
].join('\n');

test('the build reads the feature role, which shares its line with refactoring', () => {
  assert.equal(BUILD_ROLE, 'feature');
  assert.equal(roleModel(MODELS), 'commandcode/deepseek/deepseek-v4.1-flash');
});

test('a role that inherits the session model is not a model id', () => {
  assert.equal(roleModel(MODELS, 'swarm workers'), null);
});

test('a file with no line for the role is an error naming the file', () => {
  assert.equal(roleModel('# nothing here\n', 'feature'), undefined);
  assert.throws(() => buildModel(path.join(here, 'no-such-models.md')), /no-such-models\.md/);
});

test('the build step names no model of its own', () => {
  // The card's rule: Todd changes the build model in one place. A model id in
  // this folder outside the tests would be a second place.
  const provider = /(?:commandcode|openai|anthropic|google|deepseek|reflection)\/[A-Za-z0-9.:_-]+/;
  const sources = fs
    .readdirSync(here)
    .filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));
  for (const name of sources) {
    assert.ok(!provider.test(fs.readFileSync(path.join(here, name), 'utf8')), `${name} must not name a model`);
  }
});

test('the file the build reads is the one pstack writes', () => {
  assert.match(MODELS_FILE, /\.agents[/\\]pstack-models\.md$/);
});
