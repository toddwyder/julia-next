import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { buildModel } from './models.mjs';
import { agentModel, helperKey, readRoleModels } from './role-models.mjs';
import { FREE_MODEL } from './schema.mjs';

const POTETO_SKILL = '.agents/skills/poteto-mode/SKILL.md';

// Runs keep their throwaway folders here, and a card's build worktree is one of
// them, so a build never shares a folder with the checkout Studio runs from.
const SCRATCH = join(homedir(), '.local/state/julia-scratch');

// The request context key that names the folder a run's Lead and helpers work
// in. `start-build` sets it before the Lead's first step.
export const BUILD_WORKTREE = 'build-worktree';

function repositoryContaining(directory) {
  if (existsSync(join(directory, POTETO_SKILL))) return directory;
  const parent = dirname(directory);
  if (parent === directory) throw new Error('Cannot find the repository poteto-mode skill. Set FLOW_REPO to the repository root.');
  return repositoryContaining(parent);
}

export function repoRoot() {
  return process.env.FLOW_REPO ?? repositoryContaining(resolve(process.env.MASTRA_PROJECT_ROOT ?? process.cwd()));
}

export function buildWorktreePath(card, root = SCRATCH) {
  if (typeof card !== 'string' || card === '' || card === '.' || card === '..' || /[/\\]/.test(card)) {
    throw new Error(`"${card}" is not a card name that can own a build worktree.`);
  }
  return join(root, `${card}-build`);
}

const git = (repo, args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function isWorktreeOf(repo, path) {
  return git(repo, ['worktree', 'list', '--porcelain'])
    .split('\n\n')
    .some(block => block.split('\n').includes(`worktree ${path}`));
}

// A build starts from the fetched main, so it builds what will land. A shallow
// checkout, such as CI's, has no `origin/main` ref, so it starts from the
// newest of the refs it does have.
function baseCommit(repo) {
  const refs = ['origin/main', 'main', 'HEAD'];
  for (const ref of refs) {
    try {
      return git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]);
    } catch {
      continue;
    }
  }
  throw new Error(`${repo} has no commit to start a build worktree from.`);
}

// A card builds in its own git worktree of this repository, made from
// `origin/main` the first time the card starts. A later start of a card left
// there by a crashed run reuses it, because two folders for one card would
// split its commits.
export function prepareBuildWorktree(card, { repo = repoRoot(), root = SCRATCH } = {}) {
  const path = buildWorktreePath(card, root);
  if (existsSync(path)) {
    // A folder git does not know as a worktree may hold a crashed build's
    // commits, so it is reported rather than thrown away.
    if (!isWorktreeOf(repo, path)) {
      throw new Error(`${path} is not a git worktree of ${repo}, so the build cannot start there. Move it aside and start the card again.`);
    }
    return { path, created: false };
  }
  const main = baseCommit(repo);
  mkdirSync(root, { recursive: true });
  try {
    git(repo, ['worktree', 'add', '--detach', '--quiet', path, main]);
  } catch (error) {
    // A second run that raced this one made the worktree first, so it is there to use.
    if (!isWorktreeOf(repo, path)) throw error;
    return { path, created: false };
  }
  return { path, created: true };
}

// The Lead has no second base path. A run that reaches it without a card
// worktree is a bug in the path, and refusing says so instead of letting the
// build run in the Studio folder.
function worktreeFor(requestContext) {
  const path = requestContext?.get(BUILD_WORKTREE);
  if (typeof path !== 'string' || path === '') {
    throw new Error(`This run has no build worktree, so the Lead and its helpers have nowhere to work. "${BUILD_WORKTREE}" is set by the start-build step.`);
  }
  return path;
}

function workspaceIn(id, extra = {}) {
  return new Workspace({
    id,
    filesystem: ({ requestContext }) => new LocalFilesystem({ basePath: worktreeFor(requestContext) }),
    sandbox: ({ requestContext }) => new LocalSandbox({ workingDirectory: worktreeFor(requestContext), env: { HOME: homedir() } }),
    // One sandbox per worktree, so a background command reaches the same shell as its next call.
    sandboxCacheKey: ({ requestContext }) => worktreeFor(requestContext),
    ...extra,
  });
}

export function createAgents({ model = FREE_MODEL, repo = repoRoot(), leadModelFile, roleModelsFile } = {}) {
  const workspace = workspaceIn('machine-repo', { skills: ['.agents/skills'] });
  const helperWorkspace = workspaceIn('machine-repo-helper');
  const helpers = Object.fromEntries(readRoleModels(roleModelsFile).flatMap(role => role.models.map((modelId, index) => {
    const choice = role.models.length > 1 ? `, choice ${index + 1}` : '';
    return [helperKey(role, index), new Agent({
      id: `pstack-${role.id}-${index + 1}`,
      name: role.name,
      description: `${role.name} pstack role on ${modelId}${choice}. ${role.explanation} Use this helper when delegating ${role.name} work.`,
      instructions: `You are the ${role.name} pstack helper. ${role.explanation} Complete the task delegated by Lead yourself. Do not delegate it again. Report the result and evidence.`,
      model: agentModel(modelId),
      workspace: helperWorkspace,
      defaultOptions: { maxSteps: 100 },
    })];
  })));
  const build = new Agent({
    id: 'flow-build',
    name: 'Lead',
    instructions: readFileSync(join(repo, POTETO_SKILL), 'utf8'),
    model: buildModel(leadModelFile),
    workspace,
    agents: helpers,
    defaultOptions: { maxSteps: 400 },
  });

  const shipping = new Agent({
    id: 'flow-shipping',
    name: 'Flow shipping stand-in',
    instructions:
      'You glance at one short file and say in one sentence whether it reads as a recipe title. You do not decide pass or fail; a fixed rule does that. No tools.',
    model,
  });

  const remediation = new Agent({
    id: 'flow-remediation',
    name: 'Flow remediation stand-in',
    instructions: 'You rewrite one short line so it reads better. Reply with the new line only. No tools.',
    model,
  });

  const retro = new Agent({
    id: 'flow-retro',
    name: 'Flow retro stand-in',
    instructions: 'You write one sentence about what this throwaway run did. No tools.',
    model,
  });

  return { build, shipping, remediation, retro };
}
