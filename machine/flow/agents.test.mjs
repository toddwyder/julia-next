import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAgents, repoRoot } from './agents.mjs';
import { leadModelId } from './models.mjs';
import { installLeadModel } from '../../scripts/install-lead-model.mjs';

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

test('invalid Lead settings fail instead of falling back to an API model', t => {
  const file = join(temporary(t), 'lead-model');
  for (const value of ['', 'auto', 'inherit-parent', 'commandcode/deepseek/deepseek-v4.1-flash', 'openai/gpt-6.1-sol\nopenai/gpt-5.4']) {
    writeFileSync(file, value);
    assert.throws(() => leadModelId(file), /ChatGPT subscription/);
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
