// The memory note-takers. Both run on the Memory model Todd picked in the model picker.
// Mastra's own defaults apply: eight retries after a failed call, Mastra's 100,000-token
// answer limit, and `failurePolicy: 'abort'`.

import { ModelRouterLanguageModel } from '@mastra/core/llm';
import { Memory } from '@mastra/memory';

import { agentModel } from './role-models.mjs';

const languageModel = id => {
  const model = agentModel(id);
  return typeof model === 'string' ? new ModelRouterLanguageModel(model) : model;
};

export function cardMemory(memoryModelId) {
  let chosen = null;
  const model = () => {
    if (chosen) return chosen;
    const id = typeof memoryModelId === 'function' ? memoryModelId() : memoryModelId;
    if (!id) return null;
    chosen = languageModel(id);
    return chosen;
  };
  if (!model()) return {};
  return {
    memory: new Memory({
      options: {
        observationalMemory: {
          observation: { model },
          reflection: { model },
        },
      },
    }),
  };
}
