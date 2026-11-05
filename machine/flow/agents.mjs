import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { buildModel } from './models.mjs';
import { FREE_MODEL } from './schema.mjs';

const POTETO_SKILL = '.agents/skills/poteto-mode/SKILL.md';

function repositoryContaining(directory) {
  if (existsSync(join(directory, POTETO_SKILL))) return directory;
  const parent = dirname(directory);
  if (parent === directory) throw new Error('Cannot find the repository poteto-mode skill. Set FLOW_REPO to the repository root.');
  return repositoryContaining(parent);
}

export function repoRoot() {
  return process.env.FLOW_REPO ?? repositoryContaining(resolve(process.env.MASTRA_PROJECT_ROOT ?? process.cwd()));
}

export function createAgents({ model = FREE_MODEL, repo = repoRoot(), leadModelFile } = {}) {
  const build = new Agent({
    id: 'flow-build',
    name: 'Lead',
    instructions: readFileSync(join(repo, POTETO_SKILL), 'utf8'),
    model: buildModel(leadModelFile),
    workspace: new Workspace({
      id: 'machine-repo',
      filesystem: new LocalFilesystem({ basePath: repo }),
      sandbox: new LocalSandbox({ workingDirectory: repo }),
      skills: ['.agents/skills'],
    }),
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
