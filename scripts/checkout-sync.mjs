#!/usr/bin/env node
// checkout-sync.mjs -- keeps julia-next's two server checkouts current with
// origin/main. Replaces /usr/local/sbin/julia-next-checkout-sync.sh, which
// was root-owned, untracked, and had a real bug (JUL-44 preflight,
// 2026-09-18): its runner leg ran `git merge --ff-only origin/main` on
// whatever branch happened to be checked out. When that branch already
// equalled origin/main (a leftover feature-branch checkout), the merge
// succeeded vacuously against the checked-out branch and never advanced
// the `main` ref itself -- exit 0, the sync timer reported success, and
// `main` silently sat 8 commits stale. `orca worktree create --base-branch
// main` reads that ref directly, so every builder worktree forked from it
// in the meantime would have been missing recent work with no error at
// dispatch time.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export async function currentBranch({ cwd, execImpl = execFileAsync }) {
  const { stdout } = await execImpl('git', ['-C', cwd, 'symbolic-ref', '--short', 'HEAD']);
  return stdout.trim();
}

// The fix: never assume `merge --ff-only` on the checked-out branch also
// moves `main`. Only take that path when `main` genuinely is the checked-out
// branch. Otherwise -- any other branch, or detached HEAD -- fetch straight
// into the local `main` ref (`origin/main:main`), which git allows and
// applies unconditionally precisely because `main` is not the branch
// currently checked out here.
export async function advanceMainRef({ cwd, execImpl = execFileAsync }) {
  const branch = await currentBranch({ cwd, execImpl }).catch(() => null);
  if (branch === 'main') {
    await execImpl('git', ['-C', cwd, 'fetch', 'origin', 'main']);
    await execImpl('git', ['-C', cwd, 'merge', '--ff-only', 'origin/main']);
  } else {
    await execImpl('git', ['-C', cwd, 'fetch', 'origin', 'main:main']);
  }
  const { stdout } = await execImpl('git', ['-C', cwd, 'rev-parse', 'main']);
  return stdout.trim();
}

function defaultChmodTree(dir, { dirMode, fileMode }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      chmodSync(path, dirMode);
      defaultChmodTree(path, { dirMode, fileMode });
    } else if (entry.isFile()) {
      chmodSync(path, fileMode);
    }
  }
  chmodSync(dir, dirMode);
}

// Unchanged from the original script: reset --hard is always safe here
// because this checkout is never committed to directly (root-owned,
// read-only to orchestrator-svc) -- there is no local divergence to lose,
// unlike the runner checkout above.
export async function resetOrchestratorCheckout({
  cwd, execImpl = execFileAsync, chmodTreeImpl = (dir) => defaultChmodTree(dir, { dirMode: 0o550, fileMode: 0o440 }),
}) {
  await execImpl('git', ['-C', cwd, 'fetch', 'origin', 'main']);
  await execImpl('git', ['-C', cwd, 'reset', '--hard', 'origin/main']);
  await execImpl('chown', ['-R', 'root:orchestrator-svc', cwd]);
  await chmodTreeImpl(cwd, { dirMode: '0550', fileMode: '0440' });
}

const ORCHESTRATOR_CHECKOUT = '/srv/orchestrator-svc/julia-next';
const RUNNER_CHECKOUT = '/home/runner/julia-next';
const DEPLOY_KEY = '/etc/orca-runner/julia-next-deploy-key';

function runnerExecImpl(cmd, args) {
  return execFileAsync('sudo', ['-u', 'runner', 'env', `GIT_SSH_COMMAND=ssh -i ${DEPLOY_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`, cmd, ...args]);
}

async function main() {
  process.env.GIT_SSH_COMMAND = `ssh -i ${DEPLOY_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
  await resetOrchestratorCheckout({ cwd: ORCHESTRATOR_CHECKOUT });
  console.log(`orchestrator checkout synced to ${(await execFileAsync('git', ['-C', ORCHESTRATOR_CHECKOUT, 'rev-parse', '--short', 'HEAD'])).stdout.trim()}`);

  const head = await advanceMainRef({ cwd: RUNNER_CHECKOUT, execImpl: runnerExecImpl });
  console.log(`runner checkout's main ref synced to ${head.slice(0, 7)}`);
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
