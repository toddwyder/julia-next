import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assessSandbox,
  defaultInspection,
  findDueSessions,
  retireSandbox,
  SANDBOX_ROOT,
} from './sandbox-cleanup.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function setupRepository({ nested = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-cleanup-'));
  const remote = join(root, 'origin.git');
  const sessionRoot = join(root, 'session-123');
  const checkout = nested ? join(sessionRoot, 'julia-next') : sessionRoot;
  mkdirSync(sessionRoot, { recursive: true });
  mkdirSync(checkout, { recursive: true });
  git(root, 'init', '--bare', remote);
  git(checkout, 'init', '--initial-branch=main');
  git(checkout, 'config', 'user.email', 'test@example.com');
  git(checkout, 'config', 'user.name', 'Test');
  writeFileSync(join(checkout, '.gitignore'), 'ops/factory/app/node_modules/\nignored-logs/\n');
  writeFileSync(join(checkout, 'package.json'), '{}\n');
  mkdirSync(join(checkout, 'ops', 'julia-runner'), { recursive: true });
  writeFileSync(join(checkout, 'ops', 'julia-runner', 'README.md'), '# Runner\n');
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-m', 'base');
  git(checkout, 'remote', 'add', 'origin', remote);
  git(checkout, 'push', '-u', 'origin', 'main');
  git(root, '--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(checkout, 'remote', 'set-url', 'origin', 'https://github.com/example/julia-next.git');
  git(checkout, 'config', `url.${remote}.insteadOf`, 'https://github.com/example/julia-next.git');
  return { root, remote, sessionRoot, checkout };
}

function inspectionWithoutIdle() {
  return { ...defaultInspection(), idle: () => ({ ok: true }) };
}

test('real Git fixtures keep changed tracked files, untracked files, and non-allowlisted ignored logs, but allow nested dependency caches', () => {
  const fixture = setupRepository();
  try {
    writeFileSync(join(fixture.checkout, 'package.json'), '{"changed":true}\n');
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).gate, 'clean-git');
    git(fixture.checkout, 'checkout', '--', 'package.json');

    writeFileSync(join(fixture.checkout, 'unsaved.txt'), 'unsaved\n');
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).gate, 'clean-git');
    rmSync(join(fixture.checkout, 'unsaved.txt'));

    mkdirSync(join(fixture.checkout, 'ignored-logs'), { recursive: true });
    writeFileSync(join(fixture.checkout, 'ignored-logs', 'run.log'), 'keep me\n');
    assert.match(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).reason, /allow-list/);
    rmSync(join(fixture.checkout, 'ignored-logs'), { recursive: true });

    mkdirSync(join(fixture.checkout, 'ops', 'factory', 'app', 'node_modules'), { recursive: true });
    writeFileSync(join(fixture.checkout, 'ops', 'factory', 'app', 'node_modules', 'cache'), 'rebuildable\n');
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).decision, 'eligible');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('each allowed Factory working folder is eligible and deleted when deletion is enabled', () => {
  const fixture = setupRepository();
  try {
    // 1. .artifacts/ (all subfolders)
    mkdirSync(join(fixture.checkout, '.artifacts', 'factory-review'), { recursive: true });
    writeFileSync(join(fixture.checkout, '.artifacts', 'factory-review', 'findings.md'), 'review notes\n');

    // 2. .julia/
    mkdirSync(join(fixture.checkout, '.julia', 'builder-evidence'), { recursive: true });
    writeFileSync(join(fixture.checkout, '.julia', 'builder-evidence', 'run.log'), 'test logs\n');

    // 3. test-results/
    mkdirSync(join(fixture.checkout, 'test-results'), { recursive: true });
    writeFileSync(join(fixture.checkout, 'test-results', 'junit.xml'), '<results/>\n');

    // 4. __pycache__/ (both untracked and nested)
    mkdirSync(join(fixture.checkout, 'ops', 'julia-runner', '__pycache__'), { recursive: true });
    writeFileSync(join(fixture.checkout, 'ops', 'julia-runner', '__pycache__', 'runner.pyc'), 'binary cache\n');

    // All four folders present with files, none are tracked. Sandbox must be eligible.
    const result = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(result.decision, 'eligible');

    // When retired with allowDelete: true, session root is completely removed.
    const retirement = retireSandbox({
      sessionId: 'session-123',
      sandboxRoot: fixture.root,
      sessionRoot: fixture.sessionRoot,
      inspection: inspectionWithoutIdle(),
      allowDelete: true,
    });
    assert.equal(retirement.decision, 'delete');
    assert.equal(existsSync(fixture.sessionRoot), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a changed tracked file inside .artifacts/ still keeps the sandbox (e0652dbb case)', () => {
  const fixture = setupRepository();
  const planPath = join(fixture.checkout, '.artifacts', 'plans', 'issue-136.md');
  try {
    mkdirSync(join(fixture.checkout, '.artifacts', 'plans'), { recursive: true });
    writeFileSync(planPath, '# Issue 136 Plan\nInitial tracked version\n');
    git(fixture.checkout, 'add', '.artifacts/plans/issue-136.md');
    git(fixture.checkout, 'commit', '-m', 'track issue-136 plan');
    git(fixture.checkout, 'push', 'origin', 'main');

    // Modify the tracked file
    writeFileSync(planPath, '# Issue 136 Plan\nModified version\n');
    const modifiedResult = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(modifiedResult.decision, 'keep');
    assert.equal(modifiedResult.gate, 'clean-git');
    assert.match(modifiedResult.reason, /changed tracked file.*issue-136\.md/);

    // Staged deletion of the tracked file (as in e0652dbb)
    git(fixture.checkout, 'rm', '-f', '.artifacts/plans/issue-136.md');
    const deletedResult = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(deletedResult.decision, 'keep');
    assert.equal(deletedResult.gate, 'clean-git');
    assert.match(deletedResult.reason, /changed tracked file.*issue-136\.md/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a local-only commit is kept even when the sandbox has a real origin remote', () => {
  const fixture = setupRepository();
  try {
    writeFileSync(join(fixture.checkout, 'only-local.txt'), 'not pushed\n');
    git(fixture.checkout, 'add', '.');
    git(fixture.checkout, 'commit', '-m', 'local only');
    const result = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(result.gate, 'recoverable-content');
    assert.match(result.reason, /does not appear in origin\/main history/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a squash-merged local commit is eligible when every changed file matches origin/main', () => {
  const fixture = setupRepository();
  const mergeCheckout = join(fixture.root, 'squash-merge');
  try {
    writeFileSync(join(fixture.checkout, 'squashed.txt'), 'same content\n');
    git(fixture.checkout, 'add', '.');
    git(fixture.checkout, 'commit', '-m', 'local branch commit');

    git(fixture.root, 'clone', fixture.remote, mergeCheckout);
    git(mergeCheckout, 'config', 'user.email', 'test@example.com');
    git(mergeCheckout, 'config', 'user.name', 'Test');
    writeFileSync(join(mergeCheckout, 'squashed.txt'), 'same content\n');
    git(mergeCheckout, 'add', '.');
    git(mergeCheckout, 'commit', '-m', 'squash merge');
    git(mergeCheckout, 'push', 'origin', 'main');

    // No manual fetch: the merge landed after the sandbox's last fetch.
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).decision, 'eligible');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a squash-merged file remains eligible after main changes that path again', () => {
  const fixture = setupRepository();
  const mergeCheckout = join(fixture.root, 'squash-merge');
  try {
    writeFileSync(join(fixture.checkout, 'squashed.txt'), 'saved content\n');
    git(fixture.checkout, 'add', 'squashed.txt');
    git(fixture.checkout, 'commit', '-m', 'local branch commit');

    git(fixture.root, 'clone', fixture.remote, mergeCheckout);
    git(mergeCheckout, 'config', 'user.email', 'test@example.com');
    git(mergeCheckout, 'config', 'user.name', 'Test');
    writeFileSync(join(mergeCheckout, 'squashed.txt'), 'saved content\n');
    git(mergeCheckout, 'add', 'squashed.txt');
    git(mergeCheckout, 'commit', '-m', 'squash merge');
    writeFileSync(join(mergeCheckout, 'squashed.txt'), 'later main content\n');
    git(mergeCheckout, 'add', 'squashed.txt');
    git(mergeCheckout, 'commit', '-m', 'later main change');
    git(mergeCheckout, 'push', 'origin', 'main');

    const result = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(result.decision, 'eligible');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a file content that never appeared in main history is kept', () => {
  const fixture = setupRepository();
  const mergeCheckout = join(fixture.root, 'main-change');
  try {
    writeFileSync(join(fixture.checkout, 'unmerged.txt'), 'local-only content\n');
    git(fixture.checkout, 'add', 'unmerged.txt');
    git(fixture.checkout, 'commit', '-m', 'local-only content');

    git(fixture.root, 'clone', fixture.remote, mergeCheckout);
    git(mergeCheckout, 'config', 'user.email', 'test@example.com');
    git(mergeCheckout, 'config', 'user.name', 'Test');
    writeFileSync(join(mergeCheckout, 'unmerged.txt'), 'different main content\n');
    git(mergeCheckout, 'add', 'unmerged.txt');
    git(mergeCheckout, 'commit', '-m', 'different main content');
    git(mergeCheckout, 'push', 'origin', 'main');

    const result = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(result.decision, 'keep');
    assert.equal(result.gate, 'recoverable-content');
    assert.match(result.reason, /does not appear in origin\/main history/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a deletion is eligible when main history contains the same deletion', () => {
  const fixture = setupRepository();
  const mergeCheckout = join(fixture.root, 'main-deletion');
  try {
    writeFileSync(join(fixture.checkout, 'deleted.txt'), 'remove me\n');
    git(fixture.checkout, 'add', 'deleted.txt');
    git(fixture.checkout, 'commit', '-m', 'add deletable file');
    git(fixture.checkout, 'push', 'origin', 'main');

    git(fixture.checkout, 'rm', 'deleted.txt');
    git(fixture.checkout, 'commit', '-m', 'local deletion');

    git(fixture.root, 'clone', fixture.remote, mergeCheckout);
    git(mergeCheckout, 'config', 'user.email', 'test@example.com');
    git(mergeCheckout, 'config', 'user.name', 'Test');
    git(mergeCheckout, 'rm', 'deleted.txt');
    git(mergeCheckout, 'commit', '-m', 'main deletion');
    git(mergeCheckout, 'push', 'origin', 'main');

    const result = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(result.decision, 'eligible');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('an outside symlink and a non-child session root are both kept', () => {
  const fixture = setupRepository();
  const outside = join(fixture.root, 'outside.txt');
  const nonChild = join(fixture.root, 'nested', 'session-456');
  try {
    writeFileSync(outside, 'outside\n');
    symlinkSync(outside, join(fixture.checkout, 'outside-link'), 'file');
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).gate, 'clean-git');

    mkdirSync(nonChild, { recursive: true });
    const result = assessSandbox({ sessionId: 'session-456', sandboxRoot: fixture.root, sessionRoot: nonChild, inspection: inspectionWithoutIdle() });
    assert.equal(result.gate, 'target');
    assert.match(result.reason, /immediate child/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('real open-file and cwd processes in the session root keep the sandbox', async (t) => {
  if (process.platform !== 'linux') return t.skip('/proc inspection is a Linux server check');
  const fixture = setupRepository();
  const openFile = join(fixture.sessionRoot, 'open.txt');
  writeFileSync(openFile, 'open\n');
  const openChild = spawn(process.execPath, ['-e', 'const fs=require("fs"); fs.openSync(process.argv[1], "r"); process.stdout.write("ready"); setInterval(()=>{}, 1000)', openFile], { cwd: tmpdir() });
  let cwdChild;
  try {
    await new Promise((resolvePromise, reject) => {
      openChild.once('error', reject);
      openChild.stdout.once('data', resolvePromise);
    });
    const openResult = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot });
    assert.equal(openResult.gate, 'idle');
    assert.match(openResult.reason, /open file/);
    openChild.kill();

    cwdChild = spawn(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(()=>{}, 1000)'], { cwd: fixture.sessionRoot });
    await new Promise((resolvePromise, reject) => {
      cwdChild.once('error', reject);
      cwdChild.stdout.once('data', resolvePromise);
    });
    const cwdResult = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot });
    assert.equal(cwdResult.gate, 'idle');
    assert.match(cwdResult.reason, /runs in the session root/);
  } finally {
    openChild.kill();
    cwdChild?.kill();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('an activity that starts during the final Git check is caught by the last-moment idle recheck', () => {
  const fixture = setupRepository({ nested: false });
  const events = [];
  let openedAfterIdle = false;
  let gitRuns = 0;
  let removeCalls = 0;
  try {
    const result = retireSandbox({
      sessionId: 'session-123',
      sandboxRoot: fixture.root,
      sessionRoot: fixture.sessionRoot,
      inspection: {
        target: () => ({ ok: true }),
        idle: () => openedAfterIdle ? ({ ok: false, reason: 'a process opened after the Git check began' }) : ({ ok: true }),
        git: () => { gitRuns += 1; if (gitRuns === 2) openedAfterIdle = true; return { ok: true }; },
        recoverable: () => ({ ok: true }),
      },
      allowDelete: true,
      remove: () => { removeCalls += 1; },
      log: event => events.push(event),
    });
    assert.equal(result.decision, 'keep');
    assert.equal(existsSync(fixture.sessionRoot), true);
    assert.equal(removeCalls, 0);
    assert.match(result.reason, /opened after/);
    assert.deepEqual(events, [result]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a clean eligible root is removed whole when deletion is explicitly enabled', () => {
  const fixture = setupRepository({ nested: false });
  try {
    const result = retireSandbox({
      sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot,
      inspection: { target: () => ({ ok: true }), idle: () => ({ ok: true }), git: () => ({ ok: true }), recoverable: () => ({ ok: true }) },
      allowDelete: true,
    });
    assert.equal(result.decision, 'delete');
    assert.equal(existsSync(fixture.sessionRoot), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a filesystem refusal to remove an eligible root is logged as a keep', (t) => {
  if (process.platform !== 'linux' || process.getuid?.() === 0) return t.skip('permission-denial fixture requires a non-root Linux account');
  const fixture = setupRepository({ nested: false });
  try {
    chmodSync(fixture.root, 0o500);
    const result = retireSandbox({
      sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot,
      inspection: { target: () => ({ ok: true }), idle: () => ({ ok: true }), git: () => ({ ok: true }), recoverable: () => ({ ok: true }) },
      allowDelete: true,
    });
    assert.equal(result.decision, 'keep');
    assert.equal(existsSync(fixture.sessionRoot), true);
    assert.match(result.reason, /could not remove/);
  } finally {
    chmodSync(fixture.root, 0o700);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a failed fetch keeps the sandbox', () => {
  const fixture = setupRepository();
  try {
    git(fixture.checkout, 'config', `url.${join(fixture.root, 'missing.git')}.insteadOf`, 'https://github.com/example/julia-next.git');
    git(fixture.checkout, 'config', '--unset', `url.${fixture.remote}.insteadOf`);
    const result = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(result.gate, 'recoverable-content');
    assert.match(result.reason, /cannot prove recoverable content/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a commit on a GitHub branch is eligible despite a narrow fetch rule', () => {
  const fixture = setupRepository();
  try {
    git(fixture.checkout, 'checkout', '-b', 'card-branch');
    writeFileSync(join(fixture.checkout, 'card.txt'), 'saved on GitHub branch\n');
    git(fixture.checkout, 'add', 'card.txt');
    git(fixture.checkout, 'commit', '-m', 'card work');
    git(fixture.checkout, 'push', fixture.remote, 'card-branch');
    git(fixture.checkout, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
    git(fixture.checkout, 'fetch', 'origin');

    const result = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(result.decision, 'eligible');
    assert.equal(git(fixture.checkout, 'config', '--get', 'remote.origin.fetch').trim(), '+refs/heads/main:refs/remotes/origin/main');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a commit on a remote branch that GitHub has since deleted is kept', () => {
  const fixture = setupRepository();
  try {
    git(fixture.checkout, 'checkout', '-b', 'card-branch');
    writeFileSync(join(fixture.checkout, 'card.txt'), 'only on the deleted branch\n');
    git(fixture.checkout, 'add', '.');
    git(fixture.checkout, 'commit', '-m', 'card work');
    git(fixture.checkout, 'push', fixture.remote, 'card-branch');
    git(fixture.checkout, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
    git(fixture.checkout, 'fetch', 'origin');
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).decision, 'eligible');
    git(fixture.root, '--git-dir', fixture.remote, 'branch', '-D', 'card-branch');
    const result = assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() });
    assert.equal(result.gate, 'recoverable-content');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('findDueSessions filters kept sessions by retryAt timestamp against log', () => {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-due-'));
  const session1 = join(root, 'session-1');
  const session2 = join(root, 'session-2');
  const logFile = join(root, 'cleanup.ndjson');
  mkdirSync(session1);
  mkdirSync(session2);
  try {
    const past = new Date(Date.now() - 10000).toISOString();
    const future = new Date(Date.now() + 60000).toISOString();
    writeFileSync(logFile, `${JSON.stringify({ sessionId: 'session-1', decision: 'keep', retryAt: past })}\n${JSON.stringify({ sessionId: 'session-2', decision: 'keep', retryAt: future })}\n`);
    const due = findDueSessions({ sandboxRoot: root, logPath: logFile });
    assert.deepEqual(due.map(s => s.sessionId), ['session-1']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
