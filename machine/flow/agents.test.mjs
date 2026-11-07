import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { RequestContext } from '@mastra/core/request-context';

import { BUILD_WORKTREE, createAgents, prepareBuildWorktree, repoRoot } from './agents.mjs';
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

// A throwaway repository that already has an `origin/main`, so the build
// worktree cases run against git rather than a stub of it. `origin: false`
// leaves it looking like CI's shallow checkout, which has no such ref.
function repository(t, { origin = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'build-repo-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), 'one\n');
  git('add', 'README.md');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=tester', 'commit', '-q', '-m', 'one');
  if (origin) git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { root, git };
}

// The card's build worktree is the only place a build may run, so both the
// Lead and every helper resolve their filesystem and shell onto it.
async function buildAgentsIn(t, worktree) {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = join(dir, 'lead-role-models.md');
  installLeadModel(leadModelFile);
  writeFileSync(roleModelsFile, 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n');
  const { build } = createAgents({ repo, leadModelFile, roleModelsFile });
  const requestContext = new RequestContext();
  if (worktree) requestContext.set(BUILD_WORKTREE, worktree);
  return { build, requestContext, agents: [build, ...Object.values(await build.listAgents())] };
}

test('the Lead and every helper work in the card build worktree, never the Studio folder', async t => {
  const worktree = join(temporary(t), 'JUL-344-build');
  const { agents, requestContext } = await buildAgentsIn(t, worktree);

  assert.ok(agents.length > 1, 'the Lead and its helpers are the agents a build runs');
  for (const agent of agents) {
    const workspace = await agent.getWorkspace();
    const filesystem = await workspace.resolveFilesystem({ requestContext });
    const sandbox = await workspace.resolveSandbox({ requestContext });
    assert.notEqual(filesystem.basePath, repo, `${agent.name} must not work in the Studio folder.`);
    assert.equal(filesystem.basePath, worktree, `${agent.name} must read and write in the card build worktree.`);
    assert.equal(sandbox.workingDirectory, worktree, `${agent.name} must run its commands in the card build worktree.`);
  }
});

test('the Lead refuses to work when no card build worktree is set', async t => {
  const { agents, requestContext } = await buildAgentsIn(t);

  for (const agent of agents) {
    const workspace = await agent.getWorkspace();
    await assert.rejects(workspace.resolveFilesystem({ requestContext }), /build worktree/);
    await assert.rejects(workspace.resolveSandbox({ requestContext }), /build worktree/);
  }
});

test('the first start of a card makes its build worktree at origin/main', async t => {
  const { root: repoDir, git } = repository(t);
  const root = join(temporary(t), 'scratch');
  const main = git('rev-parse', 'origin/main');

  const first = prepareBuildWorktree('JUL-344', { repo: repoDir, root });

  assert.equal(first.created, true);
  assert.equal(first.path, join(root, 'JUL-344-build'));
  assert.equal(existsSync(first.path), true);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: first.path, encoding: 'utf8' }).trim(), main);
});

test('a checkout with no origin/main starts the worktree from the main it has', async t => {
  const { root: repoDir, git } = repository(t, { origin: false });
  const root = join(temporary(t), 'scratch');
  const head = git('rev-parse', 'HEAD');

  const first = prepareBuildWorktree('JUL-344', { repo: repoDir, root });

  assert.equal(first.created, true);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: first.path, encoding: 'utf8' }).trim(), head);
});

test('a second start of the same card reuses the worktree that is already there', async t => {
  const { root: repoDir } = repository(t);
  const root = join(temporary(t), 'scratch');
  const first = prepareBuildWorktree('JUL-344', { repo: repoDir, root });
  writeFileSync(join(first.path, 'work-in-progress.txt'), 'kept\n');

  const second = prepareBuildWorktree('JUL-344', { repo: repoDir, root });

  assert.equal(second.created, false);
  assert.equal(second.path, first.path);
  assert.equal(readFileSync(join(first.path, 'work-in-progress.txt'), 'utf8'), 'kept\n');
  const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoDir, encoding: 'utf8' });
  assert.equal(listed.match(/^worktree /gm).length, 2, 'the checkout and its one build worktree are all there is');
});

test('a folder git does not know as a worktree is reported and left alone', async t => {
  const { root: repoDir } = repository(t);
  const root = join(temporary(t), 'scratch');
  const path = join(root, 'JUL-344-build');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'crashed-work.txt'), 'kept\n');

  assert.throws(() => prepareBuildWorktree('JUL-344', { repo: repoDir, root }), /is not a git worktree/);
  assert.equal(readFileSync(join(path, 'crashed-work.txt'), 'utf8'), 'kept\n', 'a crashed build keeps whatever it left');
});

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
  const requestContext = new RequestContext();
  requestContext.set(BUILD_WORKTREE, home);
  const sandbox = await workspace.resolveSandbox({ requestContext });
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
