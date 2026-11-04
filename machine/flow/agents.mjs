// The three agent stages, as plain @mastra/core agents. Each one does a
// glance-sized job and returns text. None of them decides a verdict, a landing,
// Todd's answer or a post: those are fixed rules in steps.mjs.

import { Agent } from '@mastra/core/agent';

import { FREE_MODEL } from './schema.mjs';

export const BUILD_TASK = 'You write one throwaway line about a made-up household recipe title. Reply with that line only.';

export function createAgents({ model = FREE_MODEL } = {}) {
  const build = new Agent({
    id: 'flow-build',
    name: 'Flow build stand-in',
    instructions: `${BUILD_TASK} No tools. One sentence, under twenty words.`,
    model,
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
