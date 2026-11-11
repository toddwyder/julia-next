import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { ModelRouterLanguageModel } from '@mastra/core/llm';
import { Memory } from '@mastra/memory';
import { createExplorationGate } from './exploration.mjs';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { buildModelReader, leadModelId } from './models.mjs';
import { agentModel, helperKey, readRoleModels, readStageModels } from './role-models.mjs';

// Mastra caps the observer and reflector at 100,000 output tokens, but only when it picks their model.
// An explicit model gets no cap, so the controller reserved all of the remaining token cap for one memory
// call and the Lead's next call found no room (JUL-362, 11 Nov). This is Mastra's own value, set explicitly.
export const MEMORY_MAX_OUTPUT_TOKENS = 100_000;

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

export function createAgents({ model, repo = repoRoot(), leadModelFile, roleModelsFile, tools = {}, budget } = {}) {
  budget = budget ? createBuildBudget({ control: budget, repo }) : undefined;
  const wrapped = (id, role) => {
    const selected = agentModel(id);
    return budget.control.wrapModel(typeof selected === 'string' ? new ModelRouterLanguageModel(selected) : selected, { id, role });
  };
  const memoryFor = role => {
    if (!budget) return {};
    const memory = new Memory({ options: { observationalMemory: {
      observation: { model: wrapped('openai/gpt-6-luna', `${role}:observer`), maxRetries: 0, failurePolicy: 'abort', modelSettings: { maxOutputTokens: MEMORY_MAX_OUTPUT_TOKENS } },
      reflection: { model: wrapped('openai/gpt-6-luna', `${role}:reflector`), maxRetries: 0, failurePolicy: 'abort', modelSettings: { maxOutputTokens: MEMORY_MAX_OUTPUT_TOKENS } },
    } } });
    budget.addMemory(memory);
    return { memory };
  };
  const budgetOptions = budget ? { maxRetries: 0, abortSignal: budget.signal, hooks: budget.hooks } : {};
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
      model: budget ? wrapped(modelId, role.name) : agentModel(modelId),
      ...memoryFor(role.name),
      workspace: helperWorkspace,
      tools,
      defaultOptions: { maxSteps: 100, ...budgetOptions },
    })];
  })));
  const build = new Agent({
    id: 'flow-build',
    name: 'Lead',
    instructions: readFileSync(join(repo, POTETO_SKILL), 'utf8'),
    model: budget ? () => wrapped(leadModelId(leadModelFile), 'lead') : buildModelReader(leadModelFile),
    ...memoryFor('lead'),
    workspace,
    agents: helpers,
    tools,
    defaultOptions: { maxSteps: 400, ...budgetOptions },
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
    ...(budget ? { defaultOptions: { maxRetries: 0 } } : {}),
  });

  const remediation = new Agent({
    id: 'flow-remediation',
    name: 'Flow remediation stand-in',
    instructions: 'You rewrite one short line so it reads better. Reply with the new line only. No tools.',
    model: stageModel('remediation'),
    ...(budget ? { defaultOptions: { maxRetries: 0 } } : {}),
  });

  const retro = new Agent({
    id: 'flow-retro',
    name: 'Flow retro stand-in',
    instructions: 'You write one sentence about what this throwaway run did. No tools.',
    model: stageModel('retro'),
    ...(budget ? { defaultOptions: { maxRetries: 0 } } : {}),
  });

  return { build, shipping, remediation, retro, ...(budget ? { budget } : {}) };
}

// The controller owns durable accounting. This adapter scopes it to build only.
export function createBuildBudget({ control, repo, onStop = () => { process.exitCode = 1; } }) {
  let active = false;
  let exploration;
  const memories = new Set();
  control.signal.addEventListener('abort', onStop, { once: true });
  const fail = (reason, numbers = {}) => {
    control.stop(reason, numbers);
    onStop();
    throw new Error(reason);
  };
  return {
    control,
    get active() { return active; },
    get signal() { return control.signal; },
    addMemory(memory) { memories.add(memory); },
    hooks: {
      beforeToolCall(call) {
        if (!active || control.signal.aborted) return fail('build_not_active');
        return exploration.hooks.beforeToolCall(call);
      },
      afterToolCall(call) { return exploration?.hooks.afterToolCall(call); },
    },
    start() {
      try {
        control.assertStart();
        exploration = createExplorationGate({ root: repo });
        active = true;
      } catch (error) { onStop(); throw error; }
    },
    processor: {
      name: 'build-budget',
      process(span) {
        if (!active) return span;
        try {
          control.recordSpan(span);
          if (control.signal.aborted) onStop();
        } catch (error) { control.stop('trace_accounting_failed', { error: error.name }); onStop(); }
        return span;
      },
    },
    async finish() {
      try {
        // @mastra/memory/dist/index.d.ts:72-88: drain work, including work it enqueues.
        await Promise.all([...memories].map(memory => memory.settled()));
        const graph = exploration.snapshot();
        if (graph.awaitingAnswer) fail('incomplete_graph_answer', graph);
        const record = control.finish();
        active = false;
        return { ...record, exploration: graph };
      } catch (error) {
        if (!control.signal.aborted) control.stop('build_finish_failed', { error: error.name });
        onStop();
        throw error;
      }
    },
  };
}
