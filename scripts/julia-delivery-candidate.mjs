// Git preparation and candidate capture for the existing delivery controller.
// JUL-122 owns pinning/red-proof/checks; delivery adds durable workspace identity
// and keeps destructive baseline checkouts away from the builder's source.
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { git, redProof, runChecks } from './julia-minimal-runner-checks.mjs';
import { pinWorktree, seamsOf, installDependencies } from './julia-minimal-runner.mjs';
import { loadText, saveJson } from './julia-delivery-state.mjs';

const PROTECTED = ['C:/Dev/julia-next', 'C:/Dev/julia-next-jul196', 'C:/Dev/julia-next-jul196-proof'];
// Resolve existing ancestors too: a not-yet-created child of a junction is
// still inside that junction's target. Case folding is Windows-only.
export function canonicalPath(path) {
  const absolute = resolve(path);
  let ancestor = absolute;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  const canonical = resolve(realpathSync.native(ancestor), relative(ancestor, absolute));
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}
const inside = (root, path) => { const suffix = relative(root, path); return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix)); };
export function assertDeliveryPath(path) {
  const canonical = canonicalPath(path);
  if (PROTECTED.some(root => inside(canonicalPath(root), canonical))) throw new Error(`protected original checkout: ${path}`);
  return canonical;
}

export async function prepareDeliveryWorkspace({ issueId, runPath, repoRoot, base, worktree, saved }) {
  const directory = dirname(resolve(runPath));
  assertDeliveryPath(directory);
  const path = assertDeliveryPath(worktree ?? join(directory, `${issueId}-worktree`));
  const repository = assertDeliveryPath(join(directory, `${issueId}-repository`));
  const intentPath = join(directory, `${issueId}-workspace.json`);
  const text = await loadText(intentPath);
  let identity = saved ?? (text ? JSON.parse(text) : null);
  if (identity) {
    if (identity.prepared !== true) throw new Error('workspace preparation was interrupted; its incomplete state is preserved for inspection');
    if (identity.path !== path) throw new Error(`this run belongs to worktree ${identity.path}, not ${path}`);
    if (saved && (!text || !isDeepStrictEqual(saved, JSON.parse(text)))) throw new Error('saved workspace identity differs from its preparation record');
    if (identity.repository !== repository || !/^[0-9a-f]{40}$/i.test(identity.startCommit ?? '') || !identity.branch) throw new Error('invalid saved workspace identity');
    if (!existsSync(path)) throw new Error('saved workspace is missing; unfinished work cannot be recreated');
    const common = canonicalPath(git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
    if (common !== canonicalPath(join(repository, '.git'))) throw new Error('workspace belongs to an unrelated Git repository');
    if (canonicalPath(git(path, 'rev-parse', '--show-toplevel')) !== path) throw new Error('workspace alias does not name its root');
    const branch = git(path, 'branch', '--show-current');
    if (branch !== identity.branch) throw new Error(`the worktree is on ${branch || 'a detached commit'}, not the run's branch ${identity.branch}`);
    if (spawnSync('git', ['-C', path, 'merge-base', '--is-ancestor', identity.startCommit, 'HEAD']).status !== 0) throw new Error('workspace no longer grows from its pinned base');
  } else {
    if (existsSync(path) || existsSync(repository)) throw new Error('refusing an existing unrelated working copy without saved workspace identity');
    const source = canonicalPath(repoRoot);
    if (inside(source, path) || inside(source, repository)) throw new Error('workspace and evidence must be outside the source checkout');
    if (git(source, 'status', '--porcelain')) throw new Error('source checkout is not clean');
    base ??= git(source, 'rev-parse', 'origin/main');
    if (!/^[0-9a-f]{40}$/i.test(base) || git(source, 'rev-parse', `${base}^{commit}`) !== base) throw new Error('base must be an exact pinned Git revision');
    const branch = `runner/card-${issueId.split('-').at(-1)}`;
    identity = { path, repository, branch, startCommit: base, source };
    // Save intent before creation. Interrupted preparation is refused on restart;
    // it never deletes an uncertain directory or treats it as a fresh run.
    await saveJson(intentPath, identity);
    await mkdir(directory, { recursive: true });
    const cloned = spawnSync('git', ['clone', '--no-hardlinks', '--no-checkout', source, repository], { encoding: 'utf8', windowsHide: true });
    if (cloned.status !== 0) throw new Error(`isolated clone failed: ${cloned.stderr || cloned.error?.message}`);
    git(repository, 'checkout', '-q', '--detach', base);
    git(repository, 'update-ref', 'refs/remotes/origin/main', base);
    const prepared = pinWorktree({ repoRoot: repository, worktree: path, branch, base, fetch: false });
    if (prepared.refusal) throw new Error(prepared.refusal);
    const install = installDependencies(path);
    await saveJson(join(directory, `${issueId}-install.json`), install);
    if (install.status !== 0) throw new Error(`pinned dependency setup failed: ${install.error ?? install.output}`);
  }
  const instructions = git(identity.repository, 'show', `${identity.startCommit}:.claude/skills/implement/SKILL.md`);
  if (identity.prepared !== true) { identity.prepared = true; await saveJson(intentPath, identity); }
  return { ok: true, worktree: identity, instructions };
}

export async function captureDeliveryCandidate({ issueId, runPath, workspace, card, test, round }) {
  const { path, repository, branch, startCommit: base } = workspace;
  const evidencePath = join(dirname(resolve(runPath)), `${issueId}-candidate-round-${round}.json`);
  const evidence = { base, round, commit: null, clean: false, checks: { pass: false }, redProof: { pass: false }, runs: [], evidencePath };
  if (await loadText(evidencePath) != null) return { ...evidence, checks: { pass: false, error: 'existing candidate evidence is preserved; interrupted capture/checks cannot be retried under stale evidence' } };

  const drift = commit => git(path, 'rev-parse', 'HEAD') !== commit || git(path, 'branch', '--show-current') !== branch || Boolean(git(path, 'status', '--porcelain'));
  try {
    await prepareDeliveryWorkspace({ issueId, runPath, repoRoot: workspace.source, worktree: path, saved: workspace });
    if (git(path, 'status', '--porcelain')) {
      // Git add -A records additions and deletions, including source evidence.
      // No new ignore rules or blanket evidence exclusions hide unfinished edits.
      git(path, 'add', '-A');
      git(path, '-c', 'user.name=Julia runner', '-c', 'user.email=runner@julia.invalid', 'commit', '-q', '-m', `runner: ${issueId} candidate round ${round}`);
    }
    const commit = git(path, 'rev-parse', 'HEAD');
    evidence.commit = commit;
    evidence.diff = git(path, 'diff', '--binary', `${base}...${commit}`);
    evidence.files = git(path, 'diff', '--name-status', `${base}...${commit}`);
    if (drift(commit)) throw new Error('candidate is dirty or drifted before checks');
    const seams = seamsOf(card.description);
    if (!seams) throw new Error('approved input has no agreed Seams test files for red proof');
    const checkPath = join(dirname(resolve(runPath)), `${issueId}-checks-${round}`);
    assertDeliveryPath(checkPath);
    // A prior interrupted checker is never force-reset. Its raw state survives;
    // uncertain checks stop instead of repairing themselves under stale evidence.
    if (existsSync(checkPath)) throw new Error('candidate checks workspace already exists; interrupted checks require inspection');
    const checkBranch = `runner/check-${issueId.split('-').at(-1)}-${round}`;
    git(repository, 'worktree', 'add', '-q', '-b', checkBranch, checkPath, commit);
    evidence.install = installDependencies(checkPath);
    if (evidence.install.status !== 0) throw new Error(`candidate dependency setup failed: ${evidence.install.error ?? evidence.install.output}`);
    const measured = async request => {
      const at = git(checkPath, 'rev-parse', 'HEAD');
      const result = await test(request);
      evidence.runs.push({ ...request, commit: at, ...result });
      await saveJson(evidencePath, evidence);
      if (!Number.isInteger(result?.status) || result.status < 0 || typeof result.output !== 'string') throw new Error('ambiguous check result');
      return result;
    };
    const reason = await redProof({ worktree: checkPath, branch: checkBranch, base, sha: commit, seams, test: measured });
    evidence.redProof = { pass: reason === null, reason };
    if (reason) throw new Error(reason);
    evidence.checks = await runChecks({ worktree: checkPath, branch: checkBranch, base, test: measured, strict: true });
    if (drift(commit) || git(checkPath, 'rev-parse', 'HEAD') !== commit || git(checkPath, 'status', '--porcelain')) throw new Error('candidate drifted during checks');
    evidence.clean = true;
  } catch (error) {
    evidence.clean = false;
    evidence.checks = { pass: false, error: error.message };
  }
  await saveJson(evidencePath, evidence);
  return evidence;
}
