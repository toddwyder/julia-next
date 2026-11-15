import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { createCodingAgent } from '@mastra/core/coding-agent';
import { CyberRefusalHandler, TokenCostControl } from '@mastra/core/processors';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { cardMemory } from './memory.mjs';
import { buildModelReader, leadModelId } from './models.mjs';
import { createChoosePlaybookTool } from './playbook.mjs';
import { SHIPPING_MAX_STEPS } from './review.mjs';
import { agentModel, helperKey, readRoleModels, readStageModels } from './role-models.mjs';

// Mastra's own cost guard stops a card once its resource-scoped estimated cost passes this
// many dollars. Lead, helpers, memory, and stage agents all share the card as their resource.
export const COST_LIMIT_DOLLARS = 4;

const HELPER_CONCURRENCY = 4;
const POTETO_SKILL = '.agents/skills/poteto-mode/SKILL.md';

const resolveCostLimit = override => {
  if (Number.isFinite(Number(override)) && Number(override) > 0) return Number(override);
  const fromEnv = Number(process.env.FLOW_CARD_LIMIT_DOLLARS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : COST_LIMIT_DOLLARS;
};

const cardCostControl = maxCost =>
  new TokenCostControl({ maxCost, scope: 'resource', window: '30d', includeBreakdown: true });

function repositoryContaining(directory) {
  if (existsSync(join(directory, POTETO_SKILL))) return directory;
  const parent = dirname(directory);
  if (parent === directory) throw new Error('Cannot find the repository poteto-mode skill. Set FLOW_REPO to the repository root.');
  return repositoryContaining(parent);
}

export function repoRoot() {
  return process.env.FLOW_REPO ?? repositoryContaining(resolve(process.env.MASTRA_PROJECT_ROOT ?? process.cwd()));
}

export function createAgents({ model, leadModel, helperModel, costLimit, repo = repoRoot(), leadModelFile, roleModelsFile, tools = {} } = {}) {
  if (!model && !leadModel) leadModelId(leadModelFile);
  const limit = resolveCostLimit(costLimit);
  const stages = model
    ? { shipping: model, remediation: model, retro: model, memory: typeof model === 'string' ? model : null }
    : readStageModels(roleModelsFile);
  const stageModel = id => (model ? model : agentModel(stages[id]));
  const memoryModelId = () => (model ? (typeof model === 'string' ? model : null) : readStageModels(roleModelsFile).memory);

  const cardProcessors = () => ({ inputProcessors: [cardCostControl(limit)], outputProcessors: [] });
  const codingProcessors = () => ({
    inputProcessors: [cardCostControl(limit)],
    outputProcessors: [new CyberRefusalHandler()],
  });

  const playbookGuard = () => {
    let chosen = null;
    let currentStep = 0;
    let remindedAtStep = null;
    let invalidAttempt = '';
    return {
      id: 'playbook-guard',
      onChosen: ({ playbook, requestContext }) => {
        chosen = { playbook, callNumber: currentStep + 1 };
        requestContext?.set?.('flowPlaybook', chosen);
      },
      onInvalid: ({ playbook }) => {
        invalidAttempt = String(playbook ?? '');
      },
      processInputStep: async ({ stepNumber = 0, requestContext, messageList, abort }) => {
        currentStep = stepNumber;
        if (stepNumber === 0) {
          chosen = null;
          remindedAtStep = null;
          invalidAttempt = '';
          return;
        }
        if (chosen) {
          requestContext?.set?.('flowPlaybook', chosen);
          return;
        }
        if (remindedAtStep === null) {
          remindedAtStep = stepNumber;
          const badNote = invalidAttempt ? ` "${invalidAttempt}" is not a poteto-mode playbook.` : '';
          messageList?.add?.({
            role: 'user',
            content: `You started work without naming a valid poteto-mode playbook.${badNote} Call \`choose_playbook\` with a valid playbook from \`.agents/skills/poteto-mode/playbooks/\` now before continuing.`,
          }, 'input');
          return;
        }
        if (stepNumber >= remindedAtStep + 1) {
          const reason = invalidAttempt
            ? `Lead did not name a valid poteto-mode playbook after reminder (tried "${invalidAttempt}")`
            : 'Lead started work without naming a poteto-mode playbook (no valid choose_playbook call after reminder)';
          abort(reason, { metadata: { reason, part: 'Playbook' } });
        }
      },
    };
  };

  const cardWorkspace = (id, { readOnly = false, ...extra } = {}) => ({ requestContext } = {}) => {
    const folder = requestContext?.get?.('cardCheckout') ?? repo;
    return new Workspace({
      id,
      filesystem: new LocalFilesystem({ basePath: folder, ...(readOnly ? { readOnly: true } : {}) }),
      sandbox: new LocalSandbox({ workingDirectory: folder, env: { HOME: homedir() } }),
      ...extra,
    });
  };

  const skillInstruction = `Read ${join(repo, POTETO_SKILL)} in full, including its Principles section, before any work.`;
  const helpers = () => Object.fromEntries(readRoleModels(roleModelsFile).flatMap(role => role.models.map((modelId, index) => {
    const choice = role.models.length > 1 ? `, choice ${index + 1}` : '';
    return [helperKey(role, index), createCodingAgent({
      id: `pstack-${role.id}-${index + 1}`,
      name: role.name,
      description: `${role.name} pstack role on ${modelId}${choice}. ${role.explanation} Use this helper when delegating ${role.name} work.`,
      instructions: skillInstruction,
      model: helperModel ? (typeof helperModel === 'function' ? helperModel(role, index, modelId) : helperModel) : agentModel(modelId),
      ...codingProcessors(),
      ...cardMemory(memoryModelId),
      workspace: cardWorkspace('machine-repo-helper', { skills: ['.agents/skills'] }),
      tools,
      defaultOptions: { maxSteps: 100 },
    })];
  })));

  const leadPlaybookGuard = playbookGuard();
  const choosePlaybookTool = createChoosePlaybookTool({
    repo,
    onChosen: leadPlaybookGuard.onChosen,
    onInvalid: leadPlaybookGuard.onInvalid,
  });
  const leadProcessors = codingProcessors();
  const build = createCodingAgent({
    id: 'flow-build',
    name: 'Lead',
    instructions: readFileSync(join(repo, POTETO_SKILL), 'utf8'),
    model: leadModel ?? buildModelReader(leadModelFile),
    inputProcessors: [...leadProcessors.inputProcessors, leadPlaybookGuard],
    outputProcessors: [...leadProcessors.outputProcessors, leadPlaybookGuard],
    ...cardMemory(memoryModelId),
    workspace: cardWorkspace('machine-repo', { readOnly: true, skills: ['.agents/skills'] }),
    agents: helpers,
    tools: { ...tools, choose_playbook: choosePlaybookTool },
    defaultOptions: {
      maxSteps: 400,
      toolCallConcurrency: HELPER_CONCURRENCY,
    },
  });
  leadModelId(leadModelFile);

  const shipping = new Agent({
    id: 'flow-shipping',
    name: 'Shipping',
    instructions:
      'You are the Shipping reviewer. You did not write the code. You run what the card asks you to run inside the checkout you are given, judge each criterion from what the commands printed, and answer in the shape the task gives.',
    model: stageModel('shipping'),
    ...cardProcessors(),
    workspace: ({ requestContext } = {}) => {
      const checkout = requestContext?.get?.('cardCheckout');
      if (!checkout) throw new Error('Shipping has no checkout to review.');
      return new Workspace({
        id: 'shipping-checkout',
        filesystem: new LocalFilesystem({ basePath: checkout }),
        sandbox: new LocalSandbox({ workingDirectory: checkout, env: { HOME: homedir() } }),
      });
    },
    defaultOptions: { maxSteps: SHIPPING_MAX_STEPS },
  });

  const remediation = new Agent({
    id: 'flow-remediation',
    name: 'Flow remediation stand-in',
    instructions: 'You rewrite one short line so it reads better. Reply with the new line only. No tools.',
    model: stageModel('remediation'),
    ...cardProcessors(),
  });

  const retro = new Agent({
    id: 'flow-retro',
    name: 'Flow retro stand-in',
    instructions: 'You write one sentence about what this throwaway run did. No tools.',
    model: stageModel('retro'),
    ...cardProcessors(),
  });

  return { build, shipping, remediation, retro };
}
