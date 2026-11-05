// The three agent stages, as plain @mastra/core agents. The build stage is a
// real agent with the repository's own skills and a shell, so it can read the
// card, write the change and open the pull request. The other three do a
// glance-sized job and return text; none of them decides a verdict, a landing,
// Todd's answer or a retro post. Those are fixed rules in steps.mjs.

import { Agent } from '@mastra/core/agent';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { buildModel } from './models.mjs';
import { FREE_MODEL } from './schema.mjs';

export const BUILD_INSTRUCTIONS = [
  'You build one card of the Julia project, inside the machine that runs this repository.',
  'The prompt names the card and its kind.',
  'Read .agents/skills/poteto-mode/SKILL.md first and follow it as written.',
  "Read the whole card in Linear, including Todd's dated decisions on it, and move it to Implementation when you start.",
  'Open the pull request in the same step as your first push, name only this card in its description, and keep pushing as you go.',
  'When the build is ready and the pull request is up to date, stop. Shipping comes next, not you.',
  'Only a product decision or one approval in Todd\'s own account may reach him; decide everything else and log it in the decision log.',
  'You can run shell commands in the repository and use its scripts. Do the work instead of describing it.',
  'Reply with a short plain-English account of what you built and the pull request number.',
].join('\n');

export function repoRoot() {
  return process.env.FLOW_REPO ?? process.cwd();
}

export function createAgents({ model = FREE_MODEL, repo = repoRoot() } = {}) {
  const build = new Agent({
    id: 'flow-build',
    name: 'Flow build',
    instructions: BUILD_INSTRUCTIONS,
    model: buildModel(),
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
