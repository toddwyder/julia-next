import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  advancePhase,
  initialState,
  acquireLock,
  releaseLock,
  extractVerdict,
  buildImplementPrompt,
  runIssue,
} from './julia-minimal-runner.mjs';

// -- advancePhase: the state machine's transitions, no process spawned. -----

test('advancePhase: fetch succeeds moves to implement', () => {
  const next = advancePhase(initialState('JUL-1'), { type: 'fetched', branch: 'runner/jul-1', worktree: '/tmp/x', baseSha: 'abc' });
  assert.equal(next.phase, 'implement');
  assert.equal(next.baseSha, 'abc');
});

test('advancePhase: fetch failure blocks immediately', () => {
  const next = advancePhase(initialState('JUL-1'), { type: 'fetchFailed', reason: 'no description' });
  assert.equal(next.phase, 'blocked');
  assert.equal(next.reason, 'no description');
});

test('advancePhase: implement failure blocks immediately (no retry)', () => {
  const state = { ...initialState('JUL-1'), phase: 'implement' };
  const next = advancePhase(state, { type: 'implementFailed', reason: 'agy exited 1' });
  assert.equal(next.phase, 'blocked');
});

test('advancePhase: checks failing on attempt 1 goes back to implement, attempt 2', () => {
  const state = { ...initialState('JUL-1'), phase: 'check', attempt: 1 };
  const next = advancePhase(state, { type: 'checksFailed', result: { pass: false, summary: 'tests red' } });
  assert.equal(next.phase, 'implement');
  assert.equal(next.attempt, 2);
});

test('advancePhase: checks failing again on attempt 2 blocks -- the correction round is used up', () => {
  const state = { ...initialState('JUL-1'), phase: 'check', attempt: 2 };
  const next = advancePhase(state, { type: 'checksFailed', result: { pass: false, summary: 'still red' } });
  assert.equal(next.phase, 'blocked');
  assert.match(next.reason, /still red/);
});

test('advancePhase: review clean on both axes reaches done', () => {
  const state = { ...initialState('JUL-1'), phase: 'review', attempt: 1 };
  const next = advancePhase(state, { type: 'reviewClean', result: { summary: 'clean on both axes' } });
  assert.equal(next.phase, 'done');
});

test('advancePhase: review findings on attempt 1 triggers one correction round', () => {
  const state = { ...initialState('JUL-1'), phase: 'review', attempt: 1 };
  const next = advancePhase(state, { type: 'reviewFindings', result: { summary: 'actionable findings on: spec' } });
  assert.equal(next.phase, 'implement');
  assert.equal(next.attempt, 2);
});

test('advancePhase: review findings again on attempt 2 blocks', () => {
  const state = { ...initialState('JUL-1'), phase: 'review', attempt: 2 };
  const next = advancePhase(state, { type: 'reviewFindings', result: { summary: 'still findings' } });
  assert.equal(next.phase, 'blocked');
});

test('advancePhase: an outcome that does not belong to the current phase throws', () => {
  const state = { ...initialState('JUL-1'), phase: 'implement' };
  assert.throws(() => advancePhase(state, { type: 'checksPassed', result: {} }));
});

// -- extractVerdict / buildImplementPrompt: small pure helpers. -------------

test('extractVerdict reads the last VERDICT line', () => {
  assert.equal(extractVerdict('blah blah\nVERDICT: CLEAN\n'), 'CLEAN');
  assert.equal(extractVerdict('no verdict here'), null);
});

test('buildImplementPrompt includes the issue and, on a correction round, the findings', () => {
  const skillPath = join(mkdtempSync(join(tmpdir(), 'skills-')), 'skill.md');
  writeFileSync(skillPath, '# a skill');
  const issue = { identifier: 'JUL-9', title: 'Do the thing', description: 'Make X return Y' };
  const clean = buildImplementPrompt(issue, { implementSkillPath: skillPath, tddSkillPath: skillPath, findings: [] });
  assert.match(clean, /Make X return Y/);
  assert.doesNotMatch(clean, /Correction round/);
  const corrected = buildImplementPrompt(issue, { implementSkillPath: skillPath, tddSkillPath: skillPath, findings: ['fix the off-by-one'] });
  assert.match(corrected, /Correction round/);
  assert.match(corrected, /fix the off-by-one/);
});

// -- Lock: only one run at a time. -------------------------------------------

test('acquireLock refuses a second run while the first holds the lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runner-lock-'));
  const path = acquireLock(dir, 'JUL-1');
  assert.throws(() => acquireLock(dir, 'JUL-1'), /already being run/);
  releaseLock(path);
  rmSync(dir, { recursive: true, force: true });
});

// -- runIssue end to end, against a fixture git repo and fake model commands.

function makeRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'runner-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
  mkdirSync(join(repoRoot, 'scripts'), { recursive: true });
  writeFileSync(join(repoRoot, 'README.md'), 'hello\n');
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repoRoot });
  return repoRoot;
}

function baseOpts(repoRoot, stateDir, overrides = {}) {
  const issue = { identifier: 'JUL-1', title: 'Fixture issue', description: 'A described public seam.' };
  return {
    stateDir,
    repoRoot,
    fetchIssueImpl: async () => issue,
    execImpl: spawnSync,
    ...overrides,
  };
}

// A fake `spawnImpl` that: for agy, makes a real commit in the given cwd (so
// the runner's "did HEAD move" check is exercised against real git); for pi,
// returns a canned VERDICT. Call counts are recorded per command so tests can
// assert an external effect ran exactly once.
function fakeSpawn({ agyOutcome = 'commit', verdicts = { spec: 'CLEAN', standards: 'CLEAN' } } = {}) {
  const calls = { agy: 0, pi: 0 };
  const impl = (command, args, opts) => {
    if (command === 'agy') {
      calls.agy += 1;
      if (agyOutcome === 'commit') {
        writeFileSync(join(opts.cwd, `change-${calls.agy}.txt`), 'x\n');
        execFileSync('git', ['add', '.'], { cwd: opts.cwd });
        execFileSync('git', ['commit', '-q', '-m', `candidate ${calls.agy}`], { cwd: opts.cwd });
        return { status: 0, stdout: '{}', stderr: '' };
      }
      if (agyOutcome === 'noCommit') return { status: 0, stdout: '{}', stderr: '' };
      return { status: 1, stdout: '', stderr: 'boom' };
    }
    if (command === 'pi') {
      calls.pi += 1;
      const axisArgIndex = args.indexOf('--model');
      // The prompt is the last arg; find which axis it's for by content.
      const prompt = args[args.length - 1];
      const axis = /spec/i.test(prompt.split('\n')[0]) ? 'spec' : 'standards';
      const verdict = verdicts[axis] ?? 'CLEAN';
      return { status: 0, stdout: `some review text\nVERDICT: ${verdict}\n`, stderr: '' };
    }
    return { status: 1, error: new Error(`unexpected command ${command}`) };
  };
  return { impl, calls };
}

// npm/node checks run through execImpl too (spawnSync is real for git, but we
// need a fake for npm/node so the fixture doesn't need real lint/test setup).
function fakeExec(realExecImpl, { checksPass = true } = {}) {
  return (command, args, opts) => {
    if (command === 'npm' || command === 'node') {
      return checksPass ? { status: 0, stdout: 'ok', stderr: '' } : { status: 1, stdout: '', stderr: 'checks failed' };
    }
    return realExecImpl(command, args, opts);
  };
}

test('runIssue: happy path reaches done, commits once, reviews once per axis', async () => {
  const repoRoot = makeRepo();
  const stateDir = mkdtempSync(join(tmpdir(), 'runner-state-'));
  const { impl: spawnImpl, calls } = fakeSpawn();
  const result = await runIssue('JUL-1', baseOpts(repoRoot, stateDir, {
    execImpl: fakeExec(spawnSync),
    spawnImpl,
  }));
  assert.equal(result.phase, 'done');
  assert.equal(calls.agy, 1);
  assert.equal(calls.pi, 2);
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

test('runIssue: resuming after done does not repeat the completed implement or review effects', async () => {
  const repoRoot = makeRepo();
  const stateDir = mkdtempSync(join(tmpdir(), 'runner-state-'));
  const { impl: spawnImpl, calls } = fakeSpawn();
  const opts = baseOpts(repoRoot, stateDir, { execImpl: fakeExec(spawnSync), spawnImpl });
  await runIssue('JUL-1', opts);
  const again = await runIssue('JUL-1', opts);
  assert.equal(again.phase, 'done');
  assert.equal(calls.agy, 1, 'agy must not be called again once the candidate is already committed and reviewed');
  assert.equal(calls.pi, 2, 'DeepSeek must not be re-run once the review is already clean');
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

test('runIssue: checks failing twice blocks without ever reaching review', async () => {
  const repoRoot = makeRepo();
  const stateDir = mkdtempSync(join(tmpdir(), 'runner-state-'));
  const { impl: spawnImpl, calls } = fakeSpawn();
  const result = await runIssue('JUL-1', baseOpts(repoRoot, stateDir, {
    execImpl: fakeExec(spawnSync, { checksPass: false }),
    spawnImpl,
  }));
  assert.equal(result.phase, 'blocked');
  assert.match(result.reason, /checks still failing after 2 attempts/);
  assert.equal(calls.agy, 2, 'one initial attempt plus one correction round');
  assert.equal(calls.pi, 0, 'review must never run while checks are still failing');
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

test('runIssue: a missing description fails clearly before any model is invoked', async () => {
  const repoRoot = makeRepo();
  const stateDir = mkdtempSync(join(tmpdir(), 'runner-state-'));
  const { impl: spawnImpl, calls } = fakeSpawn();
  const result = await runIssue('JUL-2', {
    stateDir,
    repoRoot,
    fetchIssueImpl: async () => ({ identifier: 'JUL-2', title: 'No seam', description: '' }),
    execImpl: fakeExec(spawnSync),
    spawnImpl,
  });
  assert.equal(result.phase, 'blocked');
  assert.match(result.reason, /no description|test seam/);
  assert.equal(calls.agy, 0);
  assert.equal(calls.pi, 0);
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});
