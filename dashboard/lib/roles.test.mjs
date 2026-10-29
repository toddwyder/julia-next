import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EFFORTS, PANEL_MINIMUM, addPanelModel, effortById, initialChoice, isRoleOverride,
  mergeDraft, removePanelModel, resolveModelId, setEffort, setGroupModel, setRoleModel, sharedModel,
} from './roles.js';

const config = JSON.parse(readFileSync(new URL('../config/roles.json', import.meta.url), 'utf8'));

const modelIds = [
  'openai/gpt-6.1-sol',
  'mastracode/commandcode/deepseek/deepseek-v4.1-flash',
  'anthropic/claude-opus-5-5',
];

const fresh = (overrides = {}) => initialChoice({ card: 'JUL-276', groups: config.groups, modelIds, ...overrides });

test('the sweep id for a pstack model is found by its provider-prefixed name', () => {
  assert.equal(resolveModelId('commandcode/deepseek/deepseek-v4.1-flash', modelIds),
    'mastracode/commandcode/deepseek/deepseek-v4.1-flash');
  assert.equal(resolveModelId('openai/gpt-6.1-sol', modelIds), 'openai/gpt-6.1-sol');
  assert.equal(resolveModelId('openai/gpt-9-retired', modelIds), '');
});

test('a fresh choice mirrors pstack: every role starts on the model its pstack line names', () => {
  const choice = fresh();
  const flash = 'mastracode/commandcode/deepseek/deepseek-v4.1-flash';
  assert.deepEqual(Object.values(choice.groups.building.roles), Array(4).fill(flash));
  assert.equal(choice.groups.building.model, flash);
  assert.deepEqual(Object.values(choice.groups.judgment.roles), Array(2).fill('openai/gpt-6.1-sol'));
  assert.equal(choice.groups.investigating.roles['how-explorer'], flash);
  assert.equal(choice.groups.investigating.roles['how-explainer'], 'openai/gpt-6.1-sol');
  assert.deepEqual(choice.groups.panels.models, [flash, 'openai/gpt-6.1-sol']);
  assert.deepEqual(choice.groups.panels.roles['arena-runners'], [flash, 'openai/gpt-6.1-sol']);
  assert.equal(choice.effort, 'large');
});

test('a tie for the group model goes to the first role, and the others show as set on their own', () => {
  const choice = fresh();
  assert.equal(choice.groups.investigating.model, 'mastracode/commandcode/deepseek/deepseek-v4.1-flash');
  assert.equal(isRoleOverride(choice, 'investigating', 'how-explorer'), false);
  assert.equal(isRoleOverride(choice, 'investigating', 'how-explainer'), true);
  assert.equal(sharedModel(['a', 'b', 'b', 'a']), 'a');
  assert.equal(sharedModel([]), '');
});

test('changing a group model moves every role in that group and no other group', () => {
  const before = fresh();
  const after = setGroupModel(before, 'building', 'openai/gpt-6.1-sol');
  assert.deepEqual(Object.values(after.groups.building.roles), Array(4).fill('openai/gpt-6.1-sol'));
  assert.equal(after.groups.building.model, 'openai/gpt-6.1-sol');
  for (const groupId of ['judgment', 'investigating', 'learning', 'panels', 'workers']) {
    assert.deepEqual(after.groups[groupId], before.groups[groupId], `${groupId} changed`);
  }
  assert.equal(isRoleOverride(after, 'building', 'hillclimb'), false);
});

test('a role set on its own differs from its group until the group moves again', () => {
  const before = fresh();
  const overridden = setRoleModel(before, 'building', 'bug-fix', 'anthropic/claude-opus-5-5');
  assert.equal(overridden.groups.building.model, before.groups.building.model);
  assert.equal(overridden.groups.building.roles['bug-fix'], 'anthropic/claude-opus-5-5');
  assert.equal(isRoleOverride(overridden, 'building', 'bug-fix'), true);
  assert.equal(isRoleOverride(overridden, 'building', 'feature-refactoring'), false);
  const moved = setGroupModel(overridden, 'building', 'openai/gpt-6.1-sol');
  assert.deepEqual(Object.values(moved.groups.building.roles), Array(4).fill('openai/gpt-6.1-sol'));
});

test('a panel keeps at least one model and refuses removing the last', () => {
  const one = addPanelModel(fresh(), 'panels', 'anthropic/claude-opus-5-5');
  assert.deepEqual(one.groups.panels.models, [
    'mastracode/commandcode/deepseek/deepseek-v4.1-flash',
    'openai/gpt-6.1-sol',
    'anthropic/claude-opus-5-5',
  ]);
  const two = removePanelModel(one, 'panels', 'mastracode/commandcode/deepseek/deepseek-v4.1-flash');
  const last = removePanelModel(two, 'panels', 'openai/gpt-6.1-sol');
  assert.deepEqual(last.groups.panels.models, ['anthropic/claude-opus-5-5']);
  assert.throws(() => removePanelModel(last, 'panels', 'anthropic/claude-opus-5-5'), new RegExp(PANEL_MINIMUM));
  assert.deepEqual(last.groups.panels.roles['architect-runners'], ['anthropic/claude-opus-5-5']);
});

test('a panel role can keep its own list, and a role cannot lose its last model', () => {
  const choice = addPanelModel(fresh(), 'panels', 'anthropic/claude-opus-5-5', 'interrogate-reviewers');
  assert.deepEqual(choice.groups.panels.roles['interrogate-reviewers'], [
    'mastracode/commandcode/deepseek/deepseek-v4.1-flash',
    'openai/gpt-6.1-sol',
    'anthropic/claude-opus-5-5',
  ]);
  assert.equal(isRoleOverride(choice, 'panels', 'interrogate-reviewers'), true);
  assert.equal(isRoleOverride(choice, 'panels', 'arena-runners'), false);
  const one = removePanelModel(choice, 'panels', 'mastracode/commandcode/deepseek/deepseek-v4.1-flash', 'interrogate-reviewers');
  const last = removePanelModel(one, 'panels', 'openai/gpt-6.1-sol', 'interrogate-reviewers');
  assert.deepEqual(last.groups.panels.roles['interrogate-reviewers'], ['anthropic/claude-opus-5-5']);
  assert.throws(
    () => removePanelModel(last, 'panels', 'anthropic/claude-opus-5-5', 'interrogate-reviewers'),
    new RegExp(PANEL_MINIMUM),
  );
});

test('the effort picker maps Small, Medium, Large and Unlimited to one to four brains, in order', () => {
  assert.deepEqual(EFFORTS.map(effort => [effort.id, effort.name, effort.brains]), [
    ['small', 'Small', 1],
    ['medium', 'Medium', 2],
    ['large', 'Large', 3],
    ['unlimited', 'Unlimited', 4],
  ]);
  assert.equal(setEffort(fresh(), 'small').effort, 'small');
  assert.equal(setEffort(fresh(), 'unlimited').effort, 'unlimited');
  assert.throws(() => setEffort(fresh(), 'maximum'), /Unknown effort/);
  assert.equal(effortById('large').brains, 3);
  assert.equal(effortById('missing').id, 'large');
});

test('a saved draft with a retired model falls back to the group model and keeps everything else', () => {
  const fallback = fresh();
  const saved = fresh();
  saved.groups.building.model = 'openai/retired-model';
  saved.groups.building.roles['bug-fix'] = 'openai/retired-model';
  saved.groups.judgment.model = 'anthropic/claude-opus-5-5';
  saved.effort = 'small';
  const merged = mergeDraft({ saved, fallback, modelIds });
  assert.equal(merged.groups.building.model, fallback.groups.building.model);
  assert.equal(merged.groups.building.roles['bug-fix'], fallback.groups.building.model);
  assert.equal(merged.groups.judgment.model, 'anthropic/claude-opus-5-5');
  assert.equal(merged.effort, 'small');
});

test('a corrupt or empty draft returns the fresh choice instead of throwing', () => {
  const fallback = fresh();
  for (const saved of [null, 'text', [], {}, { groups: 'no' }, { groups: {} }]) {
    assert.deepEqual(mergeDraft({ saved, fallback, modelIds }), fallback);
  }
  const merged = mergeDraft({ saved: { effort: 'nonsense', groups: { building: { model: 'x', roles: { 'bug-fix': 7 } } } }, fallback, modelIds });
  assert.equal(merged.effort, 'large');
  assert.equal(merged.groups.building.roles['bug-fix'], fallback.groups.building.model);
});
