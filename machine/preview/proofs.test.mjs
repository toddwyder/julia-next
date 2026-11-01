// Which proofs a change gets, and how a proof's result reads to someone who
// never saw the command run.
import assert from 'node:assert/strict';
import test from 'node:test';

import { countsIn, DASHBOARD_PROOFS, lastLines, LOCAL_TESTS, SERVER_TESTS, proofResult, proofThatCouldNotRun, proofsFor, skipsIn } from './proofs.mjs';

test('a change that never meets the dashboard owes the proof CI cannot run', () => {
  const proofs = proofsFor('machine');

  assert.deepEqual(proofs.map(proof => proof.name), [SERVER_TESTS]);
  assert.deepEqual(proofs[0].argv, ['node', 'scripts/test-owners.mjs', '--run', 'server']);
});

test('a change that meets the dashboard is also driven at its own address', () => {
  const proofs = proofsFor('dashboard', { address: 'http://100.119.112.9:4401' });

  assert.deepEqual(proofs.map(proof => proof.name), [SERVER_TESTS, LOCAL_TESTS, DASHBOARD_PROOFS]);
  assert.deepEqual(proofs[2].argv, ['node', 'dashboard/scripts/lanes.mjs', '--url', 'http://100.119.112.9:4401']);
});

test('a dashboard change with no address still names the proof it owes', () => {
  const proofs = proofsFor('dashboard');

  assert.equal(proofs.at(-1).name, DASHBOARD_PROOFS);
  assert.deepEqual(proofs.at(-1).argv, ['node', 'dashboard/scripts/lanes.mjs', '--url', '']);
});

test('the skipped count is read from every run summary a proof printed', () => {
  assert.equal(skipsIn('ℹ skipped 92\nℹ skipped 6\n'), 98);
  assert.equal(skipsIn('ℹ tests 7\nℹ skipped 0\n'), 0);
  assert.equal(skipsIn('  skipped 4 (not the summary)\n'), 0);
  assert.equal(skipsIn(undefined), 0);
});

test('a proof passes only on exit code zero, and says so in words', () => {
  const proof = { name: 'local tests', argv: ['node', 'scripts/test-owners.mjs', '--run', 'local'] };

  const passed = proofResult({ proof, code: 0, seconds: 12.5, output: 'ℹ skipped 92\n' });
  assert.deepEqual(passed, {
    name: 'local tests',
    command: 'node scripts/test-owners.mjs --run local',
    ok: true,
    code: 0,
    seconds: 12.5,
    skipped: 92,
    detail: 'exited 0',
  });

  const failed = proofResult({ proof, code: 1, seconds: 3, output: '' });
  assert.equal(failed.ok, false);
  assert.equal(failed.detail, 'exited 1');
  assert.equal(failed.skipped, 0);
});

test('a failed proof carries the last thing it said, so the reader can act', () => {
  const output = 'driving the dashboard\n\nlane 4 PASS add a model to a panel\nlane 5 FAIL refuse to empty a panel\nlane 6 PASS pick each effort in turn\n';
  const result = proofResult({ proof: { name: DASHBOARD_PROOFS, argv: ['node', 'lanes.mjs'] }, code: 1, output });

  assert.equal(result.ok, false);
  assert.match(result.detail, /^exited 1: /);
  assert.match(result.detail, /lane 5 FAIL refuse to empty a panel$/);
  assert.doesNotMatch(result.detail, /lane 6 PASS/);
  assert.equal(lastLines('a\nb\nc\nd\ne', 2), 'd; e');
});

test('the counts are read through the colour codes the suite prints', () => {
  const coloured = '\u001b[34m\u2139 tests 3\u001b[39m\n\u001b[34m\u2139 pass 3\u001b[39m\n\u001b[34m\u2139 fail 0\u001b[39m\n\u001b[34m\u2139 skipped 1\u001b[39m\n';

  assert.deepEqual(countsIn(coloured), { tests: 3, pass: 3, fail: 0 });
  assert.equal(skipsIn(coloured), 1);
});

test('the line carries the counts, so a reader can tell a suite that ran from one that did not', () => {
  const proof = { name: 'server tests', argv: ['node', 'scripts/test-owners.mjs', '--run', 'server'] };

  const ran = proofResult({ proof, code: 0, output: '\u2139 tests 543\n\u2139 pass 450\n\u2139 fail 0\n' });
  assert.equal(ran.ok, true);
  assert.equal(ran.detail, 'exited 0, 543 tests, 450 passed, 0 failed');

  const nothing = proofResult({ proof, code: 0, output: '\u2139 tests 0\n\u2139 pass 0\n\u2139 fail 0\n' });
  assert.equal(nothing.ok, false);
  assert.match(nothing.detail, /nothing ran, so nothing was proven/);

  const lanes = proofResult({ proof: { name: 'dashboard proofs', argv: ['node', 'lanes.mjs'] }, code: 0, output: 'lane 1 passed\n' });
  assert.equal(lanes.ok, true);
  assert.equal(lanes.detail, 'exited 0');
});

test('a proof nothing ran reads as a failing line, never as a passing one', () => {
  const line = proofThatCouldNotRun({ name: 'dashboard proofs', argv: ['node', 'lanes.mjs'] }, 'the preview never answered');

  assert.deepEqual(line, {
    name: 'dashboard proofs',
    command: 'node lanes.mjs',
    ok: false,
    code: null,
    seconds: null,
    skipped: 0,
    detail: 'the preview never answered',
  });
});
