import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Agent } from '@mastra/core/agent';
import { setCurrentSpanResolver } from '@mastra/core/observability';
import { createTool } from '@mastra/core/tools';
import { MastraLanguageModelV2Mock, simulateReadableStream } from '@mastra/core/test-utils/llm-mock';
import { z } from 'zod';

import { createAgents, repoRoot } from './agents.mjs';
import { helperKey, readRoleModels } from './role-models.mjs';
import { buildModel, leadModelId } from './models.mjs';
import { installLeadModel } from '../../scripts/install-lead-model.mjs';
import { ROLE_GROUPS, formatSettings } from '../../dashboard/lib/model-settings.js';
import { initialChoice } from '../../dashboard/lib/roles.js';

const repo = process.cwd();

test('Studio uses the CLI project root when its server works in the public directory', t => {
  const previous = { FLOW_REPO: process.env.FLOW_REPO, MASTRA_PROJECT_ROOT: process.env.MASTRA_PROJECT_ROOT };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  delete process.env.FLOW_REPO;
  process.env.MASTRA_PROJECT_ROOT = join(repo, '.mastra');
  assert.equal(repoRoot(), repo);
  const leadModelFile = join(temporary(t), 'lead-model');
  installLeadModel(leadModelFile);
  assert.equal(createAgents({ leadModelFile }).build.name, 'Lead');
  process.env.FLOW_REPO = '/explicit/repository';
  assert.equal(repoRoot(), '/explicit/repository');
});

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lead-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('Lead shell commands find global Git settings without inheriting unrelated environment variables', async t => {
  const home = temporary(t);
  const previous = { HOME: process.env.HOME, JUL339_UNRELATED_SECRET: process.env.JUL339_UNRELATED_SECRET };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.HOME = home;
  process.env.JUL339_UNRELATED_SECRET = 'parent-only';
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Lead test account\n');
  const leadModelFile = join(home, 'lead-model');
  installLeadModel(leadModelFile);
  const workspace = await createAgents({ repo, leadModelFile }).build.getWorkspace();
  const sandbox = workspace.sandbox;
  try {
    await sandbox.start();
    const git = await sandbox.executeCommand('git', ['config', '--global', '--get', 'user.name']);
    assert.equal(git.exitCode, 0, git.stderr);
    assert.equal(git.stdout.trim(), 'Lead test account');
    const environment = await sandbox.executeCommand(process.execPath, ['-e', 'console.log(JSON.stringify({home:process.env.HOME,unrelatedSecret:!!process.env.JUL339_UNRELATED_SECRET}))']);
    assert.equal(environment.exitCode, 0, environment.stderr);
    assert.deepEqual(JSON.parse(environment.stdout), { home, unrelatedSecret: false });
  } finally {
    await sandbox.stop();
  }
});

test('a missing Lead setting refuses Agent creation and names the installer', t => {
  const file = join(temporary(t), 'lead-model');
  const missing = error => error.code === 'ENOENT' && error.message.includes(file) && error.message.includes('node scripts/install-lead-model.mjs');
  assert.throws(() => leadModelId(file), missing);
  assert.throws(() => createAgents({ repo, leadModelFile: file }), missing);
});

test('Lead keeps the build identity and loads the full current poteto-mode file', async t => {
  const root = temporary(t);
  const skills = join(root, '.agents/skills/poteto-mode');
  mkdirSync(skills, { recursive: true });
  const original = readFileSync(join(repo, '.agents/skills/poteto-mode/SKILL.md'), 'utf8');
  writeFileSync(join(skills, 'SKILL.md'), original);
  const options = { repo: root, leadModelFile: join(root, 'lead-model') };
  installLeadModel(options.leadModelFile);
  const first = createAgents(options).build;
  assert.equal(first.id, 'flow-build');
  assert.equal(first.name, 'Lead');
  assert.equal(await first.getInstructions(), original);
  const changed = `${original}\nNew local instruction.\n`;
  writeFileSync(join(skills, 'SKILL.md'), changed);
  assert.equal(await createAgents(options).build.getInstructions(), changed);
});

test('new Lead instances read their independent model setting', async t => {
  const dir = temporary(t);
  const file = join(dir, 'lead-model');
  writeFileSync(join(dir, 'pstack-models.md'), 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n');
  writeFileSync(file, 'openai/gpt-6.1-sol\n');
  assert.equal((await createAgents({ repo, leadModelFile: file }).build.getModel()).modelId, 'gpt-6.1-sol');
  writeFileSync(file, 'openai/gpt-5.4\n');
  assert.equal((await createAgents({ repo, leadModelFile: file }).build.getModel()).modelId, 'gpt-5.4');
  assert.equal(readFileSync(join(dir, 'pstack-models.md'), 'utf8'), 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n');
});

test('Lead exposes one stock helper per role and one per saved panel model', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = join(dir, 'lead-role-models.md');
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  writeFileSync(roleModelsFile, 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\narena runners: openai/gpt-6.1-sol, commandcode/deepseek/deepseek-v4.1-flash\n');
  const helpers = await createAgents({ repo, leadModelFile, roleModelsFile }).build.listAgents();
  assert.equal(Object.keys(helpers).length, 21);
  assert.deepEqual(Object.keys(helpers), readRoleModels(roleModelsFile).flatMap(role => role.models.map((_, index) => helperKey(role, index))));
  assert.equal(helpers.featureRefactoring.name, 'feature, refactoring');
  assert.equal((await helpers.featureRefactoring.getModel()).modelId, 'deepseek/deepseek-v4.1-flash');
  assert.equal(helpers.arenaRunners1.name, 'arena runners');
  assert.equal((await helpers.arenaRunners1.getModel()).modelId, 'gpt-6.1-sol');
  assert.equal((await helpers.arenaRunners2.getModel()).modelId, 'deepseek/deepseek-v4.1-flash');
});

test('the role file the Start screen writes reads back with every saved model', async t => {
  const dir = temporary(t);
  const roleModelsFile = join(dir, 'lead-role-models.md');
  const modelIds = ['openai/gpt-6.1-sol', 'commandcode/deepseek/deepseek-v4.1-flash', 'anthropic/claude-opus-5-5'];
  const models = modelIds.map(id => ({ id, provider: id.split('/')[0] }));
  const choice = { ...initialChoice({ groups: ROLE_GROUPS, modelIds }), lead: modelIds[0] };
  choice.groups.building.roles['bug-fix'] = modelIds[2];
  choice.groups.panels.roles['arena-runners'] = [modelIds[2], modelIds[1]];
  writeFileSync(roleModelsFile, formatSettings(choice, models).pstack);
  const saved = readRoleModels(roleModelsFile);
  assert.equal(saved.length, ROLE_GROUPS.reduce((count, group) => count + group.roles.length, 0));
  for (const role of saved) {
    assert.deepEqual(role.models, [choice.groups[role.group].roles[role.id]].flat(), `${role.name} read back a different model.`);
  }
});

test('invalid Lead settings fail instead of falling back to an API model', t => {
  const file = join(temporary(t), 'lead-model');
  for (const value of ['', 'auto', 'inherit-parent', 'gpt-6.1-sol', 'openai/gpt-6.1-sol\nopenai/gpt-5.4']) {
    writeFileSync(file, value);
    assert.throws(() => leadModelId(file), /account model id/);
  }
});

test('the Lead setting accepts a CommandCode model through the helper route', t => {
  const file = join(temporary(t), 'lead-model');
  writeFileSync(file, 'commandcode/moonshotai/Kimi-K3.1-Pro\n');
  assert.equal(leadModelId(file), 'commandcode/moonshotai/Kimi-K3.1-Pro');
  assert.equal(buildModel(file), 'commandcode/moonshotai/Kimi-K3.1-Pro');
});

test('installing the Lead setting twice keeps an existing model and the coder role', t => {
  const dir = temporary(t);
  const file = join(dir, 'lead-model');
  const pstack = join(dir, 'pstack-models.md');
  writeFileSync(pstack, 'feature, refactoring: coder-model\n');
  assert.equal(installLeadModel(file).created, true);
  assert.equal(readFileSync(file, 'utf8'), 'openai/gpt-6.1-sol\n');
  writeFileSync(file, 'openai/gpt-5.4\n');
  assert.equal(installLeadModel(file).created, false);
  assert.equal(readFileSync(file, 'utf8'), 'openai/gpt-5.4\n');
  assert.equal(readFileSync(pstack, 'utf8'), 'feature, refactoring: coder-model\n');
});

// A scripted model answers every step with one tool call until the step turns tools off, then
// writes the text the helper reports. It is how the step budget is counted without the network.
const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const toChunks = (content, reason) => {
  const chunks = [{ type: 'stream-start', warnings: [] }];
  for (const [index, part] of content.entries()) {
    if (part.type === 'text') chunks.push({ type: 'text-start', id: `t${index}` }, { type: 'text-delta', id: `t${index}`, delta: part.text }, { type: 'text-end', id: `t${index}` });
    else chunks.push({ type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
  }
  chunks.push({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage: USAGE });
  return chunks;
};
const scriptedModel = respond => new MastraLanguageModelV2Mock({
  provider: 'test', modelId: 'scripted',
  doGenerate: async options => {
    const { content, reason } = respond(options);
    return { content, finishReason: { unified: reason, raw: reason }, usage: USAGE, warnings: [], request: {},
      response: undefined, stream: simulateReadableStream({ chunks: toChunks(content, reason) }) };
  },
  doStream: async options => {
    const { content, reason } = respond(options);
    return { stream: simulateReadableStream({ chunks: toChunks(content, reason), initialDelayInMs: 0, chunkDelayInMs: 0 }) };
  },
});

// The Lead can cut a helper's budget with the maxSteps it sends to the delegation tool. On main
// the helper stopped at that cap on a tool-calls step and returned empty text.
test('a helper the Lead cuts to maxSteps 12 still spends its own budget and ends with text', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = join(dir, 'lead-role-models.md');
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  writeFileSync(roleModelsFile, 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n');
  const { build } = createAgents({ repo, leadModelFile, roleModelsFile });
  const helper = (await build.listAgents()).featureRefactoring;
  assert.equal(helper.name, 'feature, refactoring');

  let helperSteps = 0;
  let leadCalls = 0;
  const helperModel = scriptedModel(options => {
    helperSteps += 1;
    if (options.toolChoice?.type === 'none') return { content: [{ type: 'text', text: 'checked every file' }], reason: 'stop' };
    return { content: [{ type: 'tool-call', toolCallId: `tick-${helperSteps}`, toolName: 'tick', input: '{}' }], reason: 'tool-calls' };
  });
  const leadModel = scriptedModel(() => {
    leadCalls += 1;
    if (leadCalls === 1) {
      return { content: [{ type: 'tool-call', toolCallId: 'delegate-1', toolName: 'agent-featureRefactoring',
        input: JSON.stringify({ prompt: 'Keep calling tick until you are done.', maxSteps: 12 }) }], reason: 'tool-calls' };
    }
    return { content: [{ type: 'text', text: 'delegated' }], reason: 'stop' };
  });
  const helperOptions = await helper.getDefaultOptions();
  const helperProcessors = await helper.listConfiguredInputProcessors();
  const scriptedHelper = new Agent({
    id: helper.id, name: helper.name, instructions: 'Keep calling tick until you are done.',
    model: helperModel, defaultOptions: helperOptions, inputProcessors: helperProcessors,
    tools: { tick: createTool({ id: 'tick', description: 'Tick one item.', inputSchema: z.object({}), execute: async () => 'ok' }) },
  });
  const scriptedLead = new Agent({
    id: 'flow-build', name: 'Lead', instructions: 'Delegate to the helper.', model: leadModel,
    agents: { featureRefactoring: scriptedHelper }, defaultOptions: await build.getDefaultOptions(),
  });

  const result = await scriptedLead.generate('Delegate to the feature, refactoring helper.');
  const delegated = result.toolResults.find(item => item.payload?.toolName === 'agent-featureRefactoring');
  assert.ok(delegated, 'The Lead did not call the helper.');
  assert.ok(helperSteps > 12, `The helper stopped at ${helperSteps} steps, the maxSteps 12 the Lead sent, instead of its own ${helperOptions.maxSteps}-step budget.`);
  assert.equal(delegated.payload.result.text, 'checked every file', 'The helper ended on a tool step with no text, so Lead heard an empty result.');
  assert.equal(leadCalls, 2);
});

test('an empty helper result names a machine fault on the result and the span', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = join(dir, 'lead-role-models.md');
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  writeFileSync(roleModelsFile, 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n');
  const lead = createAgents({ repo, leadModelFile, roleModelsFile }).build;
  const delegation = (await lead.getDefaultOptions()).delegation;
  assert.ok(delegation?.onDelegationComplete, 'Lead has no onDelegationComplete hook.');

  const stamped = new Map();
  const span = { attributes: {}, update({ attributes }) { Object.assign(this.attributes, attributes); stamped.set('span', this); } };
  setCurrentSpanResolver(() => span);
  t.after(() => setCurrentSpanResolver(undefined));
  const answer = await delegation.onDelegationComplete({ primitiveId: 'pstack-feature-refactoring-1',
    result: { text: '   ' }, success: true, iteration: 1, messages: [] });
  assert.match(answer.resultText, /machine fault/i);
  assert.match(answer.resultText, /pstack-feature-refactoring-1/);
  assert.equal(answer.feedback, undefined, 'An empty result is not feedback for the next turn.');
  assert.match(span.attributes.machineFault, /machine fault/i);
  assert.equal(stamped.size, 1, 'The fault was not stamped on the current span.');
});

test('a helper result with text is passed through and leaves no machine fault', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = join(dir, 'lead-role-models.md');
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  writeFileSync(roleModelsFile, 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n');
  const delegation = (await createAgents({ repo, leadModelFile, roleModelsFile }).build.getDefaultOptions()).delegation;
  const span = { attributes: {}, update() { throw new Error('A good delegation must not stamp a fault.'); } };
  setCurrentSpanResolver(() => span);
  t.after(() => setCurrentSpanResolver(undefined));
  const answer = await delegation.onDelegationComplete({ primitiveId: 'pstack-feature-refactoring-1',
    result: { text: 'checked every file' }, success: true, iteration: 1, messages: [] });
  assert.equal(answer, undefined);
});
