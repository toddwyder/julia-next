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
import { HELPER_CONCURRENCY, helperStartHook, openSpending, spendingProcessor, splitModelId } from './spending.mjs';

// Mastra's own cost guard stops a run once its estimated cost passes this many dollars. The scope is the
// run's trace, so the Lead, its helpers and the stage agents share one total.
export const COST_LIMIT_DOLLARS = 4;

export const costGuard = () => new TokenCostControl({ maxCost: COST_LIMIT_DOLLARS, scope: 'run' });

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

// The card's spending total is read from its own folder, so every agent in the run adds to the
// same ledger and a rerun carries the total it already spent.
export function createAgents({ model, leadModel, helperModel, repo = repoRoot(), leadModelFile, roleModelsFile, tools = {}, dir = process.env.FLOW_DIR ?? '.artifacts/flow/studio', spending } = {}) {
  if (!model && !leadModel) leadModelId(leadModelFile);
  // An explicit model is a caller's override, as in a test. Otherwise each stage takes the
  // model Todd saved for it; a missing line stops here and names that stage.
  const stages = model
    ? { shipping: model, remediation: model, retro: model, memory: typeof model === 'string' ? model : null }
    : readStageModels(roleModelsFile);
  const stageModel = id => (model ? model : agentModel(stages[id]));
  const cardSpending = spending ?? openSpending({
    dir,
    memoryModel: () => (model ? (typeof model === 'string' ? model : null) : readStageModels(roleModelsFile).memory),
  });
  // A stopped card starts no new helper. The hook runs before the helper does, and what it throws
  // comes back to the Lead as a failed tool call.
  const buildHooks = helperStartHook(cardSpending);
  // The input side stops a call the card cannot afford, and the output side adds the call's
  // dollars. Mastra runs `processOutputStep` only for output processors, so the same processor
  // goes into both lists and remembers the model the input step saw.
  const cardProcessors = (ids, options) => {
    const guard = spendingProcessor(cardSpending, ids, options);
    return { inputProcessors: [costGuard(), guard], outputProcessors: [guard] };
  };
  // `createCodingAgent` uses any output list it is given verbatim, so a coding agent must name
  // Mastra's default CyberRefusalHandler itself or lose it. A plain Agent never had that default.
  const codingProcessors = (ids, options) => {
    const processors = cardProcessors(ids, options);
    return { ...processors, outputProcessors: [new CyberRefusalHandler(), ...processors.outputProcessors] };
  };
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
          cardSpending.stop(reason, 'Playbook');
          abort(reason, { metadata: { reason, part: 'Playbook' } });
        }
      },
    };
  };
  // A run names the copy of the repository its card works in. A call outside a card, such as a
  // settings read, works in the repository Studio runs from.
  const cardWorkspace = (id, { readOnly = false, ...extra } = {}) => ({ requestContext } = {}) => {
    const folder = requestContext?.get?.('cardCheckout') ?? repo;
    return new Workspace({
      id,
      filesystem: new LocalFilesystem({ basePath: folder, ...(readOnly ? { readOnly: true } : {}) }),
      sandbox: new LocalSandbox({ workingDirectory: folder, env: { HOME: homedir() } }),
      ...extra,
    });
  };
  // Mastra resolves `agents` and `model` at each call, so the picker's file and the Lead
  // setting reach the next call without a restart. 7 Nov: the save at 15:18:07 needed the
  // restart at 15:18:10 to take effect.
  const skillInstruction = `Read ${join(repo, POTETO_SKILL)} in full, including its Principles section, before any work.`;
  const helpers = () => Object.fromEntries(readRoleModels(roleModelsFile).flatMap(role => role.models.map((modelId, index) => {
    const choice = role.models.length > 1 ? `, choice ${index + 1}` : '';
    return [helperKey(role, index), createCodingAgent({
      id: `pstack-${role.id}-${index + 1}`,
      name: role.name,
      description: `${role.name} pstack role on ${modelId}${choice}. ${role.explanation} Use this helper when delegating ${role.name} work.`,
      instructions: skillInstruction,
      model: helperModel ? (typeof helperModel === 'function' ? helperModel(role, index, modelId) : helperModel) : agentModel(modelId),
      ...codingProcessors(() => splitModelId(modelId)),
      ...cardMemory(cardSpending),
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
  const leadPlaybookNote = [
    '',
    '## Machine Playbook Tool',
    'As your first act before any other tool call, call `choose_playbook` with the name of the poteto-mode playbook for this card (for example `feature`, `bug-fix`, `investigation`, `refactoring`).',
    'The machine writes that playbook\'s steps word for word into your task list. Work through every step in order; any step you leave undone must stay in the task list with `skip: <reason>` appended to its content (via `task_update`). Add card-specific items only after the playbook steps.',
  ].join('\n');
  const leadProcessors = codingProcessors(() => splitModelId(leadModelId(leadModelFile)), { refuseAfterStop: true });
  const build = createCodingAgent({
    id: 'flow-build',
    name: 'Lead',
    instructions: `${readFileSync(join(repo, POTETO_SKILL), 'utf8')}${leadPlaybookNote}`,
    model: leadModel ?? buildModelReader(leadModelFile),
    inputProcessors: [...leadProcessors.inputProcessors, leadPlaybookGuard],
    outputProcessors: [...leadProcessors.outputProcessors, leadPlaybookGuard],
    ...cardMemory(cardSpending),
    workspace: cardWorkspace('machine-repo', { readOnly: true, skills: ['.agents/skills'] }),
    agents: helpers,
    tools: { ...tools, choose_playbook: choosePlaybookTool },
    defaultOptions: {
      maxSteps: 400,
      toolCallConcurrency: HELPER_CONCURRENCY,
      hooks: buildHooks,
    },
  });
  // The reader runs later, so check the setting now: a missing Lead model stops Studio at boot
  // and names the installer, as it did when the model was resolved here.
  leadModelId(leadModelFile);

  const shipping = new Agent({
    id: 'flow-shipping',
    name: 'Shipping',
    instructions:
      'You are the Shipping reviewer. You did not write the code. You run what the card asks you to run inside the checkout you are given, judge each criterion from what the commands printed, and answer in the shape the task gives.',
    model: stageModel('shipping'),
    ...cardProcessors(() => (model ? null : splitModelId(stages.shipping))),
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
    ...cardProcessors(() => (model ? null : splitModelId(stages.remediation))),
  });

  const retro = new Agent({
    id: 'flow-retro',
    name: 'Flow retro stand-in',
    instructions: 'You write one sentence about what this throwaway run did. No tools.',
    model: stageModel('retro'),
    ...cardProcessors(() => (model ? null : splitModelId(stages.retro))),
  });

  // A stage asks these before it calls its agent, so a card that has spent its limit or picked a
  // model the price list cannot price ends with a stop report instead of a failed model call.
  const spendingIds = {
    build: () => splitModelId(leadModelId(leadModelFile)),
    shipping: () => (model ? null : splitModelId(stages.shipping)),
    remediation: () => (model ? null : splitModelId(stages.remediation)),
    retro: () => (model ? null : splitModelId(stages.retro)),
  };

  return { build, shipping, remediation, retro, spending: cardSpending, spendingIds };
}
