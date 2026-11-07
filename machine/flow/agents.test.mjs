import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAgents, repoRoot } from './agents.mjs';
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

// 7 Nov: a pick saved at 15:18:07 only reached the run after Studio restarted at 15:18:10.
test('a changed models file changes the next call without a new createAgents', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = join(dir, 'lead-role-models.md');
  writeFileSync(leadModelFile, 'openai/gpt-6.1-sol\n');
  writeFileSync(roleModelsFile, 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n');
  const { build } = createAgents({ repo, leadModelFile, roleModelsFile });
  assert.equal((await build.getModel()).modelId, 'gpt-6.1-sol');
  assert.equal((await (await build.listAgents()).featureRefactoring.getModel()).modelId, 'deepseek/deepseek-v4.1-flash');

  writeFileSync(leadModelFile, 'openai/gpt-5.4\n');
  writeFileSync(roleModelsFile, 'feature, refactoring: commandcode/moonshotai/Kimi-K3.1-Pro\n');
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
  writeFileSync(picker, 'feature, refactoring: commandcode/moonshotai/Kimi-K3.1-Pro\n');
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
  const modelIds = ['openai/gpt-6.1-sol', 'commandcode/deepseek/deepseek-v4.1-flash', 'anthropic/claude-opus-5-5'];
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
