// smoke-walk.check.mjs: tests for smokeWalk.
// Named *.check.mjs so CI's glob and test-wrappers.test.mjs ignore it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smokeWalk } from './smoke-walk.mjs';

test('smokeWalk executes steps along the main path', async () => {
  const mockFetch = async () => ({ ok: true, status: 200 });
  const result = await smokeWalk('http://localhost:3000', { fetch: mockFetch });
  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 3);
  assert.deepEqual(result.steps.map((s) => s.name), ['home', 'recipes', 'planner']);
});

test('smokeWalk identifies the failed step when a step fails (AC5)', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/recipes')) {
      return { ok: false, status: 500 };
    }
    return { ok: true, status: 200 };
  };
  const result = await smokeWalk('http://localhost:3000', { fetch: mockFetch });
  assert.equal(result.ok, false);
  assert.equal(result.failedStep, 'recipes');
});
