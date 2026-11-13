import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { TokenCostControl } from '@mastra/core/processors';
import { Memory } from '@mastra/memory';
import { createExplorationGate } from './exploration.mjs';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { buildModelReader, leadModelId } from './models.mjs';
import { agentModel, helperKey, readRoleModels, readStageModels } from './role-models.mjs';
import { meteredModel, openSpending, spendingProcessor, splitModelId } from './spending.mjs';

// Mastra caps the observer and reflector at 100,000 output tokens, but only when it picks their model.
// An explicit model gets no cap, so the controller reserved all of the remaining token cap for one memory
// call and the Lead's next call found no room (JUL-362, 11 Nov). This is Mastra's own value, set explicitly.
export const MEMORY_MAX_OUTPUT_TOKENS = 100_000;

// Mastra's own cost guard stops a run once its estimated cost passes this many dollars. The scope is the
// run's trace, so the Lead, its helpers and the stage agents share one total.
export const COST_LIMIT_DOLLARS = 4;
// Every agent answers under an output limit, so one call cannot run away.
export const AGENT_MAX_OUTPUT_TOKENS = 32_000;

const limits = { modelSettings: { maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS } };
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
export function createAgents({ model, repo = repoRoot(), leadModelFile, roleModelsFile, tools = {}, machine = false, dir = process.env.FLOW_DIR ?? '.artifacts/flow/studio', spending = openSpending({ dir }) } = {}) {
  const gate = machine ? createBuildGate({ repo }) : undefined;
  // Memory note-takers call the model themselves, outside an agent's processors, so their calls
  // are metered on the model instead.
  const memoryModel = () => meteredModel(agentModel('openai/gpt-6-luna'), { spending, ...splitModelId('openai/gpt-6-luna') });
  const memoryFor = role => {
    if (!gate) return {};
    const memory = new Memory({ options: { observationalMemory: {
      observation: { model: memoryModel(), maxRetries: 0, failurePolicy: 'abort', modelSettings: { maxOutputTokens: MEMORY_MAX_OUTPUT_TOKENS } },
      reflection: { model: memoryModel(), maxRetries: 0, failurePolicy: 'abort', modelSettings: { maxOutputTokens: MEMORY_MAX_OUTPUT_TOKENS } },
    } } });
    return { memory };
  };
  const gateOptions = gate ? { maxRetries: 0, hooks: gate.hooks } : {};
  // The input side stops a call the card cannot afford, and the output side adds the call's
  // dollars. Mastra runs `processOutputStep` only for output processors, so the same processor
  // goes into both lists and remembers the model the input step saw.
  const cardProcessors = ids => {
    const guard = spendingProcessor(spending, ids);
    return { inputProcessors: [costGuard(), guard], outputProcessors: [guard] };
  };
  const workspace = new Workspace({
    id: 'machine-repo',
    filesystem: new LocalFilesystem({ basePath: repo }),
    sandbox: new LocalSandbox({ workingDirectory: repo, env: { HOME: homedir() } }),
    skills: ['.agents/skills'],
  });
  const helperWorkspace = new Workspace({
    id: 'machine-repo-helper',
    filesystem: new LocalFilesystem({ basePath: repo }),
    sandbox: new LocalSandbox({ workingDirectory: repo, env: { HOME: homedir() } }),
  });
  // Mastra resolves `agents` and `model` at each call, so the picker's file and the Lead
  // setting reach the next call without a restart. 7 Nov: the save at 15:18:07 needed the
  // restart at 15:18:10 to take effect.
  const helpers = () => Object.fromEntries(readRoleModels(roleModelsFile).flatMap(role => role.models.map((modelId, index) => {
    const choice = role.models.length > 1 ? `, choice ${index + 1}` : '';
    return [helperKey(role, index), new Agent({
      id: `pstack-${role.id}-${index + 1}`,
      name: role.name,
      description: `${role.name} pstack role on ${modelId}${choice}. ${role.explanation} Use this helper when delegating ${role.name} work.`,
      instructions: `You are the ${role.name} pstack helper. ${role.explanation} Complete the task delegated by Lead yourself. Do not delegate it again. For questions about code structure or where something lives, call the graphify tools before reading files. Report the result and evidence.`,
      model: agentModel(modelId),
      ...cardProcessors(() => splitModelId(modelId)),
      ...memoryFor(role.name),
      workspace: helperWorkspace,
      tools,
      defaultOptions: { maxSteps: 100, ...limits, ...gateOptions },
    })];
  })));
  const build = new Agent({
    id: 'flow-build',
    name: 'Lead',
    instructions: readFileSync(join(repo, POTETO_SKILL), 'utf8'),
    model: buildModelReader(leadModelFile),
    ...cardProcessors(() => splitModelId(leadModelId(leadModelFile))),
    ...memoryFor('lead'),
    workspace,
    agents: helpers,
    tools,
    defaultOptions: { maxSteps: 400, ...limits, ...gateOptions },
  });
  // The reader runs later, so check the setting now: a missing Lead model stops Studio at boot
  // and names the installer, as it did when the model was resolved here.
  leadModelId(leadModelFile);


  // An explicit model is a caller's override, as in a test. Otherwise each stage takes the
  // model Todd saved for it; a missing line stops here and names that stage.
  const stages = model ? { shipping: model, remediation: model, retro: model } : readStageModels(roleModelsFile);
  const stageModel = id => (model ? model : agentModel(stages[id]));

  const shipping = new Agent({
    id: 'flow-shipping',
    name: 'Flow shipping stand-in',
    instructions:
      'You glance at one short file and say in one sentence whether it reads as a recipe title. You do not decide pass or fail; a fixed rule does that. No tools.',
    model: stageModel('shipping'),
    ...cardProcessors(() => (model ? null : splitModelId(stages.shipping))),
    defaultOptions: { ...limits, ...(gate ? { maxRetries: 0 } : {}) },
  });

  const remediation = new Agent({
    id: 'flow-remediation',
    name: 'Flow remediation stand-in',
    instructions: 'You rewrite one short line so it reads better. Reply with the new line only. No tools.',
    model: stageModel('remediation'),
    ...cardProcessors(() => (model ? null : splitModelId(stages.remediation))),
    defaultOptions: { ...limits, ...(gate ? { maxRetries: 0 } : {}) },
  });

  const retro = new Agent({
    id: 'flow-retro',
    name: 'Flow retro stand-in',
    instructions: 'You write one sentence about what this throwaway run did. No tools.',
    model: stageModel('retro'),
    ...cardProcessors(() => (model ? null : splitModelId(stages.retro))),
    defaultOptions: { ...limits, ...(gate ? { maxRetries: 0 } : {}) },
  });

  // A stage asks these before it calls its agent, so a card that has spent its limit or picked a
  // model the price list cannot price ends with a stop report instead of a failed model call.
  const spendingIds = {
    build: () => splitModelId(leadModelId(leadModelFile)),
    shipping: () => (model ? null : splitModelId(stages.shipping)),
    remediation: () => (model ? null : splitModelId(stages.remediation)),
    retro: () => (model ? null : splitModelId(stages.retro)),
  };

  return { build, shipping, remediation, retro, spending, spendingIds, ...(gate ? { gate } : {}) };
}

// The Graphify exploration gate, scoped to the build. Spending is Mastra's cost guard's job.
export function createBuildGate({ repo }) {
  let active = false;
  let exploration;
  return {
    get active() { return active; },
    hooks: {
      beforeToolCall(call) {
        if (!active) throw new Error('build_not_active');
        return exploration.hooks.beforeToolCall(call);
      },
      afterToolCall(call) { return exploration?.hooks.afterToolCall(call); },
    },
    start() {
      exploration = createExplorationGate({ root: repo });
      active = true;
    },
    finish() {
      const graph = exploration.snapshot();
      if (graph.awaitingAnswer) throw new Error('incomplete_graph_answer');
      active = false;
      return { exploration: graph };
    },
  };
}
