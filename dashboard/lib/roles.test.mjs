import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EFFORTS, PANEL_MINIMUM, PANEL_MODEL_ONLY, STALE_PAGE, addPanelModel, applyRows, changedRows,
  effortById, initialChoice, isRoleOverride, mergeDraft, removePanelModel, resolveModelId, setEffort,
  setGroupModel, setRoleModel, sharedModel,
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

test('the review panels describe the review pstack now runs', () => {
  const panels = config.groups.find(group => group.id === 'panels');
  const role = id => panels.roles.find(entry => entry.id === id);
  assert.equal(role('arena-cross-judge-pool').explanation,
    "Models that may judge those attempts; the judge is never from the parent chat's model family.");
  assert.equal(role('interrogate-reviewers').explanation,
    'Models that try to break the change, and must prove each finding by running it.');
  const judge = role('arena-cross-judge-pool');
  assert.ok(judge.default.some(model => !model.startsWith('openai/')),
    'the cross-judge pool can still supply a judge outside the parent chat\'s openai family');
});

test('a page that moved no row sends an empty patch', () => {
  const loaded = fresh();
  assert.deepEqual(changedRows(loaded, loaded), {});
  const same = JSON.parse(JSON.stringify(loaded));
  same.lead = 'openai/gpt-6.1-sol';
  assert.deepEqual(changedRows({ ...loaded, lead: same.lead }, same), {});
});

test('the effort and the lead are sent only when they moved', () => {
  const loaded = { ...fresh(), lead: 'openai/gpt-6.1-sol' };
  assert.deepEqual(changedRows(loaded, { ...loaded, effort: 'small' }), { effort: 'small' });
  assert.deepEqual(changedRows(loaded, { ...loaded, lead: 'anthropic/claude-opus-5-5' }), { lead: 'anthropic/claude-opus-5-5' });
  assert.deepEqual(changedRows(loaded, { ...loaded, effort: 'small', lead: 'anthropic/claude-opus-5-5' }),
    { effort: 'small', lead: 'anthropic/claude-opus-5-5' });
});

test('one role change sends that role and nothing else', () => {
  const loaded = fresh();
  const moved = setRoleModel(loaded, 'building', 'bug-fix', 'anthropic/claude-opus-5-5');
  assert.deepEqual(changedRows(loaded, moved), { roles: { building: { 'bug-fix': 'anthropic/claude-opus-5-5' } } });
});

test('a panel that lost one model sends the whole list', () => {
  const loaded = fresh();
  const moved = removePanelModel(loaded, 'panels', 'openai/gpt-6.1-sol', 'arena-runners');
  const flash = 'mastracode/commandcode/deepseek/deepseek-v4.1-flash';
  assert.deepEqual(changedRows(loaded, moved), { roles: { panels: { 'arena-runners': [flash] } } });
});

test('a group model that moved sends every role it moved', () => {
  const loaded = fresh();
  const moved = setGroupModel(loaded, 'judgment', 'anthropic/claude-opus-5-5');
  assert.deepEqual(changedRows(loaded, moved), {
    roles: { judgment: { 'judgment-and-prose': 'anthropic/claude-opus-5-5', 'hardest-tasks': 'anthropic/claude-opus-5-5' } },
  });
});

test('rows the page did not load are ignored rather than sent', () => {
  const loaded = fresh();
  const moved = JSON.parse(JSON.stringify(loaded));
  moved.effort = 'small';
  moved.groups.brandNewGroup = { model: 'openai/gpt-6.1-sol', roles: { 'new-role': 'openai/gpt-6.1-sol' } };
  moved.groups.building.roles['new-role'] = 'openai/gpt-6.1-sol';
  assert.deepEqual(changedRows(loaded, moved), { effort: 'small' });
});

test('applying rows replaces only the rows it names and leaves the choice alone', () => {
  const current = fresh();
  const flash = 'mastracode/commandcode/deepseek/deepseek-v4.1-flash';
  const next = applyRows(current, { effort: 'small', lead: 'anthropic/claude-opus-5-5', roles: { building: { 'bug-fix': 'openai/gpt-6.1-sol' } } });
  assert.equal(next.effort, 'small');
  assert.equal(next.lead, 'anthropic/claude-opus-5-5');
  assert.equal(next.groups.building.roles['bug-fix'], 'openai/gpt-6.1-sol');
  assert.deepEqual(next.groups.judgment, current.groups.judgment);
  assert.deepEqual(next.groups.panels, current.groups.panels);
  assert.equal(current.effort, 'large');
  assert.equal(current.groups.building.roles['bug-fix'], flash);
  assert.notEqual(next.groups.building.roles, current.groups.building.roles);
});

test('a panel row is replaced whole, not merged into the list it lands on', () => {
  const current = fresh();
  const next = applyRows(current, { roles: { panels: { 'arena-runners': ['anthropic/claude-opus-5-5'] } } });
  assert.deepEqual(next.groups.panels.roles['arena-runners'], ['anthropic/claude-opus-5-5']);
  assert.deepEqual(next.groups.panels.roles['architect-runners'], current.groups.panels.roles['architect-runners']);
  assert.deepEqual(next.groups.panels.models, current.groups.panels.models);
});

test('a patch from an older page lands on a newer choice without reverting it', () => {
  const loaded = fresh();
  const newer = setRoleModel(setEffort(loaded, 'small'), 'judgment', 'hardest-tasks', 'anthropic/claude-opus-5-5');
  const page = setRoleModel(loaded, 'building', 'perf-issue', 'openai/gpt-6.1-sol');
  const merged = applyRows(newer, changedRows(loaded, page));
  assert.equal(merged.groups.building.roles['perf-issue'], 'openai/gpt-6.1-sol');
  assert.equal(merged.groups.judgment.roles['hardest-tasks'], 'anthropic/claude-opus-5-5');
  assert.equal(merged.effort, 'small');
});

test('a patch naming a row this build does not have is refused', () => {
  const current = fresh();
  assert.throws(() => applyRows(current, { roles: { nowhere: { 'bug-fix': 'openai/gpt-6.1-sol' } } }), /Unknown group nowhere/);
  assert.throws(() => applyRows(current, { roles: { building: { 'no-such-role': 'openai/gpt-6.1-sol' } } }), /Unknown role no-such-role/);
  assert.throws(() => applyRows(current, { roles: { building: { 'bug-fix': 7 } } }), /one model/);
  assert.throws(() => applyRows(current, { roles: { panels: { 'arena-runners': 'openai/gpt-6.1-sol' } } }), new RegExp(PANEL_MODEL_ONLY));
  assert.throws(() => applyRows(current, null), /object of rows/);
  assert.equal(current.groups.building.roles['bug-fix'], 'mastracode/commandcode/deepseek/deepseek-v4.1-flash');
});

test('an old whole-snapshot save is refused with a reload hint', () => {
  const current = fresh();
  assert.throws(() => applyRows(current, { ...fresh(), card: 'JUL-276' }), { message: STALE_PAGE });
  assert.throws(() => applyRows(current, { groups: {} }), { message: STALE_PAGE });
});
