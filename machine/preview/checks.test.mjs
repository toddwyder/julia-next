import assert from 'node:assert/strict';
import test from 'node:test';

import { checkItems, checksVerdict } from './checks.mjs';

const SHA = 'dc62b45';

const ran = (name, conclusion, sha = SHA) => ({ name, status: 'completed', conclusion, head_sha: sha });

test('an item carries the check name, its state and the commit it ran for', () => {
  assert.deepEqual(checkItems([ran('unit', 'success')], SHA), [
    { name: 'unit', status: 'completed', conclusion: 'success', sha: SHA, ok: true },
  ]);
});

test('a commit whose checks all succeeded passes', () => {
  const verdict = checksVerdict([ran('unit', 'success'), ran('lint', 'success')], SHA);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.failed, []);
  assert.deepEqual(verdict.counts, { total: 2, passed: 2, failed: 0, skipped: 0 });
});

test('one failed check stops the commit and is named', () => {
  const verdict = checksVerdict([ran('unit', 'success'), ran('lint', 'failure')], SHA);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.failed, ['lint']);
  assert.deepEqual(verdict.counts, { total: 2, passed: 1, failed: 1, skipped: 0 });
});

test('a skipped check counts against the commit and is counted as skipped', () => {
  const verdict = checksVerdict([ran('lint', 'success'), ran('unit', 'skipped')], SHA);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.failed, ['unit']);
  assert.deepEqual(verdict.counts, { total: 2, passed: 1, failed: 1, skipped: 1 });
});

test('a check that is still running has not passed yet', () => {
  const running = { name: 'unit', status: 'in_progress', conclusion: null, head_sha: SHA };
  const verdict = checksVerdict([running], SHA);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.failed, ['unit']);
  assert.deepEqual(verdict.counts, { total: 1, passed: 0, failed: 1, skipped: 0 });
});

test('a check that ran for another commit does not count for this one', () => {
  const verdict = checksVerdict([ran('unit', 'success', 'a1b2c3d')], SHA);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.failed, ['unit']);
  assert.equal(verdict.items[0].sha, 'a1b2c3d');
});

test('two runs of the same check both appear', () => {
  const verdict = checksVerdict([ran('unit', 'failure'), ran('unit', 'success')], SHA);
  assert.equal(verdict.items.length, 2);
  assert.deepEqual(verdict.items.map(item => item.name), ['unit', 'unit']);
  assert.deepEqual(verdict.items.map(item => item.ok), [false, true]);
  assert.equal(verdict.ok, false);
});

test('checks are listed in name order', () => {
  const items = checkItems([ran('unit', 'success'), ran('lint', 'success'), ran('build', 'success')], SHA);
  assert.deepEqual(items.map(item => item.name), ['build', 'lint', 'unit']);
});

test('a commit with no checks at all has nothing to judge it by', () => {
  const verdict = checksVerdict([], SHA);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.items, []);
  assert.deepEqual(verdict.failed, ['no check runs for this commit']);
  assert.deepEqual(verdict.counts, { total: 0, passed: 0, failed: 0, skipped: 0 });
});

test('arguments that are not check runs do not throw', () => {
  assert.deepEqual(checkItems(undefined, SHA), []);
  assert.deepEqual(checkItems('unit', SHA), []);
  assert.deepEqual(checkItems([null, 7, 'unit'], SHA), []);
  assert.deepEqual(checksVerdict(null, SHA), {
    sha: SHA,
    ok: false,
    items: [],
    failed: ['no check runs for this commit'],
    counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
  });
});

test('a check run with no name is still listed, under a label of its own', () => {
  const verdict = checksVerdict([{ status: 'completed', conclusion: 'success', head_sha: SHA }], SHA);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.items.map(item => item.name), ['(unnamed check)']);
});

test('a conclusion nobody recognises is not a pass', () => {
  const verdict = checksVerdict([ran('unit', 'stale')], SHA);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.items[0].conclusion, 'stale');
});
