import { test } from 'node:test';
import assert from 'node:assert/strict';

import { advanceMainRef, resetOrchestratorCheckout } from './checkout-sync.mjs';

function fakeExec(responses) {
  const calls = [];
  return {
    calls,
    execImpl: async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      const key = [cmd, ...args].join(' ');
      if (key in responses) return responses[key];
      throw new Error(`unexpected exec call: ${key}`);
    },
  };
}

test('advanceMainRef, HEAD on main: fetches and fast-forward merges (the already-working case)', async () => {
  const { calls, execImpl } = fakeExec({
    'git -C /repo symbolic-ref --short HEAD': { stdout: 'main\n' },
    'git -C /repo fetch origin main': { stdout: '' },
    'git -C /repo merge --ff-only origin/main': { stdout: '' },
    'git -C /repo rev-parse main': { stdout: 'newsha\n' },
  });
  const head = await advanceMainRef({ cwd: '/repo', execImpl });
  assert.equal(head, 'newsha');
  assert.deepEqual(calls, [
    'git -C /repo symbolic-ref --short HEAD',
    'git -C /repo fetch origin main',
    'git -C /repo merge --ff-only origin/main',
    'git -C /repo rev-parse main',
  ]);
});

test('advanceMainRef, HEAD on a feature branch that already equals origin/main: still advances the main ref itself (the JUL-44 preflight bug)', async () => {
  // This is the exact failure mode found live in JUL-44's 2026-09-18 14:22Z
  // preflight: the checkout's HEAD sat on `jul72-safe-secret-read`, which
  // already equalled origin/main, so a plain `git merge --ff-only
  // origin/main` on the checked-out branch succeeded vacuously and never
  // touched the `main` ref that `orca worktree create --base-branch main`
  // actually reads -- exit 0, timer reports success, `main` silently stays
  // 8 commits stale.
  const { calls, execImpl } = fakeExec({
    'git -C /repo symbolic-ref --short HEAD': { stdout: 'jul72-safe-secret-read\n' },
    'git -C /repo fetch origin main:main': { stdout: '' },
    'git -C /repo rev-parse main': { stdout: 'newsha\n' },
  });
  const head = await advanceMainRef({ cwd: '/repo', execImpl });
  assert.equal(head, 'newsha');
  // Never merges into the checked-out branch -- fetches straight into the
  // main ref, which is safe precisely because main is not checked out here.
  assert.deepEqual(calls, [
    'git -C /repo symbolic-ref --short HEAD',
    'git -C /repo fetch origin main:main',
    'git -C /repo rev-parse main',
  ]);
});

test('advanceMainRef, detached HEAD: also fetches straight into the main ref', async () => {
  const { calls, execImpl } = fakeExec({
    'git -C /repo symbolic-ref --short HEAD': Promise.reject(new Error('fatal: ref HEAD is not a symbolic ref')),
    'git -C /repo fetch origin main:main': { stdout: '' },
    'git -C /repo rev-parse main': { stdout: 'newsha\n' },
  });
  const head = await advanceMainRef({ cwd: '/repo', execImpl });
  assert.equal(head, 'newsha');
  assert.ok(!calls.includes('git -C /repo merge --ff-only origin/main'));
});

test('resetOrchestratorCheckout: fetches, hard-resets to origin/main, then re-hardens ownership/mode', async () => {
  const { calls, execImpl } = fakeExec({
    'git -C /srv fetch origin main': { stdout: '' },
    'git -C /srv reset --hard origin/main': { stdout: '' },
    'chown -R root:orchestrator-svc /srv': { stdout: '' },
  });
  await resetOrchestratorCheckout({
    cwd: '/srv',
    execImpl,
    chmodTreeImpl: async (dir, opts) => { calls.push(`chmodTree ${dir} ${JSON.stringify(opts)}`); },
  });
  assert.deepEqual(calls, [
    'git -C /srv fetch origin main',
    'git -C /srv reset --hard origin/main',
    'chown -R root:orchestrator-svc /srv',
    'chmodTree /srv {"dirMode":"0550","fileMode":"0440"}',
  ]);
});
