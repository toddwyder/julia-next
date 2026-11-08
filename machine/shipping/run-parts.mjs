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

export function git(args, root = repoRoot) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function prepareCheckout(pr, runDir, checkout, { root = repoRoot } = {}) {
  git(['fetch', '--no-tags', '--quiet', 'origin', `pull/${pr}/head`], root);
  const sha = git(['rev-parse', 'FETCH_HEAD^{commit}'], root);
  try {
    git(['worktree', 'remove', '--force', checkout], root);
  } catch {
    // No worktree there yet; the add below fails loudly if something else is.
  }
  try {
    git(['worktree', 'prune'], root);
  } catch {
    // Prune is tidiness; a stale registration fails the add with a clear message.
  }
  // A directory whose registration was already pruned survives both calls above,
  // and `git worktree add` then refuses because the path exists. The path is the
  // machine's own scratch checkout for one pull request, so what is there is a
  // leftover of an earlier review, never work to keep.
  fs.rmSync(checkout, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.dirname(checkout), { recursive: true });
  git(['worktree', 'add', '--detach', '--quiet', checkout, sha], root);
  return sha;
}

// A review runs the card's checks, and those need the dev dependencies. Install
// the root and dashboard trees one after the other, never together: two npm ci
// runs at once took 3.4 GB on this 7.6 GB server and the kernel killed Studio.
// A tree installed from the same lockfile is reused.
const INSTALL_TREES = ['', 'dashboard'];

function sameContents(left, right) {
  try {
    return fs.readFileSync(left).equals(fs.readFileSync(right));
  } catch {
    return false;
  }
}

function removeTree(target) {
  try {
    if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
    else fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Nothing installed yet.
  }
}

export function prepareDependencies(checkout, { log = () => {}, timeoutMs = 15 * 60_000, mainRoot = repoRoot } = {}) {
  for (const relative of INSTALL_TREES) {
    const cwd = path.join(checkout, relative);
    const lock = path.join(cwd, 'package-lock.json');
    const nodeModules = path.join(cwd, 'node_modules');
    const marker = path.join(nodeModules, '.package-lock.json');
    if (!fs.existsSync(lock)) continue;

    // A pull request that does not change the lockfile can use the tree already
    // installed in the main checkout, so the review starts without an install.
    const mainModules = path.join(mainRoot, relative, 'node_modules');
    if (
      sameContents(lock, path.join(mainRoot, relative, 'package-lock.json')) &&
      fs.existsSync(path.join(mainModules, '.package-lock.json'))
    ) {
      removeTree(nodeModules);
      // A hardlink clone is a real directory, so Next's Turbopack accepts it;
      // a symlink to an external tree is rejected as an invalid external path.
      execFileSync('cp', ['-al', mainModules, nodeModules]);
      log(`Cloned ${relative || 'root'} dependencies from the main checkout; the lockfile matches.`);
      continue;
    }

    try {
      if (fs.statSync(marker).mtimeMs >= fs.statSync(lock).mtimeMs) continue;
    } catch {
      // No installed tree yet; install it.
    }
    log(`Installing ${relative || 'root'} dependencies once, with dev dependencies.`);
    execFileSync('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], {
      cwd,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        npm_config_omit: '',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=2048'].filter(Boolean).join(' '),
      },
      timeout: timeoutMs,
    });
  }
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
