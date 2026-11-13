import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SCRATCH = join(homedir(), '.local/state/julia-scratch');

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const name = card => card.replace(/[^\w.-]+/g, '-');
const branch = card => `card/${name(card)}`;
const baseRef = card => `refs/card-base/${name(card)}`;

export function copiesRoot(env = process.env) {
  return join(env.FLOW_SCRATCH ?? SCRATCH, 'cards');
}

export function copyFolder(card, env = process.env) {
  return join(copiesRoot(env), name(card));
}

export function startedFrom(repo) {
  try {
    git(repo, ['fetch', '--no-tags', '--quiet', 'origin', 'main']);
  } catch {
  }
  for (const ref of ['origin/main', 'refs/heads/main']) {
    try {
      return git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]);
    } catch {
    }
  }
  throw new Error(`${repo} has no main branch to make a card's copy from.`);
}

function linkModules(repo, folder) {
  for (const tree of ['', 'dashboard']) {
    const lock = join(tree, 'package-lock.json');
    const modules = join(repo, tree, 'node_modules');
    const sameLock = existsSync(join(repo, lock)) && existsSync(join(folder, lock)) &&
      readFileSync(join(repo, lock)).equals(readFileSync(join(folder, lock)));
    if (sameLock && existsSync(join(modules, '.package-lock.json'))) {
      rmSync(join(folder, tree, 'node_modules'), { recursive: true, force: true });
      execFileSync('cp', ['-al', modules, join(folder, tree, 'node_modules')]);
    }
  }
}

function baseOf(repo, card) {
  try {
    return git(repo, ['rev-parse', '--verify', `${baseRef(card)}^{commit}`]);
  } catch {
    return '';
  }
}

export function openCopy({ repo, card, env = process.env }) {
  const folder = copyFolder(card, env);
  if (existsSync(folder)) {
    const base = baseOf(repo, card);
    if (base) return { folder, base, fresh: false };
  }
  closeCopy({ repo, card, env });

  const base = startedFrom(repo);
  mkdirSync(copiesRoot(env), { recursive: true });
  git(repo, ['worktree', 'add', '--quiet', '--force', '-B', branch(card), folder, base]);
  git(repo, ['update-ref', baseRef(card), base]);
  linkModules(repo, folder);
  return { folder, base, fresh: true };
}

export function closeCopy({ repo, card, env = process.env }) {
  const folder = copyFolder(card, env);
  const had = existsSync(folder) || Boolean(baseOf(repo, card));
  rmSync(folder, { recursive: true, force: true });
  try {
    git(repo, ['worktree', 'prune']);
    git(repo, ['update-ref', '-d', baseRef(card)]);
  } catch {
  }
  return had;
}
