// effort.test.mjs -- JUL-79 step 3: the pure translation from the ticket's
// one Low/Medium/High choice to each seat-table entry's own CLI spelling.
// This is the whole point of keeping it pure: label parsing (a later,
// Linear-writing step) and the launch commands both call the same function,
// and its full 4-entry matrix is pinned here rather than discovered live.
import test from 'node:test';
import assert from 'node:assert/strict';

import { translateEffort, normalizeEffort, DEFAULT_EFFORT, EFFORT_LEVELS } from './effort.mjs';

test('the effort vocabulary and default are exactly the ticket\'s', () => {
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high']);
  assert.equal(DEFAULT_EFFORT, 'medium');
});

test('translateEffort maps every seat-table entry x every level to its vendor spelling', () => {
  const expected = {
    claude: {
      low: ['--effort', 'low'],
      medium: ['--effort', 'medium'],
      high: ['--effort', 'high'],
    },
    codex: {
      low: ['-c', 'model_reasoning_effort=low'],
      medium: ['-c', 'model_reasoning_effort=medium'],
      high: ['-c', 'model_reasoning_effort=high'],
    },
    // Pi has no graded effort setting: Low means thinking off (no flag --
    // Pi's own thinkingLevelMap supplies the level), Medium/High mean on.
    'pi-deepseek': { low: [], medium: ['--thinking'], high: ['--thinking'] },
    'pi-glm': { low: [], medium: ['--thinking'], high: ['--thinking'] },
  };
  for (const [entry, byLevel] of Object.entries(expected)) {
    for (const level of EFFORT_LEVELS) {
      assert.deepEqual(translateEffort(entry, level), byLevel[level], `${entry}/${level}`);
    }
  }
});

test('an omitted effort is Medium for every entry -- never throws, never implied-empty', () => {
  for (const entry of Object.keys({ claude: 1, codex: 1, 'pi-deepseek': 1, 'pi-glm': 1 })) {
    assert.deepEqual(translateEffort(entry), translateEffort(entry, 'medium'), `${entry} default`);
  }
});

test('an unrecognized effort value also falls back to Medium rather than throwing or guessing a vendor default', () => {
  assert.deepEqual(translateEffort('claude', 'turbo'), ['--effort', 'medium']);
  assert.deepEqual(translateEffort('pi-glm', 'LOW'), ['--thinking']);
  assert.equal(normalizeEffort('turbo'), 'medium');
  assert.equal(normalizeEffort(undefined), 'medium');
  assert.equal(normalizeEffort('high'), 'high');
});

test('an unknown ENTRY throws (same discipline as orchestratorLaunchCommandFor) -- a typo must never silently launch the wrong vendor', () => {
  assert.throws(() => translateEffort('gemini', 'low'), /unknown orchestrator seat-table entry: gemini/);
  assert.throws(() => translateEffort(undefined), /unknown orchestrator seat-table entry: undefined/);
});

test('translateEffort returns a fresh array each call, so a caller appending to it cannot corrupt the next launch', () => {
  const first = translateEffort('codex', 'high');
  first.push('mutated');
  assert.deepEqual(translateEffort('codex', 'high'), ['-c', 'model_reasoning_effort=high']);
});
