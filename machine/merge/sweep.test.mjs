import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cardToken, branchBelongsToCard, deadTestFiles, runSweep, sweepPlan, sweepSummary } from './sweep.mjs';

const ROOT = '/repo';

test('a branch belongs to a card only when the card id stands alone in the name', () => {
  assert.equal(branchBelongsToCard('feat/jul-310-merge', 'JUL-310'), true);
  assert.equal(branchBelongsToCard('JUL-310', 'JUL-310'), true);
  assert.equal(branchBelongsToCard('practice/jul-3100', 'JUL-310'), false);
  assert.equal(branchBelongsToCard('feat/jul-31-other', 'JUL-310'), false);
  assert.equal(branchBelongsToCard('practice/jul-312', 'JUL-310'), false);
  assert.equal(cardToken('JUL-310').test('fix/jul-310'), true);
});

test('the sweep removes this card branches that main holds, and keeps every other one', () => {
  const plan = sweepPlan({
    root: ROOT,
    card: 'JUL-310',
    pr: 420,
    branches: [
      { name: 'main', merged: false, remote: false },
      { name: 'feat/jul-310-merge', merged: true, remote: false },
      { name: 'feat/jul-310-merge', merged: false, remote: true, head: 'a'.repeat(40) },
      { name: 'feat/jul-310-other', merged: false, remote: false, head: 'b'.repeat(40) },
      { name: 'feat/jul-311-next', merged: true, remote: false },
      { name: 'practice/jul-312', merged: true, remote: true },
    ],
    mergedHead: 'a'.repeat(40),
  });
  assert.deepEqual(plan.removeBranches, [
    { name: 'feat/jul-310-merge', remote: false },
    { name: 'feat/jul-310-merge', remote: true },
  ]);
  assert.deepEqual(plan.keep.map(entry => entry.what), ['branch feat/jul-310-other']);
  assert.equal(plan.noticed.length, 0);
});

test('the branch the machine is standing on is never removed, and neither is the main line', () => {
  const plan = sweepPlan({
    root: ROOT,
    card: 'JUL-310',
    pr: 420,
    currentBranch: 'feat/jul-310-merge',
    branches: [
      { name: 'main', merged: true, remote: false },
      { name: 'main', merged: true, remote: true, isDefault: true },
      { name: 'feat/jul-310-merge', merged: true, remote: false },
    ],
  });
  assert.deepEqual(plan.removeBranches, []);
  assert.deepEqual(plan.keep, [{ what: 'branch feat/jul-310-merge', why: 'it is the main line' }]);
});

test('run folders are removed only for this pull request and only under .artifacts', () => {
  const plan = sweepPlan({
    root: ROOT,
    card: 'JUL-310',
    pr: 420,
    runDirs: ['/repo/.artifacts/shipping/pr-420', '/repo/.artifacts/remediation/pr-420', '/repo/.artifacts/shipping/pr-419', '/tmp/pr-420'],
  });
  assert.deepEqual(plan.removeDirs, ['/repo/.artifacts/shipping/pr-420', '/repo/.artifacts/remediation/pr-420']);
  assert.equal(plan.noticed.length, 2);
});

test('worktrees under .artifacts for this pull request go; ones outside are only noticed', () => {
  const plan = sweepPlan({
    root: ROOT,
    card: 'JUL-310',
    pr: 420,
    worktrees: [
      { path: '/repo', branch: 'main' },
      { path: '/repo/.artifacts/shipping/pr-420/worktree', branch: null },
      { path: '/repo/.artifacts/shipping/pr-421/worktree', branch: 'feat/jul-310-other' },
      { path: '/home/somewhere/jul-310', branch: 'feat/jul-310-merge' },
    ],
  });
  assert.deepEqual(plan.removeWorktrees, ['/repo/.artifacts/shipping/pr-420/worktree']);
  assert.equal(plan.noticed.length, 2);
});

test('a test whose own module is gone is a leftover, and one whose module is there is not', () => {
  const files = {
    '/repo/machine/merge/dead.test.mjs': "import { gone } from './nowhere.mjs';\n",
    '/repo/machine/merge/live.test.mjs': "import { kept } from './gate.mjs';\n",
  };
  const dead = deadTestFiles({
    files: Object.keys(files),
    read: file => files[file],
    exists: target => target === '/repo/machine/merge/gate.mjs',
  });
  assert.deepEqual(dead, [{ path: '/repo/machine/merge/dead.test.mjs', missing: ['./nowhere.mjs'] }]);
});

test('nothing under the scorecard folder is ever removed, even if it is offered', () => {
  assert.throws(
    () =>
      sweepPlan({
        root: ROOT,
        card: 'JUL-310',
        pr: 420,
        runDirs: ['/repo/.artifacts/docs/scorecards/pr-420'],
      }),
    /the cost rows stay/
  );

  const plan = sweepPlan({
    root: ROOT,
    card: 'JUL-310',
    pr: 420,
    deadTests: [{ path: '/repo/docs/scorecards/JUL-310.test.mjs', missing: ['./x'] }],
  });
  assert.deepEqual(plan.removeTests, []);
  assert.match(plan.noticed[0].why, /protected path/);
});

test('the sweep removes what the plan named and reports what it could not', () => {
  const calls = [];
  const result = runSweep({
    plan: {
      removeBranches: [{ name: 'feat/jul-310-merge', remote: true }, { name: 'feat/jul-310-local', remote: false }],
      removeWorktrees: ['/repo/.artifacts/shipping/pr-420/worktree'],
      removeDirs: ['/repo/.artifacts/shipping/pr-420'],
      removeTests: [],
      keep: [],
      noticed: [],
    },
    root: ROOT,
    git: args => {
      calls.push(['git', ...args]);
      if (args[0] === 'push' && args[3] === 'feat/jul-310-merge') throw new Error('remote branch already gone');
    },
    rmImpl: target => calls.push(['rm', target]),
    log: () => {},
  });
  assert.deepEqual(result.removed.map(item => item.what), [
    '/repo/.artifacts/shipping/pr-420',
    '/repo/.artifacts/shipping/pr-420/worktree',
    'feat/jul-310-local',
  ]);
  assert.deepEqual(result.errors, [{ what: 'feat/jul-310-merge', error: 'remote branch already gone' }]);
  assert.ok(calls.some(call => call[0] === 'git' && call[1] === 'worktree' && call[2] === 'remove'));
});

test('the summary counts what will go, what stays, and what needs a person', () => {
  assert.equal(
    sweepSummary({ removeBranches: [{ name: 'a' }], removeWorktrees: [], removeDirs: ['d'], removeTests: [], keep: [{ what: 'main' }], noticed: [] }),
    '2 leftovers to remove, 1 kept, 0 for the noticed list.'
  );
});

test('a run folder is deleted for real, and a worktree falls back to the disk when git refuses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-sweep-'));
  const artifacts = path.join(dir, '.artifacts');
  const runDir = path.join(artifacts, 'shipping', 'pr-420');
  const tree = path.join(runDir, 'worktree');
  fs.mkdirSync(tree, { recursive: true });
  fs.writeFileSync(path.join(tree, 'file.txt'), 'leftover\n');
  const gitCalls = [];
  try {
    const result = runSweep({
      plan: {
        removeBranches: [],
        removeWorktrees: [tree],
        removeDirs: [runDir],
        removeTests: [],
        keep: [],
        noticed: [],
      },
      root: dir,
      git: args => {
        gitCalls.push(args);
        throw new Error('not a repository');
      },
      log: () => {},
    });
    assert.equal(fs.existsSync(runDir), false);
    assert.deepEqual(result.removed.map(item => item.what), [runDir, tree]);
    assert.deepEqual(gitCalls, [['worktree', 'remove', '--force', tree], ['worktree', 'prune']]);
    assert.equal(result.errors.filter(error => error.what === tree).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a removal that the disk refuses is reported, not swallowed', () => {
  const result = runSweep({
    plan: { removeBranches: [], removeWorktrees: [], removeDirs: ['/repo/.artifacts/shipping/pr-420'], removeTests: [], keep: [], noticed: [] },
    root: '/repo',
    git: () => '',
    rmImpl: () => {
      throw new Error('EBUSY');
    },
    log: () => {},
  });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.errors, [{ what: '/repo/.artifacts/shipping/pr-420', error: 'EBUSY' }]);
});
