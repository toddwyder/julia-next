import assert from 'node:assert/strict';
import test from 'node:test';

import { DASHBOARD_PREFIX, scopeOf, scopeReason } from './scope.mjs';

const MIXED = [
  'dashboard/lib/linear.js',
  'dashboard/app/recipes/page.jsx',
  'lib/recipes.js',
  'machine/preview/scope.mjs',
  'app/page.jsx',
  'scripts/scorecard.mjs',
  'firestore.rules',
  'docs/adr/0024-run-scorecard-and-stop-ping.md',
  'package.json',
];

test('a change carrying a file under dashboard/ is a dashboard change', () => {
  assert.equal(DASHBOARD_PREFIX, 'dashboard/');
  assert.equal(scopeOf(['dashboard/lib/linear.js']), 'dashboard');
});

test('a change that stays outside dashboard/ is a machine change', () => {
  assert.equal(scopeOf(['lib/recipes.js', 'app/page.jsx']), 'machine');
});

test('a change with no files listed is a machine change', () => {
  assert.equal(scopeOf([]), 'machine');
  assert.equal(scopeOf(undefined), 'machine');
  assert.equal(scopeOf(null), 'machine');
  assert.equal(scopeOf('dashboard/lib/linear.js'), 'machine');
});

test('a mixed change counts only the files under dashboard/ and names the first of them', () => {
  assert.equal(scopeOf(MIXED), 'dashboard');
  assert.equal(
    scopeReason('dashboard', MIXED),
    'the change touches the dashboard (2 of 9 files, starting with dashboard/lib/linear.js)',
  );
});

test('a path that only begins with the word dashboard is not under dashboard/', () => {
  assert.equal(scopeOf(['dashboards/lib/linear.js', 'dashboard', 'apps/dashboard/page.jsx']), 'machine');
});

test('the reason for a machine change says only the tests and the pull request checks judge it', () => {
  assert.equal(
    scopeReason('machine', ['lib/recipes.js']),
    "the change touches no file under dashboard/, so only the tests and the pull request's checks judge it",
  );
  assert.equal(
    scopeReason(scopeOf(MIXED), ['lib/recipes.js']),
    "the change touches no file under dashboard/, so only the tests and the pull request's checks judge it",
  );
});

test('entries that are not paths are ignored rather than counted', () => {
  assert.equal(scopeOf([null, 7, { path: 'dashboard/lib/linear.js' }, 'dashboard/lib/linear.js']), 'dashboard');
  assert.equal(scopeReason('dashboard', [null, 'dashboard/lib/linear.js']), 'the change touches the dashboard (1 of 1 files, starting with dashboard/lib/linear.js)');
});

test('a dashboard reason stays short enough to read on one line', () => {
  const long = `dashboard/${'nested-directory-name/'.repeat(8)}page.jsx`;
  const files = [long, 'lib/recipes.js'];
  const reason = scopeReason('dashboard', files);
  assert.ok(reason.length < 200, `the reason was ${reason.length} characters: ${reason}`);
  assert.match(reason, /1 of 2 files/);
});
