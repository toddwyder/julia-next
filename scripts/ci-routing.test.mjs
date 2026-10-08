import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectCIGates } from './ci-routing.mjs';

test('routes representative changed paths to their focused CI gates', () => {
  assert.deepEqual(selectCIGates(['scripts/julia-init.mjs']), ['baseline', 'julia-init-windows']);
  assert.deepEqual(selectCIGates(['docs/agents/init.md']), ['baseline', 'julia-init-windows', 'docs-policy']);
  assert.deepEqual(selectCIGates(['ops/factory/app/local-sandbox.test.mjs']), ['baseline', 'factory']);
  assert.deepEqual(selectCIGates(['app/recipes/page.tsx']), ['baseline', 'web']);
  assert.deepEqual(selectCIGates(['app/removed-page.tsx']), ['baseline', 'web']);
  assert.deepEqual(selectCIGates(['ops/factory/model-face-values.sql']), ['baseline', 'factory', 'database']);
  assert.deepEqual(selectCIGates(['docs/guide.md']), ['baseline', 'docs-policy']);
  assert.deepEqual(selectCIGates(['scripts/personal-paths.test.mjs']), ['baseline', 'julia-init-windows', 'docs-policy']);
});

test('unions applicable gates and treats workflow changes as high-risk', () => {
  assert.deepEqual(
    selectCIGates(['app/recipes/page.tsx', 'docs/guide.md', 'scripts/julia-init.mjs']),
    ['baseline', 'julia-init-windows', 'web', 'docs-policy'],
  );
  assert.deepEqual(
    selectCIGates(['.github/workflows/ci.yml']),
    ['baseline', 'julia-init-windows', 'factory', 'database', 'web', 'docs-policy'],
  );
  assert.deepEqual(
    selectCIGates(['scripts/ci-routing.test.mjs']),
    ['baseline', 'julia-init-windows', 'factory', 'database', 'web', 'docs-policy'],
  );
});

test('runner code, new regressions and shared safety dependencies select the Windows gate', () => {
  for (const path of [
    'scripts/julia-delivery-runner.mjs', 'scripts/nested/julia-delivery-new.test.mjs',
    'scripts/julia-minimal-runner-checks.mjs', 'scripts/julia-runner-suite.mjs',
    'ops/julia-runner/time-limit.mjs', 'scripts/acceptance-check.mjs',
    'scripts/linear-cli.mjs', 'scripts/effort.mjs', 'scripts/seat-labels.mjs',
    'graph/seat-table.mjs', 'ops/service-dropbox/run-pi-seat.mjs',
    'ops/service-dropbox/read-secret.mjs', '.agents/skills/implement/SKILL.md',
    'graph/new-runner-safety.test.mjs',
  ]) {
    assert.deepEqual(selectCIGates([path]), ['baseline', 'julia-init-windows'], path);
  }
  assert.deepEqual(selectCIGates(['scripts/personal-paths.mjs']), ['baseline', 'julia-init-windows', 'docs-policy']);
  assert.deepEqual(selectCIGates(['scripts/julia-delivery-new.test.mjs', 'ops/factory/app/local-sandbox.test.mjs']), ['baseline', 'julia-init-windows', 'factory']);
  assert.deepEqual(selectCIGates(['tests/new-safety.test.mjs']), ['baseline', 'julia-init-windows', 'web']);
});
