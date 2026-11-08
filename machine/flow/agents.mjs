import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { resolveCurrentSpan } from '@mastra/core/observability';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { buildModel } from './models.mjs';
import { agentModel, helperKey, readRoleModels } from './role-models.mjs';
import { FREE_MODEL } from './schema.mjs';

const POTETO_SKILL = '.agents/skills/poteto-mode/SKILL.md';

// A helper's own step budget. The Lead can cut it with the maxSteps it sends to a delegation
// tool, and on 8 November a helper cut to 12 stopped on a tool-calls step with empty text.
export const HELPER_MAX_STEPS = 100;

// What Lead hears instead of an empty string when a helper spends its whole budget on tool
// calls. It names a machine fault so the model does not read the silence as a finished job.
export function machineFault(primitiveId) {
  return `Machine fault: the ${primitiveId} helper used its whole ${HELPER_MAX_STEPS}-step budget on tool calls and returned no text.`
    + ' This is a machine fault, not a card result, so no work from it can be read.';
}

// Mastra counts steps from 0, so the last step of a budget-step run is budget - 1. Turning
// tools off there makes the helper write its text instead of ending on another tool call.
export function helperBudgetProcessor(budget = HELPER_MAX_STEPS) {
  return {
    id: 'helper-last-step',
    processInputStep({ stepNumber }) {
      if (stepNumber >= budget - 1) return { toolChoice: 'none' };
      return {};
    },
  };
}

function stampMachineFault(span, fault) {
  if (!span || typeof span.update !== 'function') return;
  span.update({ attributes: { machineFault: fault } });
}

// The Lead's delegation settings: give every helper its own budget, whatever maxSteps the
// model sent, and turn an empty result into a named fault on the result and the span.
export function helperDelegation(budget = HELPER_MAX_STEPS) {
  return {
    onDelegationStart: () => ({ proceed: true, modifiedMaxSteps: budget }),
    onDelegationComplete: ({ primitiveId, result }) => {
      if (result?.text?.trim()) return undefined;
      const fault = machineFault(primitiveId);
      stampMachineFault(resolveCurrentSpan(), fault);
      return { resultText: fault };
    },
  };
}


function repositoryContaining(directory) {
  if (existsSync(join(directory, POTETO_SKILL))) return directory;
  const parent = dirname(directory);
  if (parent === directory) throw new Error('Cannot find the repository poteto-mode skill. Set FLOW_REPO to the repository root.');
  return repositoryContaining(parent);
}

export function repoRoot() {
  return process.env.FLOW_REPO ?? repositoryContaining(resolve(process.env.MASTRA_PROJECT_ROOT ?? process.cwd()));
}

export function createAgents({ model = FREE_MODEL, repo = repoRoot(), leadModelFile, roleModelsFile } = {}) {
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
  const helpers = Object.fromEntries(readRoleModels(roleModelsFile).flatMap(role => role.models.map((modelId, index) => {
    const choice = role.models.length > 1 ? `, choice ${index + 1}` : '';
    return [helperKey(role, index), new Agent({
      id: `pstack-${role.id}-${index + 1}`,
      name: role.name,
      description: `${role.name} pstack role on ${modelId}${choice}. ${role.explanation} Use this helper when delegating ${role.name} work.`,
      instructions: `You are the ${role.name} pstack helper. ${role.explanation} Complete the task delegated by Lead yourself. Do not delegate it again. Report the result and evidence.`,
      model: agentModel(modelId),
      workspace: helperWorkspace,
      defaultOptions: { maxSteps: HELPER_MAX_STEPS },
      inputProcessors: [helperBudgetProcessor()],
    })];
  })));
  const build = new Agent({
    id: 'flow-build',
    name: 'Lead',
    instructions: readFileSync(join(repo, POTETO_SKILL), 'utf8'),
    model: buildModel(leadModelFile),
    workspace,
    agents: helpers,
    defaultOptions: { maxSteps: 400, delegation: helperDelegation() },
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
