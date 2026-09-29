import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('retired graph unit definitions are no longer deployable from this repository', () => {
  for (const path of [
    './julia-controller.service',
    '../ready-queue/julia-ready-queue.service',
    '../ready-queue/julia-ready-queue.timer',
    '../journey-relay/journey-relay.service',
    '../journey-relay/relay.mjs',
    '../../scripts/checkout-sync.mjs',
    '../../scripts/journey-events.mjs',
    '../../scripts/coordinator-events.mjs',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, `${path} is still deployable`);
  }
});

test('retired service callers and CI checks are gone', () => {
  for (const path of [
    '../../scripts/julia-run.mjs',
    '../../scripts/check-readiness.mjs',
    '../sudoers/orchestrator-svc-ops',
    '../sudoers/orchestrator-svc-ops.test.mjs',
    '../../.github/workflows/ci.yml',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /julia-next-checkout-sync\.service|journey-relay|127\.0\.0\.1:8943/, path);
  }
});
