// Which proofs a change gets, and how a proof's result reads to someone who
// never saw the command run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { countLanes, countsIn, DASHBOARD_PROOFS, lastLines, LOCAL_TESTS, SERVER_TESTS, proofResult, proofThatCouldNotRun, proofsFor, skipsIn } from './proofs.mjs';

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
  const proof = { name: 'local tests', argv: ['node', 'scripts/test-owners.mjs', '--run', 'local'], expects: 'tests' };

  const passed = proofResult({ proof, code: 0, seconds: 12.5, output: '\u2139 tests 473\n\u2139 pass 381\n\u2139 fail 0\n\u2139 skipped 92\n' });
  assert.deepEqual(passed, {
    name: 'local tests',
    command: 'node scripts/test-owners.mjs --run local',
    ok: true,
    code: 0,
    seconds: 12.5,
    skipped: 92,
    detail: 'exited 0, 473 tests, 381 passed, 0 failed',
  });

  const failed = proofResult({ proof, code: 1, seconds: 3, output: '' });
  assert.equal(failed.ok, false);
  assert.equal(failed.detail, 'exited 1: printed no test summary, so nothing is proven');
  assert.equal(failed.skipped, 0);
});

test('a failed proof carries the last thing it said, so the reader can act', () => {
  const output = 'driving the dashboard\n\nlane 4 PASS add a model to a panel\nlane 5 FAIL refuse to empty a panel\nlane 6 PASS pick each effort in turn\n';
  const result = proofResult({ proof: { name: DASHBOARD_PROOFS, argv: ['node', 'lanes.mjs'], expects: 'lanes' }, code: 1, output });

  assert.equal(result.ok, false);
  assert.match(result.detail, /^exited 1, 3 lanes, 2 passed, 1 failed: /);
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
  const proof = { name: 'server tests', argv: ['node', 'scripts/test-owners.mjs', '--run', 'server'], expects: 'tests' };

  const ran = proofResult({ proof, code: 0, output: '\u2139 tests 543\n\u2139 pass 450\n\u2139 fail 0\n' });
  assert.equal(ran.ok, true);
  assert.equal(ran.detail, 'exited 0, 543 tests, 450 passed, 0 failed');

  const nothing = proofResult({ proof, code: 0, output: '\u2139 tests 0\n\u2139 pass 0\n\u2139 fail 0\n' });
  assert.equal(nothing.ok, false);
  assert.match(nothing.detail, /collected no tests, so nothing is proven/);

  const silent = proofResult({ proof, code: 0, output: 'no summary at all\n' });
  assert.equal(silent.ok, false);
  assert.match(silent.detail, /printed no test summary, so nothing is proven/);
});

test('a lane run that drove nothing, or only part of the dashboard, is a failure', () => {
  const proof = { name: DASHBOARD_PROOFS, argv: ['node', 'dashboard/scripts/lanes.mjs', '--url', 'http://host:4400'], expects: 'lanes' };

  const nothing = proofResult({ proof, code: 0, output: 'Driving http://host:4400 as it is\n' });
  assert.equal(nothing.ok, false);
  assert.match(nothing.detail, /reported no lane, so the dashboard was not driven/);

  const partway = proofResult({ proof, code: 0, output: 'lane 1 PASS a\nlane 2 PASS b\n', declared: 11 });
  assert.equal(partway.ok, false);
  assert.match(partway.detail, /reported 2 of 11 lanes, so part of the dashboard was never driven/);

  const whole = proofResult({ proof, code: 0, output: Array.from({ length: 11 }, (_, index) => `lane ${index + 1} PASS a`).join('\n'), declared: 11 });
  assert.equal(whole.ok, true);
  assert.equal(whole.detail, 'exited 0, 11 lanes, 11 passed, 0 failed');
});

test('the lanes the checkout declares are counted from its own source', () => {
  const source = "const lane = (number, title) => lanes.push({ number });\n\nlane(1, 'change the Building group model', 'phone', async page => {\n});\nlane(2, 'one role alone', 'desktop', async page => {});\n";
  assert.equal(countLanes(source), 2);

  const shipped = readFileSync(new URL('../../dashboard/scripts/lanes.mjs', import.meta.url), 'utf8');
  assert.equal(countLanes(shipped), 11);
});

test('a suite that skipped where skipping means the engine was missing is a failure', () => {
  const proof = { name: 'server tests', argv: ['node', 'scripts/test-owners.mjs', '--run', 'server'], expects: 'tests', noSkips: true };
  const result = proofResult({ proof, code: 0, output: '\u2139 tests 3\n\u2139 pass 0\n\u2139 fail 0\n\u2139 skipped 3\n' });

  assert.equal(result.ok, false);
  assert.match(result.detail, /skipped 3 tests, and a skipped proof is a failure/);

  const local = proofResult({ proof: { ...proof, noSkips: false }, code: 0, output: '\u2139 tests 473\n\u2139 pass 381\n\u2139 fail 0\n\u2139 skipped 92\n' });
  assert.equal(local.ok, true);
});

test('a proof that does not say what it should have collected proves nothing', () => {
  const result = proofResult({ proof: { name: 'something', argv: ['node', 'x.mjs'] }, code: 0, output: 'all good\n' });

  assert.equal(result.ok, false);
  assert.match(result.detail, /does not say what it should have collected, so nothing is proven/);
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
