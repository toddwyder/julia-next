import test from 'node:test';
import assert from 'node:assert/strict';

test('PR316 annotation proof identifies a deliberately broken test', () => {
  assert.equal('deliberately broken', 'restored', 'PR316 deliberate annotation proof');
});
