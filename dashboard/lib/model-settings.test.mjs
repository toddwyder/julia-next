import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { LEAD_DEFAULT_MODEL, ROLE_GROUPS, formatSettings, leadModels, readSettings, saveSettings, saveSettingsChoice, settingsPaths } from './model-settings.js';
import { initialChoice } from './roles.js';

const models = [
  { id: 'openai/gpt-6.1-sol', provider: 'openai' },
  { id: 'openai/gpt-6-astra', provider: 'openai' },
  { id: 'commandcode/deepseek/deepseek-v4.1-flash', provider: 'commandcode' },
  { id: 'commandcode/moonshotai/Kimi-K3.1-Pro', provider: 'commandcode' },
];
const fresh = () => ({
  ...initialChoice({ groups: ROLE_GROUPS, modelIds: models.map(model => model.id) }),
  lead: models[0].id,
});
function profile(t) {
  const home = mkdtempSync(join(tmpdir(), 'model-settings-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return settingsPaths(home);
}
const modelIds = models.map(model => model.id);
const snapshot = paths => Object.values(paths).map(file => [readFileSync(file, 'utf8'), statSync(file).mtimeMs]);

test('Save writes Lead-only role settings and leaves Codex role settings unchanged', t => {
  const paths = profile(t);
  const codexFile = join(paths.pstack, '..', '..', '..', '.agents', 'pstack-models.md');
  mkdirSync(join(codexFile, '..'), { recursive: true });
  writeFileSync(codexFile, 'feature, refactoring: openai/gpt-6.1-sol\n');
  mkdirSync(join(paths.pstack, '..'), { recursive: true });
  writeFileSync(paths.pstack, 'retired role: old-model\n');
  const choice = fresh();
  choice.effort = 'small';
  choice.groups.building.roles['bug-fix'] = models[1].id;
  saveSettings(choice, { paths, models });
  const text = readFileSync(paths.pstack, 'utf8');
  assert.ok(text.startsWith('# budget: small (medium)\n'));
  assert.ok(text.includes('feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n'));
  assert.ok(text.includes('reflect judgment, divergent, synthesizer: openai/gpt-6.1-sol\n'));
  assert.ok(text.includes('arena runners: commandcode/deepseek/deepseek-v4.1-flash, openai/gpt-6.1-sol\n'));
  assert.ok(text.includes('bug-fix: openai/gpt-6-astra\n'));
  assert.ok(!text.includes('retired role'));
  assert.ok(!text.includes('---'));
  assert.equal(readFileSync(paths.lead, 'utf8'), 'openai/gpt-6.1-sol\n');
  assert.equal(readFileSync(codexFile, 'utf8'), 'feature, refactoring: openai/gpt-6.1-sol\n');
  const reread = readSettings({ paths, modelIds: models.map(model => model.id) });
  assert.equal(reread.effort, 'small');
  assert.deepEqual(reread.groups.building.roles, choice.groups.building.roles);
  assert.deepEqual(reread.groups.panels.roles, choice.groups.panels.roles);
});

test('current settings preserve retired model ids so the UI does not claim a replacement is already in use', t => {
  const paths = profile(t);
  saveSettings(fresh(), { paths, models });
  writeFileSync(paths.pstack, '# budget: medium (high)\nbug-fix: retired-model\n');
  const current = readSettings({ paths, modelIds: models.map(model => model.id) });
  assert.equal(current.groups.building.roles['bug-fix'], 'retired-model');
  assert.equal(current.effort, 'medium');
});

test('with no settings files the screen still shows the models a fresh run uses', t => {
  const paths = profile(t);
  const modelIds = models.map(model => model.id);
  const shown = readSettings({ paths, modelIds });
  assert.equal(shown.lead, LEAD_DEFAULT_MODEL);
  assert.equal(shown.groups.building.roles['feature-refactoring'], models[2].id);
  assert.deepEqual(shown.groups.panels.roles['arena-runners'], [models[2].id, models[0].id]);
  mkdirSync(join(paths.lead, '..'), { recursive: true });
  writeFileSync(paths.lead, 'openai/gpt-retired\n');
  assert.equal(readSettings({ paths, modelIds }).lead, 'openai/gpt-retired');
});

test('missing, unknown and injected role models are rejected without changing either file', t => {
  const paths = profile(t);
  saveSettings(fresh(), { paths, models });
  const before = Object.values(paths).map(file => readFileSync(file, 'utf8'));
  for (const invalid of [undefined, '', 'retired-model', 'openai/gpt-6.1-sol\nrole: injected']) {
    const choice = fresh();
    choice.groups.building.roles['bug-fix'] = invalid;
    assert.throws(() => saveSettings(choice, { paths, models }), /bug-fix/);
    assert.deepEqual(Object.values(paths).map(file => readFileSync(file, 'utf8')), before);
  }
});

test('Lead accepts any account model and panels cannot be empty', () => {
  assert.deepEqual(leadModels(models).map(model => model.id), models.map(model => model.id));
  const choice = fresh();
  choice.lead = models[2].id;
  assert.equal(formatSettings(choice, models).lead, `${models[2].id}\n`);
  choice.lead = 'unknown/model';
  assert.throws(() => formatSettings(choice, models), /account model/);
  choice.lead = models[0].id;
  choice.groups.panels.roles['arena-runners'] = [];
  assert.throws(() => formatSettings(choice, models), /at least one/);
  choice.effort = 'invalid';
  assert.throws(() => formatSettings(choice, models), /effort/);
});

test('a repeated Save converges to the same runtime settings', t => {
  const paths = profile(t);
  saveSettings(fresh(), { paths, models });
  const before = Object.values(paths).map(file => readFileSync(file, 'utf8'));
  saveSettings(fresh(), { paths, models });
  assert.deepEqual(Object.values(paths).map(file => readFileSync(file, 'utf8')), before);
});

test('a write failure leaves the previous runtime settings in place', t => {
  const paths = profile(t);
  saveSettings(fresh(), { paths, models });
  const before = readFileSync(paths.pstack, 'utf8');
  const directory = join(paths.lead, '..');
  chmodSync(directory, 0o500);
  try {
    const choice = fresh();
    choice.lead = models[1].id;
    assert.throws(() => saveSettings(choice, { paths, models }), /EACCES/);
    assert.equal(readFileSync(paths.pstack, 'utf8'), before);
    assert.equal(readFileSync(paths.lead, 'utf8'), 'openai/gpt-6.1-sol\n');
  } finally { chmodSync(directory, 0o700); }
});

test('an unchanged Save writes both files again and reads the choice back', async t => {
  const paths = profile(t);
  const choice = fresh();
  const first = saveSettingsChoice(choice, { models, paths });
  assert.equal(first.wrote, true);
  assert.deepEqual(first.choice, choice);
  const before = snapshot(paths);
  await new Promise(done => setTimeout(done, 10));
  const again = saveSettingsChoice(choice, { models, paths });
  assert.equal(again.wrote, true, 'An unchanged Save must write, not skip.');
  assert.equal(typeof again.updatedAt, 'string');
  assert.deepEqual(again.choice, choice);
  const after = snapshot(paths);
  for (const [index, file] of Object.values(paths).entries()) {
    assert.equal(after[index][0], before[index][0], `${file} changed its contents on an unchanged Save.`);
    assert.ok(after[index][1] > before[index][1], `${file} did not move its modified time on an unchanged Save.`);
  }
});

test('a Save whose read-back differs is refused instead of reported as saved', t => {
  const paths = profile(t);
  const choice = fresh();
  const read = () => ({ ...choice, lead: models[1].id });
  assert.throws(() => saveSettingsChoice(choice, { models, paths, read }), /did not read back as written/);
});

test('a Save writes only the picker files and leaves the pstack models file alone', t => {
  const paths = profile(t);
  const pstackFile = join(dirname(paths.pstack), '..', '..', '.agents', 'pstack-models.md');
  mkdirSync(dirname(pstackFile), { recursive: true });
  writeFileSync(pstackFile, 'feature, refactoring: openai/gpt-6-astra\n');
  const before = readFileSync(pstackFile);
  saveSettingsChoice(fresh(), { models, paths });
  assert.deepEqual(readFileSync(pstackFile), before);
  assert.ok(readFileSync(paths.pstack, 'utf8').includes('feature, refactoring:'));
  assert.ok(readFileSync(paths.lead, 'utf8').trim());
});

test('a Save of an unknown or injected row is refused and leaves both files untouched', t => {
  const paths = profile(t);
  saveSettingsChoice(fresh(), { models, paths });
  const before = snapshot(paths);
  for (const [roleId, value] of [['no-such-role', models[0].id], ['bug-fix', 'openai/retired-model'], ['bug-fix', 'openai/gpt-6.1-sol\nrole: injected']]) {
    const choice = fresh();
    choice.groups.building.roles[roleId] = value;
    assert.throws(() => saveSettingsChoice(choice, { models, paths }));
    assert.deepEqual(snapshot(paths), before);
  }
});
