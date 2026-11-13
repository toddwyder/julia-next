// The memory note-takers. Both run on the free model the card picked when it started, so a card's
// memory adds $0 to its total and its calls still show in the total under that model's name.
//
// Mastra's own defaults apply to both note-takers: eight retries after a failed call and Mastra's
// 100,000-token answer limit. The machine sets neither.

import { ModelRouterLanguageModel } from '@mastra/core/llm';
import { Memory } from '@mastra/memory';

import { agentModel } from './role-models.mjs';
import { meteredModel, splitModelId } from './spending.mjs';

// An account model comes back as a provider call, one on the raw-id route comes back as its id.
const languageModel = id => {
  const model = agentModel(id);
  return typeof model === 'string' ? new ModelRouterLanguageModel(model) : model;
};

export function cardMemory(spending) {
  let chosen = null;
  const model = () => {
    if (chosen) return chosen;
    const id = spending.memoryModel;
    if (!id) return null;
    chosen = meteredModel(languageModel(id), { spending, agent: 'memory', ...splitModelId(id) });
    return chosen;
  };
  if (!model()) return {};
  return { memory: new Memory({ options: { observationalMemory: {
    observation: { model },
    reflection: { model },
  } } }) };
}
