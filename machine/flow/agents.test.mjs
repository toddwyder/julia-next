import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readLedger } from './card-ledger.mjs';
import test from 'node:test';

import { createAgents, repoRoot } from './agents.mjs';
import { HELPER_CONCURRENCY, STOP_REASONS } from './spending.mjs';
import { helperKey, readRoleModels } from './role-models.mjs';
import { buildModel, leadModelId } from './models.mjs';
import { installLeadModel } from '../../scripts/install-lead-model.mjs';
import { ROLE_GROUPS, formatSettings, readSettings } from '../../dashboard/lib/model-settings.js';
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
  assert.equal(createAgents({ leadModelFile, model: 'openai/gpt-6.1-sol' }).build.name, 'Lead');
  process.env.FLOW_REPO = '/explicit/repository';
  assert.equal(repoRoot(), '/explicit/repository');
});

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lead-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const MODEL_IDS = [
  'openai/gpt-6.1-sol',
  'commandcode/deepseek/deepseek-v4.1-flash',
  'anthropic/claude-opus-5-5',
  'commandcode/moonshotai/Kimi-K3.1-Pro',
];

function completeRoleFile(file, mutate = () => {}) {
  const models = MODEL_IDS.map(id => ({ id, provider: id.split('/')[0] }));
  const choice = { ...initialChoice({ groups: ROLE_GROUPS, modelIds: MODEL_IDS }), lead: MODEL_IDS[0] };
  mutate(choice);
  writeFileSync(file, formatSettings(choice, models).pstack);
  return file;
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
  const workspace = await createAgents({ repo, leadModelFile, model: 'openai/gpt-6.1-sol' }).build.getWorkspace();
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
  const options = { repo: root, leadModelFile: join(root, 'lead-model'), model: 'openai/gpt-6.1-sol' };
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
  assert.equal((await createAgents({ repo, leadModelFile: file, model: 'openai/gpt-6.1-sol' }).build.getModel()).modelId, 'gpt-6.1-sol');
  writeFileSync(file, 'openai/gpt-5.4\n');
  assert.equal((await createAgents({ repo, leadModelFile: file, model: 'openai/gpt-6.1-sol' }).build.getModel()).modelId, 'gpt-5.4');
  assert.equal(readFileSync(join(dir, 'pstack-models.md'), 'utf8'), 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n');
});

test('Lead exposes one stock helper per role and one per saved panel model', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = join(dir, 'lead-role-models.md');
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  completeRoleFile(roleModelsFile, choice => {
    choice.groups.building.roles['feature-refactoring'] = 'commandcode/deepseek/deepseek-v4.1-flash';
    choice.groups.panels.roles['arena-runners'] = ['openai/gpt-6.1-sol', 'commandcode/deepseek/deepseek-v4.1-flash'];
  });
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
  const modelIds = [...MODEL_IDS];
  const models = modelIds.map(id => ({ id, provider: id.split('/')[0] }));
  const choice = { ...initialChoice({ groups: ROLE_GROUPS, modelIds }), lead: modelIds[0] };
  choice.groups.building.roles['bug-fix'] = modelIds[2];
  choice.groups.panels.roles['arena-runners'] = [modelIds[2], modelIds[1]];
  writeFileSync(roleModelsFile, formatSettings(choice, models).pstack);
  const saved = readRoleModels(roleModelsFile);
  assert.equal(saved.length, ROLE_GROUPS.filter(group => !group.machine).reduce((count, group) => count + group.roles.length, 0));
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

test('the build and its helpers work in the card copy the run names', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  installLeadModel(leadModelFile);
  const roleModelsFile = completeRoleFile(join(dir, 'lead-role-models.md'));
  const cardCopy = join(dir, 'cards', 'JUL-400');
  mkdirSync(cardCopy, { recursive: true });
  const requestContext = new Map([['cardCheckout', cardCopy]]);
  const agents = createAgents({ repo, leadModelFile, roleModelsFile, model: 'openai/gpt-6.1-sol' });

  const lead = (await agents.build.getWorkspace({ requestContext })).getPathContext();
  assert.equal(lead.filesystem.basePath, cardCopy);
  assert.equal(lead.sandbox.workingDirectory, cardCopy);
  const helper = (await (await agents.build.listAgents()).featureRefactoring.getWorkspace({ requestContext })).getPathContext();
  assert.equal(helper.sandbox.workingDirectory, cardCopy);

  const settings = (await createAgents({ repo, leadModelFile, roleModelsFile, model: 'openai/gpt-6.1-sol' }).build.getWorkspace()).getPathContext();
  assert.equal(settings.sandbox.workingDirectory, repo, 'a read with no card copy works in Studio’s repository');
});

// 7 Nov: a pick saved at 15:18:07 only reached the run after Studio restarted at 15:18:10.
test('a changed models file changes the next call without a new createAgents', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = join(dir, 'lead-role-models.md');
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  completeRoleFile(roleModelsFile);
  const { build } = createAgents({ repo, leadModelFile, roleModelsFile });
  assert.equal((await build.getModel()).modelId, 'gpt-6.1-sol');
  assert.equal((await (await build.listAgents()).featureRefactoring.getModel()).modelId, 'deepseek/deepseek-v4.1-flash');

  writeFileSync(leadModelFile, 'openai/gpt-5.4\n');
  completeRoleFile(roleModelsFile, choice => {
    choice.groups.building.roles['feature-refactoring'] = 'commandcode/moonshotai/Kimi-K3.1-Pro';
  });
  assert.equal((await build.getModel()).modelId, 'gpt-5.4');
  assert.equal((await (await build.listAgents()).featureRefactoring.getModel()).modelId, 'moonshotai/Kimi-K3.1-Pro');
});

test('readRoleModels reads the picker file only and ignores the pstack models file', t => {
  const dir = temporary(t);
  const home = join(dir, 'home');
  const picker = join(home, '.config', 'julia', 'lead-role-models.md');
  const pstack = join(home, '.agents', 'pstack-models.md');
  mkdirSync(join(home, '.config', 'julia'), { recursive: true });
  mkdirSync(join(home, '.agents'), { recursive: true });
  completeRoleFile(picker, choice => {
    choice.groups.building.roles['feature-refactoring'] = 'commandcode/moonshotai/Kimi-K3.1-Pro';
  });
  writeFileSync(pstack, 'feature, refactoring: openai/gpt-6-astra\nbug-fix: openai/gpt-6-astra\n');
  const previous = process.env.JULIA_LEAD_ROLE_MODELS_FILE;
  const previousHome = process.env.HOME;
  t.after(() => {
    if (previous === undefined) delete process.env.JULIA_LEAD_ROLE_MODELS_FILE;
    else process.env.JULIA_LEAD_ROLE_MODELS_FILE = previous;
    process.env.HOME = previousHome;
  });
  delete process.env.JULIA_LEAD_ROLE_MODELS_FILE;
  process.env.HOME = home;
  const roles = readRoleModels();
  assert.deepEqual(roles.find(role => role.id === 'feature-refactoring').models, ['commandcode/moonshotai/Kimi-K3.1-Pro']);
  assert.notDeepEqual(roles.find(role => role.id === 'bug-fix').models, ['openai/gpt-6-astra']);
  assert.equal(readFileSync(pstack, 'utf8'), 'feature, refactoring: openai/gpt-6-astra\nbug-fix: openai/gpt-6-astra\n');
});

test('the picker and the machine resolve the same model id for every saved role', t => {
  const dir = temporary(t);
  const roleModelsFile = join(dir, 'lead-role-models.md');
  const modelIds = [...MODEL_IDS];
  const models = modelIds.map(id => ({ id, provider: id.split('/')[0] }));
  const choice = { ...initialChoice({ groups: ROLE_GROUPS, modelIds }), lead: modelIds[0] };
  choice.groups.building.roles['bug-fix'] = modelIds[2];
  writeFileSync(roleModelsFile, formatSettings(choice, models).pstack);
  const picker = readSettings({ paths: { pstack: roleModelsFile, lead: join(dir, 'lead-model') }, modelIds });
  for (const role of readRoleModels(roleModelsFile)) {
    assert.deepEqual(role.models, [picker.groups[role.group].roles[role.id]].flat(), `${role.name} resolves differently in the picker and the machine.`);
  }
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

test('the machine stages take their models from the saved picks', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = completeRoleFile(join(dir, 'lead-role-models.md'), choice => {
    choice.groups.machine.roles.shipping = 'commandcode/moonshotai/Kimi-K3.1-Pro';
    choice.groups.machine.roles.remediation = 'openai/gpt-6.1-sol';
    choice.groups.machine.roles.retro = 'openai/gpt-6.1-sol';
  });
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  const { shipping, remediation, retro } = createAgents({ repo, leadModelFile, roleModelsFile });
  assert.equal((await shipping.getModel()).modelId, 'moonshotai/Kimi-K3.1-Pro');
  assert.equal((await remediation.getModel()).modelId, 'gpt-6.1-sol');
  assert.equal((await retro.getModel()).modelId, 'gpt-6.1-sol');
});

test('a missing stage pick stops before the stage starts and names the stage', t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = completeRoleFile(join(dir, 'lead-role-models.md'));
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  const withoutShipping = readFileSync(roleModelsFile, 'utf8')
    .split('\n')
    .filter(line => !line.startsWith('Shipping:'))
    .join('\n');
  writeFileSync(roleModelsFile, withoutShipping);
  assert.throws(() => createAgents({ repo, leadModelFile, roleModelsFile }), /Missing Shipping pick/);
});

test('every agent carries the cost guard and sets no output limit of its own', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = completeRoleFile(join(dir, 'lead-role-models.md'));
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  const agents = createAgents({ repo, leadModelFile, roleModelsFile, dir });
  const helpers = Object.values(await agents.build.listAgents());
  const all = [agents.build, agents.shipping, agents.remediation, agents.retro, ...helpers];
  assert.ok(all.length >= 25);
  for (const agent of all) {
    const options = await agent.getDefaultOptions();
    assert.equal(options.modelSettings?.maxOutputTokens, undefined, `${agent.name} has an output limit of the machine's own`);
    assert.equal(options.maxRetries, undefined, `${agent.name} retries the way Mastra retries`);
    const processors = await agent.listConfiguredInputProcessors();
    assert.ok(processors.some(processor => processor.id === 'token-cost-control'), `${agent.name} has no cost guard`);
  }
});

test('the memory note-takers run on the free model the card picked, with the retries and answer limit Mastra gives them', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = completeRoleFile(join(dir, 'lead-role-models.md'));
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  const { build, spending } = createAgents({ repo, leadModelFile, roleModelsFile, dir });
  spending.begin('JUL-375-MEMORY');
  assert.equal(spending.memoryModel, 'commandcode/inclusionai/ling-3.1-flash:free');
  assert.equal(readLedger(join(dir, 'JUL-375-MEMORY', 'spending.json')).memoryModel, 'commandcode/inclusionai/ling-3.1-flash:free', 'the pick is saved with the card');
  const observational = (await build.getMemory()).getMergedThreadConfig({}).observationalMemory;
  assert.equal(observational.observation.maxRetries, undefined);
  assert.equal(observational.reflection.maxRetries, undefined);
  assert.equal(observational.observation.modelSettings?.maxOutputTokens, undefined);
  assert.equal(observational.reflection.modelSettings?.maxOutputTokens, undefined);
});

test('the Lead runs a fixed number of helpers at once, and a stopped card starts no new helper', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = completeRoleFile(join(dir, 'lead-role-models.md'));
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  const agents = createAgents({ repo, leadModelFile, roleModelsFile, machine: false, dir });
  const options = await agents.build.getDefaultOptions();
  assert.equal(options.toolCallConcurrency, HELPER_CONCURRENCY, 'the Lead is given a fixed number of helpers at once');
  assert.equal(options.hooks.beforeToolCall({ toolName: 'agent-pstackBugFix1' }), undefined, 'an unstopped card starts a helper');

  agents.spending.begin('JUL-375-CONCURRENCY');
  agents.spending.stop(STOP_REASONS.limit);
  assert.throws(() => options.hooks.beforeToolCall({ toolName: 'agent-pstackBugFix1' }), /card spending limit reached/);
  assert.equal(options.hooks.beforeToolCall({ toolName: 'read_file' }), undefined, 'a stopped card still lets a helper read a file');
});
