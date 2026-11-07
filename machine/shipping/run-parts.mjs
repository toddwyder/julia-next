// The parts of a run that both runners need: the checkout of a pull request's
// head, the trace file name for one review, the guard that stops a rerun from
// posting twice, and the `gh` comment. They live apart from `run.mjs` so the
// remediation runner can check out and comment the same way without starting
// the shipping run.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, '../..');

export function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function prepareCheckout(pr, runDir, checkout) {
  git(['fetch', '--no-tags', '--quiet', 'origin', `pull/${pr}/head`]);
  const sha = git(['rev-parse', 'FETCH_HEAD^{commit}']);
  try {
    git(['worktree', 'remove', '--force', checkout]);
  } catch {
    // No worktree there yet; the add below fails loudly if something else is.
  }
  try {
    git(['worktree', 'prune']);
  } catch {
    // Prune is tidiness; a stale registration fails the add with a clear message.
  }
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.dirname(checkout), { recursive: true });
  git(['worktree', 'add', '--detach', '--quiet', checkout, sha]);
  return sha;
}

export function traceFileFor(pr, label = 'shipping') {
  const dir = process.env.JULIA_TRACES_DIR || path.join(os.homedir(), '.local', 'share', 'mastracode', 'traces');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${stamp}-${process.pid}-${label}-pr-${pr}.duckdb`);
}

// A posting step reads the saved result first: a run that reached the pull request
// and then died must not comment a second time when it is started again.
export function savedPosting(runDir, pr, sha, card) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(runDir, 'record.json'), 'utf8'));
    if (saved.pr !== pr || saved.sha !== sha || saved.card?.identifier !== card) return null;
    return saved.posted?.url ? saved : null;
  } catch {
    return null;
  }
}

export function postComment(pr, bodyFile) {
  const url = execFileSync('gh', ['pr', 'comment', String(pr), '--body-file', bodyFile], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return url.split(/\s+/).find(part => part.startsWith('http')) ?? url;
}
