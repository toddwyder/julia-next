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
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SUITE_COMMAND,
  parseTapSummary,
  createSuiteRunner,
  testRunLine,
  testRunJournalLine,
  parseTapFailures,
  MAX_REPORTED_FAILURES,
  MAX_FAILURE_TEXT,
  MAX_FAILURE_NAME,
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

// ---------------------------------------------------------------------------
// JUL-98 step 5, sixth fix: a failing run says WHICH tests failed, and every
// run says whether the worktree it was measured in matched the commit.
//
// The live run on 2026-09-21 handed a reviewer "720 pass, 1 fail, 0 skipped of
// 721" and nothing else. Nobody could tell which test failed, and the same
// commit was green when the coordinator re-ran it afterwards -- the worktree
// was gone by then, so the difference could not be recovered. Both halves of
// that hole are pinned below.

// Real `node --test` TAP for one failing test, including the YAML diagnostic
// block it prints underneath, and the enclosing file's own `subtestFailed`.
const FAILING_TAP = [
  'TAP version 13',
  '# Subtest: scripts/thing.test.mjs',
  '    # Subtest: the widget counts its parts',
  '    not ok 1 - the widget counts its parts',
  '      ---',
  '      duration_ms: 1.234',
  '      location: /repo/scripts/thing.test.mjs:12:1',
  '      failureType: "testCodeFailure"',
  '      error: |-',
  '        Expected values to be strictly equal:',
  '',
  '        3 !== 4',
  '      code: "ERR_ASSERTION"',
  '      ...',
  'not ok 1 - scripts/thing.test.mjs',
  '  ---',
  '  duration_ms: 90.1',
  '  failureType: "subtestFailed"',
  '  error: "test failed"',
  '  code: "ERR_TEST_FAILURE"',
  '  ...',
  '1..1',
  '# tests 2',
  '# pass 1',
  '# fail 1',
  '# cancelled 0',
  '# skipped 0',
  '# todo 0',
  '# duration_ms 90.1',
  '',
].join('\n');

const CLEAN_STATE = { known: true, clean: true, commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', shortCommit: 'a1b2c3d', dirtyCount: 0, dirty: [] };
const DIRTY_STATE = { known: true, clean: false, commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', shortCommit: 'a1b2c3d', dirtyCount: 2, dirty: [' M graph/controller/test-run.mjs', '?? scratch.txt'] };

const PASSING_RESULT = {
  key: 'JUL-92:step-1',
  command: SUITE_COMMAND,
  worktree: '/home/runner/orca/workspaces/julia-next/jul92-step-1',
  startedAt: '2026-09-21T14:00:00.000Z',
  endedAt: '2026-09-21T14:00:03.110Z',
  durationMs: 3110,
  total: 522, pass: 521, fail: 0, skipped: 1, ok: true,
  output: GREEN_TAP,
};

test('a failing run names the failing tests and carries their error text', () => {
  const failures = parseTapFailures(FAILING_TAP);
  assert.equal(failures.total, 1, 'the enclosing file\'s subtestFailed entry is not counted as a second failure');
  assert.equal(failures.shown.length, 1);
  assert.equal(failures.shown[0].name, 'the widget counts its parts');
  assert.equal(failures.shown[0].tapLine, 'not ok 1 - the widget counts its parts');
  assert.match(failures.shown[0].error, /Expected values to be strictly equal/);
  assert.match(failures.shown[0].error, /3 !== 4/);

  const line = testRunLine({
    ...PASSING_RESULT,
    total: 2, pass: 1, fail: 1, skipped: 0, ok: false,
    output: FAILING_TAP,
    worktreeState: CLEAN_STATE,
  });
  assert.match(line, /1 pass, 1 fail/);
  assert.match(line, /the widget counts its parts/, 'the card says WHICH test failed, not just how many');
  assert.match(line, /3 !== 4/, 'and what it said');
});

test('the failure detail is capped, and says that it was, so one pathological run cannot post a novel', () => {
  const many = [
    'TAP version 13',
    ...Array.from({ length: 9 }, (_, i) => [
      `not ok ${i + 1} - failure number ${i + 1}`,
      '  ---',
      '  failureType: "testCodeFailure"',
      '  error: |-',
      `    ${'x'.repeat(4000)}`,
      '  ...',
    ]).flat(),
    '# tests 9', '# pass 0', '# fail 9', '# skipped 0', '',
  ].join('\n');

  const failures = parseTapFailures(many);
  assert.equal(failures.total, 9);
  assert.equal(failures.shown.length, MAX_REPORTED_FAILURES, 'only the first few are shown');
  assert.equal(failures.truncated, true);
  for (const shown of failures.shown) {
    assert.ok(shown.error.length <= MAX_FAILURE_TEXT + 20, `error text is capped at ${MAX_FAILURE_TEXT}`);
  }

  const line = testRunLine({
    ...PASSING_RESULT, total: 9, pass: 0, fail: 9, skipped: 0, ok: false, output: many, worktreeState: CLEAN_STATE,
  });
  assert.match(line, new RegExp(`${MAX_REPORTED_FAILURES} of 9 shown`), 'the card says how many failures it is not showing');
  assert.ok(line.length < 8000, `the card line stays readable; got ${line.length} characters`);
});

test('a failing run with no parseable failure lines still posts its counts, and says the detail was not found', () => {
  const line = testRunLine({
    ...PASSING_RESULT, total: 5, pass: 4, fail: 1, skipped: 0, ok: false,
    output: '# tests 5\n# pass 4\n# fail 1\n',
    worktreeState: CLEAN_STATE,
  });
  assert.match(line, /1 fail/);
  assert.match(line, /no "not ok" line/i);
});

test('a passing run posts exactly what it posts today: counts, times, command, worktree -- and no failure detail', () => {
  const line = testRunLine(PASSING_RESULT);
  assert.equal(
    line,
    '**Tests** (run once by the controller): 14:00:00Z-14:00:03Z, 3.1s -- 521 pass, 0 fail, 1 skipped of 522. `node --test scripts/*.test.mjs` in `/home/runner/orca/workspaces/julia-next/jul92-step-1`.',
    'the passing form is unchanged from before this fix',
  );
  assert.equal(line.includes('\n'), false, 'a passing run keeps its one-line form');
});

test('a run on a clean worktree says so, with the commit it was at', () => {
  const line = testRunLine({ ...PASSING_RESULT, worktreeState: CLEAN_STATE });
  assert.match(line, /clean at a1b2c3d/i);
  assert.equal(line.includes('\n'), false, 'a clean passing run is still one line');
});

test('a run on a dirty worktree says so plainly, and the result is still a result -- the step is NOT refused', async () => {
  const runner = createSuiteRunner({
    execImpl: async () => ({ stdout: GREEN_TAP }),
    gitImpl: async ({ args }) => ({
      stdout: args[0] === 'rev-parse' ? 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n' : ' M graph/controller/test-run.mjs\n?? scratch.txt\n',
    }),
    now: clock(['2026-09-21T14:00:00.000Z', '2026-09-21T14:00:03.110Z']),
  });
  const result = await runner.runOnce({ key: 'JUL-92:step-1', worktree: '/w' });

  assert.equal(result.ok, true, 'a dirty worktree does not make a green run fail');
  assert.equal(result.worktreeState.clean, false);
  assert.equal(result.worktreeState.dirtyCount, 2);
  assert.equal(result.worktreeState.commit, 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');

  const line = testRunLine(result);
  assert.match(line, /not clean/i);
  assert.match(line, /a1b2c3d/);
  assert.match(line, /worktree, not the commit/i);
});

test('the worktree is read through the same safe.directory env the suite runs under, for exactly that worktree', async () => {
  const order = [];
  const seen = [];
  const runner = createSuiteRunner({
    env: {},
    execImpl: async () => {
      order.push('exec');
      return { stdout: GREEN_TAP };
    },
    gitImpl: async (options) => {
      order.push(`git:${options.args[0]}`);
      seen.push(options);
      return { stdout: options.args[0] === 'rev-parse' ? 'abc1234567890\n' : '' };
    },
    now: () => '2026-09-21T14:00:00.000Z',
  });
  await runner.runOnce({ key: 'JUL-92:step-1', worktree: '/w' });

  assert.deepEqual(order, ['git:status', 'git:rev-parse', 'exec'], 'worktree state is read before the suite runs');
  assert.equal(seen.length, 2, 'status and rev-parse, nothing else');
  assert.deepEqual(seen[0].args, ['status', '--porcelain'], 'exact git status argv');
  assert.deepEqual(seen[1].args, ['rev-parse', 'HEAD'], 'exact git rev-parse argv');
  for (const call of seen) {
    assert.equal(call.cwd, '/w');
    assert.equal(call.env.GIT_CONFIG_COUNT, '1');
    assert.equal(call.env.GIT_CONFIG_KEY_0, 'safe.directory');
    assert.equal(call.env.GIT_CONFIG_VALUE_0, '/w', 'exactly the one worktree, not a wildcard and not its parent');
  }
});

test('git refusing to answer does not fail the run: the state is recorded as unknown and said to be unknown', async () => {
  const runner = createSuiteRunner({
    execImpl: async () => ({ stdout: GREEN_TAP }),
    gitImpl: async () => { throw new Error('fatal: detected dubious ownership in repository at /w'); },
    now: () => '2026-09-21T14:00:00.000Z',
  });
  const result = await runner.runOnce({ key: 'JUL-92:step-1', worktree: '/w' });
  assert.equal(result.ok, true);
  assert.equal(result.worktreeState.known, false);
  assert.match(testRunLine(result), /worktree state unknown/i);
});

test('the journal line carries the same facts on one physical line, so journalctl can be grepped', () => {
  const line = testRunJournalLine({
    ...PASSING_RESULT, total: 2, pass: 1, fail: 1, skipped: 0, ok: false, output: FAILING_TAP, worktreeState: DIRTY_STATE,
  });
  assert.equal(line.includes('\n'), false, 'one journal line, however many failures');
  assert.match(line, /1 fail/);
  assert.match(line, /the widget counts its parts/);
  assert.match(line, /3 !== 4/);
  assert.match(line, /not clean/i);
  assert.match(line, /a1b2c3d/);
});

function runNodeTestTap(code) {
  const dir = mkdtempSync(join(tmpdir(), 'tap-test-'));
  const file = join(dir, 'sample.test.mjs');
  try {
    writeFileSync(file, code);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env });
    return stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('literal three-dot error line in a YAML diagnostic block does not prematurely end the diagnostic (real node output)', () => {
  const tap = runNodeTestTap(`
import test from 'node:test';
test('literal three-dot error', () => {
  throw new Error(['before', '...', 'after important cause'].join('\\n'));
});
`);
  const failures = parseTapFailures(tap);
  assert.equal(failures.total, 1);
  assert.equal(failures.shown.length, 1);
  assert.match(failures.shown[0].error, /before/);
  assert.match(failures.shown[0].error, /\.\.\./);
  assert.match(failures.shown[0].error, /after important cause/);
});

test('expected TODO and SKIP outcomes are excluded from actionable failures and do not displace genuine failures (real node output)', () => {
  const tap = runNodeTestTap(`
import test from 'node:test';
test('skip pass', { skip: 'not needed' }, () => {});
for (let i = 1; i <= 5; i++) {
  test('expected ' + i, { todo: 'not ready' }, () => { throw new Error('todo ' + i); });
}
test('ACTUAL CAUSE', () => { throw new Error('genuine failure'); });
`);
  const failures = parseTapFailures(tap);
  assert.equal(failures.total, 1, 'only the genuine failure is counted as actionable');
  assert.equal(failures.shown.length, 1);
  assert.equal(failures.shown[0].name, 'ACTUAL CAUSE');
  assert.match(failures.shown[0].error, /genuine failure/);

  const line = testRunLine({
    ...PASSING_RESULT,
    total: 7, pass: 0, fail: 1, todo: 5, skipped: 1, ok: false,
    output: tap,
    worktreeState: CLEAN_STATE,
  });
  assert.match(line, /ACTUAL CAUSE/, 'the card names the genuine failure, not the TODO tests');
  assert.doesNotMatch(line, /expected 1/);
  assert.doesNotMatch(line, /skip pass/);
});

test('test names containing hash characters are preserved when not a TAP directive', () => {
  const tap = [
    'TAP version 13',
    'not ok 1 - issue #123: fix widget',
    '  ---',
    '  failureType: "testCodeFailure"',
    '  error: "failed"',
    '  ...',
    '# tests 1', '# pass 0', '# fail 1', '# skipped 0', '',
  ].join('\n');
  const failures = parseTapFailures(tap);
  assert.equal(failures.shown[0].name, 'issue #123: fix widget');
  assert.equal(failures.shown[0].tapLine, 'not ok 1 - issue #123: fix widget');
});

test('long test names are capped and disclose truncation explicitly', () => {
  const longName = 'long_test_name_'.repeat(20);
  const tap = [
    'TAP version 13',
    `not ok 1 - ${longName}`,
    '  ---',
    '  failureType: "testCodeFailure"',
    '  error: "something failed"',
    '  ...',
    '# tests 1', '# pass 0', '# fail 1', '# skipped 0', '',
  ].join('\n');

  const failures = parseTapFailures(tap);
  assert.equal(failures.total, 1);
  assert.equal(failures.shown.length, 1);
  assert.equal(failures.nameTruncated, true);
  assert.equal(failures.shown[0].nameTruncated, true);
  assert.ok(failures.shown[0].name.length <= MAX_FAILURE_NAME + 15);
  assert.match(failures.shown[0].name, /\.\.\. \[cut\]$/);
  assert.match(failures.shown[0].tapLine, /\.\.\. \[cut\]$/);

  const line = testRunLine({
    ...PASSING_RESULT, total: 1, pass: 0, fail: 1, skipped: 0, ok: false, output: tap, worktreeState: CLEAN_STATE,
  });
  assert.match(line, new RegExp(`names cut at ${MAX_FAILURE_NAME} characters`));
  assert.match(line, /\.\.\. \[cut\]/);
  assert.ok(line.length < 2000, `line length should be bounded, got ${line.length}`);
});

test('header reports count truncation without falsely claiming error text was cut when errors are short', () => {
  const tap = [
    'TAP version 13',
    ...Array.from({ length: 6 }, (_, i) => [
      `not ok ${i + 1} - short failure ${i + 1}`,
      '  ---',
      '  failureType: "testCodeFailure"',
      '  error: "short error"',
      '  ...',
    ]).flat(),
    '# tests 6', '# pass 0', '# fail 6', '# skipped 0', '',
  ].join('\n');

  const failures = parseTapFailures(tap);
  assert.equal(failures.countTruncated, true);
  assert.equal(failures.textTruncated, false);

  const line = testRunLine({
    ...PASSING_RESULT, total: 6, pass: 0, fail: 6, skipped: 0, ok: false, output: tap, worktreeState: CLEAN_STATE,
  });
  assert.match(line, /\*\*Failing tests\*\* \(5 of 6 shown\):/);
  assert.doesNotMatch(line, /error text cut/);
});

test('header reports error text truncation when error is long even when failure count is not truncated', () => {
  const longError = 'e'.repeat(1000);
  const tap = [
    'TAP version 13',
    'not ok 1 - single failure',
    '  ---',
    '  failureType: "testCodeFailure"',
    '  error: |-',
    `    ${longError}`,
    '  ...',
    '# tests 1', '# pass 0', '# fail 1', '# skipped 0', '',
  ].join('\n');

  const failures = parseTapFailures(tap);
  assert.equal(failures.countTruncated, false);
  assert.equal(failures.textTruncated, true);

  const line = testRunLine({
    ...PASSING_RESULT, total: 1, pass: 0, fail: 1, skipped: 0, ok: false, output: tap, worktreeState: CLEAN_STATE,
  });
  assert.match(line, new RegExp(`\\*\\*Failing tests\\*\\* \\(1, error text cut at ${MAX_FAILURE_TEXT} characters\\):`));
  assert.doesNotMatch(line, /shown/);
});

test('a single overlong failure pins exact retained content and explicit cut disclosure on card and journal lines', () => {
  const head = 'a'.repeat(MAX_FAILURE_TEXT);
  const tail = 'z'.repeat(500);
  const fullError = head + tail;
  const tap = [
    'TAP version 13',
    'not ok 1 - overlong test',
    '  ---',
    '  failureType: "testCodeFailure"',
    '  error: |-',
    `    ${fullError}`,
    '  ...',
    '# tests 1', '# pass 0', '# fail 1', '# skipped 0', '',
  ].join('\n');

  const failures = parseTapFailures(tap);
  assert.equal(failures.shown[0].error, `${head}... [cut]`);

  const result = {
    ...PASSING_RESULT, total: 1, pass: 0, fail: 1, skipped: 0, ok: false, output: tap, worktreeState: CLEAN_STATE,
  };
  const cardLine = testRunLine(result);
  assert.match(cardLine, new RegExp(`error text cut at ${MAX_FAILURE_TEXT} characters`));
  assert.ok(cardLine.includes(`${head}... [cut]`), 'card line contains exact retained content and cut disclosure');
  assert.ok(!cardLine.includes(tail), 'card line does not contain cut tail');

  const journalLine = testRunJournalLine(result);
  assert.match(journalLine, new RegExp(`error text cut at ${MAX_FAILURE_TEXT} characters`));
  assert.ok(journalLine.includes(`${head}... [cut]`), 'journal line contains exact retained content and cut disclosure');
  assert.ok(!journalLine.includes(tail), 'journal line does not contain cut tail');
});
