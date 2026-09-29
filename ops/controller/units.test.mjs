import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('retired graph unit definitions are no longer deployable from this repository', () => {
  for (const path of [
    './julia-controller.service',
    '../ready-queue/julia-ready-queue.service',
    '../ready-queue/julia-ready-queue.timer',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, `${path} is still deployable`);
  }
});
