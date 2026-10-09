import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    'scripts/board-setup.test.mjs': '',
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
  const root = fixture(t, { 'scripts/board-setup.test.mjs': '' });
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'julia-runner-suite.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no active runner tests/);
});

test('the Windows CI job invokes the same complete local gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const windows = workflow.match(/\n  julia-init-windows:\n([\s\S]*?)(?=\n  web:)/)?.[1];
  assert.ok(windows, 'the stable JUL-197 Windows gate exists');
  assert.match(windows, /runs-on: windows-latest/);
  assert.match(windows, /run: node scripts\/julia-runner-suite\.mjs\s*$/);
});

test('new unwrapped shared safety regressions are discovered beside their imported dependencies', (t) => {
  const root = fixture(t, {
    'graph/new-seat-safety.test.mjs': "import './seat-table.mjs';",
    'scripts/nested/linear-cli-extra.test.mjs': "import '../linear-cli.mjs';",
    'tests/new-evidence-safety.test.mjs': "import '../scripts/acceptance-check.mjs';",
    'tests/new-transport-safety.test.mjs': "import '../ops/service-dropbox/run-pi-seat.mjs';",
  });
  assert.deepEqual(discoverRunnerTests(root), [
    'graph/new-seat-safety.test.mjs', 'scripts/nested/linear-cli-extra.test.mjs',
    'tests/new-evidence-safety.test.mjs', 'tests/new-transport-safety.test.mjs',
  ]);
});

test('shared regressions run directly once while known historical controller journeys retain their separate lane', (t) => {
  const root = fixture(t, {
    'graph/seat-table.test.mjs': "import './seat-table.mjs';",
    'scripts/seat-table.test.mjs': "import '../graph/seat-table.test.mjs';",
    'scripts/bad-submissions.test.mjs': "import './acceptance-check.mjs';",
    'scripts/controller-carry.test.mjs': "import './linear-cli.mjs';",
    'tests/new-shared-safety.test.mjs': "import '../scripts/acceptance-check.mjs';",
  });
  assert.deepEqual(discoverRunnerTests(root), ['graph/seat-table.test.mjs', 'tests/new-shared-safety.test.mjs']);
});

test('new transport and secret regressions are discovered beside shared modules with relative imports', (t) => {
  const root = fixture(t, {
    'ops/service-dropbox/new-agy-safety.test.mjs': "import './run-agy-seat.mjs';",
    'ops/service-dropbox/new-pi-safety.test.mjs': "import './run-pi-seat.mjs';",
    'ops/service-dropbox/new-secret-safety.test.mjs': "import './read-secret.mjs';",
  });
  assert.deepEqual(discoverRunnerTests(root), [
    'ops/service-dropbox/new-agy-safety.test.mjs',
    'ops/service-dropbox/new-pi-safety.test.mjs',
    'ops/service-dropbox/new-secret-safety.test.mjs',
  ]);
});

test('a new subprocess-only runner regression is executed even without a runner filename or module import', (t) => {
  const root = fixture(t, {
    'scripts/julia-delivery-runner.mjs': 'process.exitCode = 1;',
    'scripts/check-runner-output.test.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { spawnSync } from 'node:child_process'; test('subprocess-only runner regression', () => { const result = spawnSync(process.execPath, ['scripts/julia-delivery-runner.mjs']); assert.equal(result.status, 0); });",
  });
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'julia-runner-suite.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /scripts\/check-runner-output\.test\.mjs/);
  assert.match(result.stdout, /subprocess-only runner regression/);
});
