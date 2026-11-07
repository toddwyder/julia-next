// Criterion 4 of JUL-310: after the retro, the card's leftovers are removed.
// Leftovers are the things this card wrote while it was being built: run
// folders under .artifacts for this pull request, branches carrying this card's
// id that main already holds, and test files in the merged change whose own
// import no longer exists. Nothing else. The planner is a pure function so the
// refusal cases are testable without a repository, and every decision it makes
// comes back with the reason it made it.

import fs from 'node:fs';
import path from 'node:path';

export const PROTECTED = [/^docs\/scorecards\//, /(^|\/)docs\/scorecards\//];

export function cardToken(card) {
  return new RegExp(`(^|[^a-z0-9])${String(card).toLowerCase().replace(/[^a-z0-9]+/g, '-')}([^0-9]|$)`, 'i');
}

export function branchBelongsToCard(name, card) {
  return cardToken(card).test(name);
}

export function relativeImports(source) {
  const found = [];
  const text = String(source);
  const patterns = [
    /\bfrom\s+['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return [...new Set(found)];
}

// A test whose module is gone is not a test of anything. The caller supplies
// the reader and the file test so this stays off the disk in a unit test.
export function deadTestFiles({ files = [], read, exists }) {
  const dead = [];
  for (const file of files) {
    let source = '';
    try {
      source = read(file);
    } catch {
      continue;
    }
    const missing = relativeImports(source).filter(spec => {
      const target = path.resolve(path.dirname(file), spec);
      return !exists(target) && !exists(`${target}.js`) && !exists(`${target}.mjs`) && !exists(`${target}.ts`) && !exists(path.join(target, 'index.js'));
    });
    if (missing.length > 0) dead.push({ path: file, missing });
  }
  return dead;
}

export function sweepPlan({
  root,
  artifacts = path.join(root, '.artifacts'),
  card,
  pr,
  branches = [],
  worktrees = [],
  runDirs = [],
  deadTests = [],
  currentBranch = 'main',
  mergedHead = null,
}) {
  const removeBranches = [];
  const keep = [];
  const noticed = [];

  for (const branch of branches) {
    const name = branch.name.replace(/^origin\//, '');
    if (!branchBelongsToCard(name, card)) continue;
    if (name === 'main' || name === 'master' || name === currentBranch) {
      keep.push({ what: `${branch.remote ? 'remote ' : ''}branch ${name}`, why: 'it is the main line' });
      continue;
    }
    if (branch.remote && branch.isDefault) {
      keep.push({ what: `remote branch ${name}`, why: 'it is the repository default' });
      continue;
    }
    const ownHead = mergedHead && branch.head && branch.head.toLowerCase() === String(mergedHead).toLowerCase();
    if (!branch.merged && !ownHead) {
      keep.push({ what: `${branch.remote ? 'remote ' : ''}branch ${name}`, why: 'main does not hold its commits, so the branch is not a leftover' });
      continue;
    }
    removeBranches.push({ name, remote: Boolean(branch.remote) });
  }

  const removeWorktrees = [];
  for (const tree of worktrees) {
    if (tree.path === root) continue;
    const inside = tree.path.startsWith(`${artifacts}${path.sep}`);
    const forThisPull = path.basename(tree.path) === `pr-${pr}` || tree.path.split(path.sep).includes(`pr-${pr}`);
    if (inside && forThisPull) {
      removeWorktrees.push(tree.path);
      continue;
    }
    if (branchBelongsToCard(tree.branch ?? '', card)) {
      noticed.push({ what: `worktree ${tree.path}`, why: `on branch ${tree.branch}, which carries the card id but lives outside the artifacts directory` });
    }
  }

  const removeDirs = [];
  for (const dir of runDirs) {
    const inside = dir === artifacts || dir.startsWith(`${artifacts}${path.sep}`);
    if (!inside) {
      noticed.push({ what: dir, why: 'outside the artifacts directory, so the machine will not remove it' });
      continue;
    }
    if (path.basename(dir) !== `pr-${pr}`) {
      noticed.push({ what: dir, why: `does not belong to pull request #${pr}` });
      continue;
    }
    removeDirs.push(dir);
  }

  const removeTests = [];
  for (const test of deadTests) {
    const relative = path.relative(root, test.path);
    if (PROTECTED.some(pattern => pattern.test(relative))) {
      noticed.push({ what: relative, why: 'a protected path was offered for removal and refused' });
      continue;
    }
    removeTests.push({ path: test.path, missing: test.missing ?? [] });
  }

  for (const entry of [...removeDirs, ...removeWorktrees, ...removeTests.map(test => test.path)]) {
    if (PROTECTED.some(pattern => pattern.test(path.relative(root, entry)))) {
      throw new Error(`sweep: refusing to remove ${entry}; the cost rows stay`);
    }
  }

  return { removeBranches, removeWorktrees, removeDirs, removeTests, keep, noticed };
}

export function sweepSummary(plan) {
  const count = plan.removeBranches.length + plan.removeWorktrees.length + plan.removeDirs.length + plan.removeTests.length;
  return `${count} leftover${count === 1 ? '' : 's'} to remove, ${plan.keep.length} kept, ${plan.noticed.length} for the noticed list.`;
}

export function runSweep({ plan, root, git, rmImpl = fs.rmSync, unlinkImpl = fs.unlinkSync, log = () => {} }) {
  const removed = [];
  const errors = [];

  for (const dir of plan.removeDirs) {
    try {
      rmImpl(dir, { recursive: true, force: true });
      removed.push({ what: dir, how: 'deleted the run folder' });
    } catch (error) {
      errors.push({ what: dir, error: error.message });
    }
  }

  for (const tree of plan.removeWorktrees) {
    try {
      try {
        git(['worktree', 'remove', '--force', tree]);
      } catch {
        rmImpl(tree, { recursive: true, force: true });
      }
      removed.push({ what: tree, how: 'removed the worktree' });
    } catch (error) {
      errors.push({ what: tree, error: error.message });
    }
  }

  try {
    git(['worktree', 'prune']);
  } catch (error) {
    errors.push({ what: 'worktree prune', error: error.message });
  }

  for (const branch of plan.removeBranches) {
    try {
      if (branch.remote) git(['push', 'origin', '--delete', branch.name]);
      else git(['branch', '-D', branch.name]);
      removed.push({ what: branch.name, how: branch.remote ? 'deleted the remote branch' : 'deleted the local branch' });
    } catch (error) {
      errors.push({ what: branch.name, error: error.message });
    }
  }

  for (const test of plan.removeTests) {
    try {
      unlinkImpl(test.path);
      removed.push({ what: test.path, how: `had no module left (${test.missing.join(', ')})` });
    } catch (error) {
      errors.push({ what: test.path, error: error.message });
    }
  }

  for (const item of removed) log(`Removed ${item.what} (${item.how}).`);
  return { removed, errors, root };
}
