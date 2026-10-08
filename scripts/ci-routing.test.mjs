import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectCIGates } from './ci-routing.mjs';

test('routes representative changed paths to their focused CI gates', () => {
  assert.deepEqual(selectCIGates(['scripts/julia-init.mjs']), ['baseline', 'julia-init-windows']);
  assert.deepEqual(selectCIGates(['ops/factory/app/local-sandbox.test.mjs']), ['baseline', 'factory']);
  assert.deepEqual(selectCIGates(['app/recipes/page.tsx']), ['baseline', 'web']);
  assert.deepEqual(selectCIGates(['app/removed-page.tsx']), ['baseline', 'web']);
  assert.deepEqual(selectCIGates(['ops/factory/model-face-values.sql']), ['baseline', 'factory', 'database']);
  assert.deepEqual(selectCIGates(['docs/guide.md']), ['baseline', 'docs-policy']);
  assert.deepEqual(selectCIGates(['scripts/personal-paths.test.mjs']), ['baseline', 'docs-policy']);
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
