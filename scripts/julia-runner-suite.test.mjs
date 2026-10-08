import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { discoverRunnerTests } from './julia-runner-suite.mjs';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'runner suite with spaces-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  }
  return root;
}

test('discovers new and nested runner tests, shared safety tests, and unwrapped runner regressions', (t) => {
  const root = fixture(t, {
    'scripts/julia-init.test.mjs': '',
    'scripts/nested/julia-delivery-new.test.mjs': '',
    'ops/julia-runner/new.test.mjs': '',
    'scripts/acceptance-check.test.mjs': '',
    'tests/new-safety.test.mjs': "import '../scripts/julia-delivery-runner.mjs';",
    'scripts/unrelated.test.mjs': '',
    'ops/factory/app/retained.test.mjs': '',
    '.julia/archive/scripts/julia-init.test.mjs': '',
    'node_modules/archived/julia-init.test.mjs': '',
  });
  assert.deepEqual(discoverRunnerTests(root), [
    'ops/julia-runner/new.test.mjs',
    'scripts/acceptance-check.test.mjs',
    'scripts/julia-init.test.mjs',
    'scripts/nested/julia-delivery-new.test.mjs',
    'tests/new-safety.test.mjs',
  ]);
});

test('the local gate runs discovered files with spaces and propagates a failing test despite inherited test context', (t) => {
  const root = fixture(t, {
    'scripts/nested space/julia-delivery-failure.test.mjs': "import { test } from 'node:test'; test('discovered failure', () => { throw new Error('regression marker'); });",
  });
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'julia-runner-suite.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /nested space\/julia-delivery-failure\.test\.mjs/);
  assert.match(result.stdout, /regression marker/);
});

test('an empty suite fails closed instead of invoking repository-wide Node discovery', (t) => {
  const root = fixture(t, { 'scripts/unrelated.test.mjs': '' });
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'julia-runner-suite.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no active runner tests/);
});
