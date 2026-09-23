// smoke-walk.check.mjs: tests for page-load check.
// Named *.check.mjs so CI's glob and test-wrappers.test.mjs ignore it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smokeWalk } from './smoke-walk.mjs';

test('page-load check returns ok when site responds with 200', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return { ok: true, status: 200 };
  };
  const result = await smokeWalk('http://localhost:3000', { fetch: mockFetch });
  assert.equal(result.ok, true);
  assert.equal(callCount, 1);
});
