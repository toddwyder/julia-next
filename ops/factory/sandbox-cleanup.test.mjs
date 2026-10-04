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

import { assessSandbox, defaultInspection, retireSandbox } from './sandbox-cleanup.mjs';

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
  writeFileSync(join(checkout, '.gitignore'), 'ops/factory/app/node_modules/\n.julia/builder-evidence/\n');
  writeFileSync(join(checkout, 'package.json'), '{}\n');
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-m', 'base');
  git(checkout, 'remote', 'add', 'origin', remote);
  git(checkout, 'push', '-u', 'origin', 'main');
  git(root, '--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  // The bare repository above is a real remote for this fixture. Keep its
  // fetched origin/main ref, then present the production GitHub URL that the
  // evaluator verifies without making a network request during retirement.
  git(checkout, 'remote', 'set-url', 'origin', 'https://github.com/example/julia-next.git');
  return { root, remote, sessionRoot, checkout };
}

function inspectionWithoutIdle() {
  return { ...defaultInspection(), idle: () => ({ ok: true }) };
}

test('real Git fixtures keep changed tracked files, untracked files, and ignored logs, but allow nested dependency caches', () => {
  const fixture = setupRepository();
  try {
    writeFileSync(join(fixture.checkout, 'package.json'), '{"changed":true}\n');
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).gate, 'clean-git');
    git(fixture.checkout, 'checkout', '--', 'package.json');

    writeFileSync(join(fixture.checkout, 'unsaved.txt'), 'unsaved\n');
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).gate, 'clean-git');
    rmSync(join(fixture.checkout, 'unsaved.txt'));

    mkdirSync(join(fixture.checkout, '.julia', 'builder-evidence'), { recursive: true });
    writeFileSync(join(fixture.checkout, '.julia', 'builder-evidence', 'run.log'), 'keep me\n');
    assert.match(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).reason, /allow-list/);
    rmSync(join(fixture.checkout, '.julia'), { recursive: true });

    mkdirSync(join(fixture.checkout, 'ops', 'factory', 'app', 'node_modules'), { recursive: true });
    writeFileSync(join(fixture.checkout, 'ops', 'factory', 'app', 'node_modules', 'cache'), 'rebuildable\n');
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).decision, 'eligible');
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
    assert.match(result.reason, /differs from origin\/main/);
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

    git(fixture.checkout, 'remote', 'set-url', 'origin', fixture.remote);
    git(fixture.checkout, 'fetch', 'origin', 'main');
    git(fixture.checkout, 'remote', 'set-url', 'origin', 'https://github.com/example/julia-next.git');
    assert.equal(assessSandbox({ sessionId: 'session-123', sandboxRoot: fixture.root, sessionRoot: fixture.sessionRoot, inspection: inspectionWithoutIdle() }).decision, 'eligible');
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
