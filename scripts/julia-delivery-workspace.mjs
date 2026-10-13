// Worktree setup helpers retained from the retired JUL-122 controller.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { git, safeWorkerEnvironment } from './julia-minimal-runner-checks.mjs';

export function pinWorktree({ repoRoot, worktree, branch, base, fetch = true }) {
  if (existsSync(worktree)) {
    const discarded = git(worktree, 'status', '--porcelain').split('\n').filter(Boolean);
    git(worktree, 'checkout', '-q', '-f', branch);
    git(worktree, 'clean', '-fdq');
    const growsFromBase = spawnSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: worktree }).status === 0;
    return { refusal: growsFromBase ? null : `the runner's branch does not grow from ${base}; pass the start commit this card began from`, discarded };
  }
  if (git(repoRoot, 'status', '--porcelain', '--untracked-files=no')) {
    return { refusal: `the checkout at ${repoRoot} has uncommitted changes to tracked files`, discarded: [] };
  }
  if (fetch) git(repoRoot, 'fetch', '-q', 'origin', 'main');
  const main = git(repoRoot, 'rev-parse', 'origin/main');
  if (git(repoRoot, 'rev-parse', '--verify', `${base}^{commit}`) !== main) {
    return { refusal: `start commit ${base} is not origin/main (${main})`, discarded: [] };
  }
  git(repoRoot, 'worktree', 'add', '-q', '-b', branch, worktree, main);
  return { refusal: null, discarded: [] };
}

export function installDependencies(worktree, progress = () => {}) {
  if (!existsSync(join(worktree, 'package-lock.json')) || existsSync(join(worktree, 'node_modules'))) return { status: 0, output: '', skipped: true };
  progress('Installing dependencies (npm ci) from the start commit');
  const result = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: worktree, encoding: 'utf8', env: safeWorkerEnvironment(), shell: process.platform === 'win32', windowsHide: true, timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, error: result.error?.message ?? null, skipped: false };
}

export function seamsOf(description) {
  const section = /^##\s+Seams\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(description ?? '')?.[1];
  const tests = [...(section ?? '').matchAll(/`([^`\s]+\.test\.mjs)`/g)].map((match) => match[1]);
  if (!tests.length) return null;
  return { tests, kind: /Kind:\s*refactor/i.test(section) ? 'refactor' : 'behavior' };
}
