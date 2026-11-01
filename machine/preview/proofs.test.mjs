// Which proofs a change gets, and how a proof's result reads to someone who
// never saw the command run.
import assert from 'node:assert/strict';
import test from 'node:test';

import { DASHBOARD_PROOFS, LOCAL_TESTS, SERVER_TESTS, proofResult, proofThatCouldNotRun, proofsFor, skipsIn } from './proofs.mjs';

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
