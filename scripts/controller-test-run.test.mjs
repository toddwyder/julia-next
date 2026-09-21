// controller-test-run.test.mjs -- JUL-98 step 3, item 4: the test suite runs
// ONCE, run by the controller itself, in the candidate worktree, and that one
// result is handed to both the builder and the reviewer.
//
// No fixture is needed here and none is pretended: the suite is a plain command
// (`node --test scripts/*.test.mjs`) and its output is TAP, which this repo's
// own runs print. The TAP text asserted below is the shape this suite prints
// today -- the counts at the end of this very file's run.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUITE_COMMAND,
  parseTapSummary,
  createSuiteRunner,
  testRunLine,
} from '../graph/controller/test-run.mjs';

const GREEN_TAP = [
  'TAP version 13',
  'ok 1 - something',
  '1..522',
  '# tests 522',
  '# suites 0',
  '# pass 521',
  '# fail 0',
  '# cancelled 0',
  '# skipped 1',
  '# todo 0',
  '# duration_ms 3110.764413',
  '',
].join('\n');

const RED_TAP = GREEN_TAP.replace('# pass 521', '# pass 520').replace('# fail 0', '# fail 1');

function clock(times) {
  const remaining = [...times];
  return () => remaining.shift() ?? times[times.length - 1];
}

test('the TAP summary is read out of the run, not taken from anyone\'s word', () => {
  const summary = parseTapSummary(GREEN_TAP);
  assert.deepEqual(summary, { total: 522, pass: 521, fail: 0, skipped: 1, todo: 0, cancelled: 0, ok: true });

  const failed = parseTapSummary(RED_TAP);
  assert.equal(failed.fail, 1);
  assert.equal(failed.ok, false, 'one failure makes the whole result not ok');
});

test('output with no TAP summary at all is a refusal, never a silent pass', () => {
  assert.throws(() => parseTapSummary('bash: node: command not found\n'), /no TAP summary/);
});

test('the controller runs the suite as a plain command in the candidate worktree, and records start, end and counts', async () => {
  const calls = [];
  const runner = createSuiteRunner({
    execImpl: async (options) => { calls.push(options); return { stdout: GREEN_TAP, code: 0 }; },
    now: clock(['2026-09-21T14:00:00.000Z', '2026-09-21T14:00:03.110Z']),
  });

  const result = await runner.runOnce({ key: 'JUL-92:step-1', worktree: '/home/runner/orca/workspaces/julia-next/jul92-step-1' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, '/home/runner/orca/workspaces/julia-next/jul92-step-1', 'in the candidate worktree, not the controller\'s own checkout');
  assert.equal(calls[0].command, SUITE_COMMAND);
  assert.equal(result.startedAt, '2026-09-21T14:00:00.000Z');
  assert.equal(result.endedAt, '2026-09-21T14:00:03.110Z');
  assert.equal(result.durationMs, 3110);
  assert.equal(result.pass, 521);
  assert.equal(result.fail, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.ok, true);
});

test('ONE run, ONE result: the builder and the reviewer are handed the very same object', async () => {
  let runs = 0;
  const runner = createSuiteRunner({
    execImpl: async () => { runs += 1; return { stdout: GREEN_TAP, code: 0 }; },
    now: clock(['2026-09-21T14:00:00.000Z', '2026-09-21T14:00:03.110Z']),
  });

  const first = await runner.runOnce({ key: 'JUL-92:step-1', worktree: '/w' });
  const builders = runner.resultFor('JUL-92:step-1');
  const reviewers = runner.resultFor('JUL-92:step-1');

  assert.equal(runs, 1, 'the suite ran exactly once');
  assert.equal(builders, first, 'the builder gets that run');
  assert.equal(reviewers, first, 'and the reviewer gets the same object, not a second run');
});

test('asking for the same step\'s run again does not run it again', async () => {
  let runs = 0;
  const runner = createSuiteRunner({
    execImpl: async () => { runs += 1; return { stdout: GREEN_TAP, code: 0 }; },
    now: clock(['2026-09-21T14:00:00.000Z', '2026-09-21T14:00:03.110Z']),
  });
  const first = await runner.runOnce({ key: 'JUL-92:step-1', worktree: '/w' });
  const again = await runner.runOnce({ key: 'JUL-92:step-1', worktree: '/w' });
  assert.equal(runs, 1, 'the suite must never be run twice for one step');
  assert.deepEqual(
    { ...again, replayed: false },
    first,
    'the repeat hands back the first run, unchanged',
  );
  assert.equal(again.replayed, true, 'and says it is a replay rather than pretending to be freshly measured');
  assert.equal(runner.resultFor('JUL-92:step-1'), first, 'the stored result is still the one both seats are given');
});

test('a different step gets its own single run', async () => {
  let runs = 0;
  const runner = createSuiteRunner({
    execImpl: async () => { runs += 1; return { stdout: GREEN_TAP, code: 0 }; },
    now: () => '2026-09-21T14:00:00.000Z',
  });
  await runner.runOnce({ key: 'JUL-92:step-1', worktree: '/w1' });
  await runner.runOnce({ key: 'JUL-92:step-2', worktree: '/w2' });
  assert.equal(runs, 2);
});

test('a failing suite is reported as failing, with its counts, and the non-zero exit is not an error to swallow', async () => {
  const runner = createSuiteRunner({
    execImpl: async () => { const error = new Error('Command failed'); error.stdout = RED_TAP; error.code = 1; throw error; },
    now: clock(['2026-09-21T14:00:00.000Z', '2026-09-21T14:00:09.000Z']),
  });
  const result = await runner.runOnce({ key: 'JUL-92:step-1', worktree: '/w' });
  assert.equal(result.ok, false);
  assert.equal(result.fail, 1);
  assert.equal(result.pass, 520);
  assert.equal(result.exitCode, 1);
});

test('a run that produced no TAP at all fails loudly: the step has no test result, and says so', async () => {
  const runner = createSuiteRunner({
    execImpl: async () => { const error = new Error('spawn failed'); error.stdout = ''; error.stderr = 'sh: node: not found'; throw error; },
    now: () => '2026-09-21T14:00:00.000Z',
  });
  await assert.rejects(
    () => runner.runOnce({ key: 'JUL-92:step-1', worktree: '/w' }),
    /no TAP summary/,
  );
});

test('the line posted on the card carries the times and the counts, beside the step\'s cost line', () => {
  const line = testRunLine({
    key: 'JUL-92:step-1',
    command: SUITE_COMMAND,
    worktree: '/home/runner/orca/workspaces/julia-next/jul92-step-1',
    startedAt: '2026-09-21T14:00:00.000Z',
    endedAt: '2026-09-21T14:00:03.110Z',
    durationMs: 3110,
    total: 522,
    pass: 521,
    fail: 0,
    skipped: 1,
    ok: true,
  });
  assert.match(line, /14:00:00Z/);
  assert.match(line, /14:00:03Z/);
  assert.match(line, /521 pass/);
  assert.match(line, /0 fail/);
  assert.match(line, /1 skipped/);
  assert.match(line, /node --test scripts\/\*\.test\.mjs/);
});
