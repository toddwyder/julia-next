// board-spec.test.mjs -- JUL-97 step 1. Pure: no I/O, no Linear. Pins the
// board description the setup program plans against: the eight states and
// their order, the rename map (so no card is ever dropped), the label groups
// and their derived children, and the Work view's filter.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TEAM_NAME,
  TEAM_ID,
  WORKFLOW_STATES,
  STATE_RENAMES,
  STATUS_LABELS,
  GRAPH_AGENTS,
  RETIRED_LABEL_GROUPS,
  WORK_VIEW,
  modelLabelsFor,
  effortLabelsFor,
  defaultLabelsFor,
  workViewIssueFilter,
  matchesWorkView,
} from './board-spec.mjs';
import { MODEL_SPECS, DEFAULT_MODEL_SUFFIX_BY_ENTRY } from '../scripts/seat-labels.mjs';
import { SEAT_TABLE } from './seat-table.mjs';

test('the eight workflow states are exactly the ticket\'s, in board order, with the right types and a color each', () => {
  assert.deepEqual(WORKFLOW_STATES.map(({ name, type }) => ({ name, type })), [
    { name: 'Backlog', type: 'backlog' },
    { name: 'Ready', type: 'unstarted' },
    { name: 'Implementation', type: 'started' },
    { name: 'Code review', type: 'started' },
    { name: 'Remediation', type: 'started' },
    { name: 'Staging/smoke test', type: 'started' },
    { name: 'UAT', type: 'started' },
    { name: 'Complete', type: 'completed' },
  ]);
  assert.equal(new Set(WORKFLOW_STATES.map((state) => state.name)).size, 8);
  // WorkflowStateCreateInput.color is required; every state carries a fixed
  // HEX color and no two states reuse one.
  for (const state of WORKFLOW_STATES) {
    assert.match(state.color, /^#[0-9a-f]{6}$/i, `${state.name} has no sensible HEX color`);
  }
  assert.equal(new Set(WORKFLOW_STATES.map((state) => state.color)).size, 8);
});

test('the rename map is exactly the four renames and never mentions Canceled or Duplicate', () => {
  assert.deepEqual(STATE_RENAMES, {
    Todo: 'Ready',
    'In Progress': 'Implementation',
    'In Review': 'Code review',
    Done: 'Complete',
  });
  assert.ok(!Object.hasOwn(STATE_RENAMES, 'Canceled'));
  assert.ok(!Object.hasOwn(STATE_RENAMES, 'Duplicate'));
});

test('every rename target is one of the eight states, so a rename can never point at a state we do not create', () => {
  const names = new Set(WORKFLOW_STATES.map((state) => state.name));
  for (const target of Object.values(STATE_RENAMES)) {
    assert.ok(names.has(target), `rename target '${target}' is not a workflow state`);
  }
});

test('the Status group carries the three described labels, each with a one-line reason', () => {
  assert.equal(STATUS_LABELS.group, 'Status');
  assert.deepEqual(STATUS_LABELS.labels.map((label) => label.name), ['waiting-on-todd', 'blocked', 'stalled']);
  assert.equal(STATUS_LABELS.labels[0].description, 'Assigned to Todd: an account action, a money decision, or a product decision or acceptance');
  assert.equal(STATUS_LABELS.labels[1].description, 'Cannot proceed until a named dependency is resolved');
  assert.equal(STATUS_LABELS.labels[2].description, 'Two review rounds spent without agreement; parked with the reasons on the card');
  for (const label of STATUS_LABELS.labels) {
    assert.ok(label.description.length > 0, `${label.name} has no description`);
    assert.ok(!label.description.includes('\n'), `${label.name} description is not one line`);
  }
});

test('the six graph agents are exactly the ticket\'s keys, codes and group names', () => {
  assert.deepEqual(GRAPH_AGENTS, [
    { key: 'feature-builder', code: 'builder', modelGroup: 'Feature builder model', effortGroup: 'Feature builder effort' },
    { key: 'defect-fixer', code: 'fixer', modelGroup: 'Defect fixer model', effortGroup: 'Defect fixer effort' },
    { key: 'refactor', code: 'refactor', modelGroup: 'Refactor model', effortGroup: 'Refactor effort' },
    { key: 'adversarial-reviewer', code: 'adversary', modelGroup: 'Adversarial reviewer model', effortGroup: 'Adversarial reviewer effort' },
    { key: 'evidence-reviewer', code: 'evidence', modelGroup: 'Evidence reviewer model', effortGroup: 'Evidence reviewer effort' },
    { key: 'consultant', code: 'consultant', modelGroup: 'Consultant model', effortGroup: 'Consultant effort' },
  ]);
});

test('the retired label groups are exactly the two orchestrator groups', () => {
  assert.deepEqual(RETIRED_LABEL_GROUPS, ['Orchestrator model', 'Orchestrator effort']);
});

test('modelLabelsFor derives one label per MODEL_SPECS entry, with the agent code prefix', () => {
  for (const agent of GRAPH_AGENTS) {
    const labels = modelLabelsFor(agent.key);
    assert.deepEqual(labels, Object.keys(MODEL_SPECS).map((suffix) => `${agent.code}-${suffix}`));
    for (const label of labels) {
      assert.ok(label.startsWith(`${agent.code}-`), label);
      assert.ok(!label.includes('-effort-'), `${label} is not an effort label`);
    }
  }
  assert.deepEqual(modelLabelsFor('feature-builder'), [
    'builder-claude-opus',
    'builder-claude-sonnet',
    'builder-claude-haiku',
    'builder-codex',
    'builder-deepseek-pro',
    'builder-deepseek-flash',
    'builder-glm-5.3',
  ]);
});

test('effortLabelsFor derives Low/Medium/High for every agent', () => {
  for (const agent of GRAPH_AGENTS) {
    assert.deepEqual(effortLabelsFor(agent.key), [
      `${agent.code}-effort-low`,
      `${agent.code}-effort-medium`,
      `${agent.code}-effort-high`,
    ]);
  }
});

test('each agent resolves to exactly one default model label and one Medium effort label', () => {
  for (const agent of GRAPH_AGENTS) {
    const defaults = defaultLabelsFor(agent.key);
    assert.equal(defaults.length, 2, `${agent.key} must resolve to two defaults`);
    const [modelLabel, effortLabel] = defaults;
    // Exactly one model label: it is in that agent's catalogue and is not an
    // effort label.
    assert.ok(modelLabelsFor(agent.key).includes(modelLabel), `${modelLabel} is not in ${agent.key}'s model group`);
    assert.equal(effortLabel, `${agent.code}-effort-medium`);
    assert.ok(effortLabelsFor(agent.key).includes(effortLabel));
    // The model label is the seat-table primary's default, not an arbitrary one.
    const entry = SEAT_TABLE[agent.key].primary;
    assert.equal(modelLabel, `${agent.code}-${DEFAULT_MODEL_SUFFIX_BY_ENTRY[entry]}`);
  }
});

test('defaultLabelsFor rejects an unknown agent instead of silently returning nothing', () => {
  assert.throws(() => defaultLabelsFor('does-not-exist'), /unknown graph agent/);
  assert.throws(() => modelLabelsFor('does-not-exist'), /unknown graph agent/);
});

test('the Work view names the team and excludes exactly Decision and Parent', () => {
  assert.equal(WORK_VIEW.name, 'Work');
  assert.equal(WORK_VIEW.team, TEAM_NAME);
  assert.deepEqual(WORK_VIEW.excludedLabels, ['Decision', 'Parent']);
  // The real test of "excludes": a card carrying either label is out, a clean
  // card is in, and the labels are matched by exact name.
  assert.equal(matchesWorkView([]), true);
  assert.equal(matchesWorkView(['ready-for-agent']), true);
  assert.equal(matchesWorkView(['Decision']), false);
  assert.equal(matchesWorkView(['Parent']), false);
  assert.equal(matchesWorkView(['Decision', 'Parent']), false);
  assert.equal(matchesWorkView(['decision']), true, 'names are matched exactly');
  // Mixed labels: one coordinate label among ordinary labels still fails.
  assert.equal(matchesWorkView(['ready-for-agent', 'Decision']), false);
  assert.equal(matchesWorkView(['ready-for-agent', 'Parent']), false);
  assert.equal(matchesWorkView(['ready-for-agent', 'blocked']), true);
});

test('workViewIssueFilter is the team plus an every/nin exclusion of Decision and Parent (Linear has no labels.none)', () => {
  assert.deepEqual(workViewIssueFilter(TEAM_ID), {
    team: { id: { eq: TEAM_ID } },
    labels: { every: { name: { nin: ['Decision', 'Parent'] } } },
  });
  assert.ok(!Object.hasOwn(workViewIssueFilter(TEAM_ID).labels, 'none'), 'labels.none is not part of IssueLabelCollectionFilter');
  // Defaults to the Julia-next team.
  assert.deepEqual(workViewIssueFilter(), workViewIssueFilter(TEAM_ID));
});

test('the team constants are the Julia-next team on the board', () => {
  assert.equal(TEAM_NAME, 'Julia-next');
  assert.equal(TEAM_ID, '31138162-65a4-4dd3-bcc8-6b6ac0709bca');
});
