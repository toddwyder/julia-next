// board-setup.test.mjs -- JUL-97 step 1. Every Linear call goes through a fake
// `graphql` function backed by an in-memory board, so this suite never touches
// the network and a second --apply can be run against the first run's result to
// prove idempotency. The key is supplied through the injected env, never read
// from the real drop box.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boardSetup,
  parseArgs,
  resolveLinearApiKey,
  TEMPLATE_NAME,
} from './board-setup.mjs';
import {
  WORK_VIEW,
  STATUS_LABELS,
  GRAPH_AGENTS,
  defaultLabelsFor,
} from '../graph/board-spec.mjs';

const TEST_TEAM_ID = '31138162-65a4-4dd3-bcc8-6b6ac0709bca';

// A board shaped like a real fresh Julia-next team: the default Linear states
// (before the JUL-97 renames), a couple of labels, no template, no view, and
// two issues that exercise the Work filter.
function freshBoard() {
  return {
    teamId: TEST_TEAM_ID,
    states: [
      { id: 'state-backlog', name: 'Backlog', type: 'backlog', position: 0 },
      { id: 'state-todo', name: 'Todo', type: 'unstarted', position: 1 },
      { id: 'state-in-progress', name: 'In Progress', type: 'started', position: 2 },
      { id: 'state-in-review', name: 'In Review', type: 'started', position: 3 },
      { id: 'state-done', name: 'Done', type: 'completed', position: 4 },
      { id: 'state-canceled', name: 'Canceled', type: 'canceled', position: 5 },
      { id: 'state-duplicate', name: 'Duplicate', type: 'canceled', position: 6 },
    ],
    labels: [
      { id: 'label-orch-model', name: 'Orchestrator model', description: null, isGroup: true, parentId: null },
      { id: 'label-orch-effort', name: 'Orchestrator effort', description: null, isGroup: true, parentId: null },
      { id: 'label-decision', name: 'Decision', description: null, isGroup: false, parentId: null },
      { id: 'label-parent', name: 'Parent', description: null, isGroup: false, parentId: null },
      { id: 'label-opus', name: 'builder-claude-opus', description: null, isGroup: false, parentId: null },
    ],
    templates: [],
    defaultTemplateId: null,
    views: [],
    issues: [
      { id: 'issue-1', labels: ['Decision'] },
      { id: 'issue-2', labels: ['Parent'] },
      { id: 'issue-3', labels: ['needs-info'] },
      { id: 'issue-4', labels: [] },
    ],
  };
}

function operationName(query) {
  return query.match(/\b(?:query|mutation)\s+(\w+)/)?.[1] ?? 'unknown';
}

function makeFakeLinear(initial = freshBoard()) {
  const db = structuredClone(initial);
  const calls = { ops: [], mutations: [] };
  let counter = 0;
  const nextId = (prefix) => `${prefix}-${++counter}`;

  const graphql = async (query, variables = {}) => {
    const op = operationName(query);
    calls.ops.push(op);
    if (/^BoardSetup(Create|Update|Archive|Set)/.test(op)) calls.mutations.push(op);

    const teamPayload = () => ({
      id: db.teamId,
      name: 'Julia-next',
      defaultTemplateForMembers: db.defaultTemplateId ? { id: db.defaultTemplateId } : null,
      states: { nodes: db.states.map((state) => ({ ...state })) },
      labels: {
        nodes: db.labels.map((label) => ({
          id: label.id,
          name: label.name,
          description: label.description ?? null,
          isGroup: label.isGroup ?? false,
          parent: label.parentId ? { id: label.parentId } : null,
        })),
      },
      templates: { nodes: db.templates.map((template) => structuredClone(template)) },
    });

    switch (op) {
      case 'BoardSetupTeam':
        return { team: teamPayload() };
      case 'BoardSetupViews':
        return {
          customViews: {
            nodes: db.views.map((view) => ({ ...view })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        };
      case 'BoardSetupWorkIssues': {
        const matched = db.issues.filter((issue) => {
          const present = new Set(issue.labels ?? []);
          return !WORK_VIEW.excludedLabels.some((label) => present.has(label));
        });
        return {
          issues: { nodes: matched.map((issue) => ({ id: issue.id })), pageInfo: { hasNextPage: false, endCursor: null } },
        };
      }
      case 'BoardSetupCreateState': {
        const state = { id: nextId('state'), ...variables.input };
        db.states.push(state);
        return { workflowStateCreate: { success: true, workflowState: { ...state } } };
      }
      case 'BoardSetupUpdateState': {
        const state = db.states.find((candidate) => candidate.id === variables.id);
        assert.ok(state, `no state ${variables.id}`);
        Object.assign(state, variables.input);
        return { workflowStateUpdate: { success: true, workflowState: { ...state } } };
      }
      case 'BoardSetupCreateLabel': {
        const label = {
          id: nextId('label'),
          name: variables.input.name,
          description: variables.input.description ?? null,
          isGroup: variables.input.isGroup === true,
          parentId: variables.input.parentId ?? null,
        };
        db.labels.push(label);
        return {
          issueLabelCreate: {
            success: true,
            issueLabel: {
              id: label.id,
              name: label.name,
              description: label.description,
              isGroup: label.isGroup,
              parent: label.parentId ? { id: label.parentId } : null,
            },
          },
        };
      }
      case 'BoardSetupUpdateLabel': {
        const label = db.labels.find((candidate) => candidate.id === variables.id);
        assert.ok(label, `no label ${variables.id}`);
        if (variables.input.parentId !== undefined) label.parentId = variables.input.parentId;
        if (variables.input.description !== undefined) label.description = variables.input.description;
        if (variables.input.name !== undefined) label.name = variables.input.name;
        return {
          issueLabelUpdate: {
            success: true,
            issueLabel: { id: label.id, name: label.name, parent: label.parentId ? { id: label.parentId } : null },
          },
        };
      }
      case 'BoardSetupArchiveLabel': {
        const index = db.labels.findIndex((candidate) => candidate.id === variables.id);
        if (index >= 0) db.labels.splice(index, 1);
        return { issueLabelArchive: { success: true } };
      }
      case 'BoardSetupCreateTemplate': {
        const template = {
          id: nextId('template'),
          name: variables.input.name,
          type: variables.input.type,
          templateData: structuredClone(variables.input.templateData),
        };
        db.templates.push(template);
        return { templateCreate: { success: true, template: structuredClone(template) } };
      }
      case 'BoardSetupUpdateTemplate': {
        const template = db.templates.find((candidate) => candidate.id === variables.id);
        assert.ok(template, `no template ${variables.id}`);
        template.templateData = structuredClone(variables.input.templateData);
        return { templateUpdate: { success: true, template: structuredClone(template) } };
      }
      case 'BoardSetupSetDefaultTemplate': {
        db.defaultTemplateId = variables.input.defaultTemplateForMembersId;
        return { teamUpdate: { success: true, team: { id: db.teamId, defaultTemplateForMembers: { id: db.defaultTemplateId } } } };
      }
      case 'BoardSetupCreateView': {
        const view = { id: nextId('view'), name: variables.input.name, url: `https://linear.app/${nextId('view')}` };
        db.views.push(view);
        return { customViewCreate: { success: true, customView: { ...view } } };
      }
      default:
        throw new Error(`fake Linear: unexpected operation ${op}`);
    }
  };

  return { db, calls, graphql };
}

function captureStdout() {
  let out = '';
  return {
    stdout: { write: (chunk) => { out += chunk; } },
    read: () => out,
  };
}

function run(options) {
  const { calls, graphql, db } = makeFakeLinear(options?.board ?? freshBoard());
  const capture = captureStdout();
  return {
    calls,
    db,
    capture,
    result: boardSetup({
      graphql,
      teamId: TEST_TEAM_ID,
      env: { LINEAR_API_KEY: 'test-key' },
      stdout: capture.stdout,
      ...options,
    }),
  };
}

// ---------------------------------------------------------------------------
// Dry run vs apply
// ---------------------------------------------------------------------------

test('a dry run plans actions but performs no mutation and changes nothing', async () => {
  const { calls, db, capture, result } = run({ apply: false });
  const outcome = await result;

  assert.ok(outcome.actions.length > 0, 'a fresh board needs changes');
  assert.deepEqual(calls.mutations, [], 'a dry run must not call a single mutation');
  assert.equal(db.templates.length, 0, 'no template may be created in a dry run');
  assert.equal(db.views.length, 0, 'no view may be created in a dry run');
  assert.equal(db.states.find((state) => state.name === 'Todo').name, 'Todo', 'no state may be renamed in a dry run');
  assert.match(capture.read(), /DRY RUN/);
  assert.match(capture.read(), /EVIDENCE/);
});

test('--apply creates only what is missing and leaves the existing states in place', async () => {
  const { db, calls, result } = run({ apply: true });
  const outcome = await result;

  // The three states that did not exist are created; the four renames are not.
  const created = calls.mutations.filter((op) => op === 'BoardSetupCreateState');
  assert.equal(created.length, 3, 'only Remediation, Staging/smoke test and UAT are new');

  const names = db.states.map((state) => state.name).sort();
  for (const expected of ['Backlog', 'Ready', 'Implementation', 'Code review', 'Remediation', 'Staging/smoke test', 'UAT', 'Complete']) {
    assert.ok(names.includes(expected), `missing state ${expected}`);
  }
  // Canceled and Duplicate are left alone.
  assert.ok(db.states.some((state) => state.name === 'Canceled'));
  assert.ok(db.states.some((state) => state.name === 'Duplicate'));
  assert.ok(outcome.actions.length > 0);
});

test('existing states are renamed, not replaced: the ids survive and no card could be lost', async () => {
  const { db, result } = run({ apply: true });
  await result;
  const byName = new Map(db.states.map((state) => [state.name, state.id]));
  assert.equal(byName.get('Ready'), 'state-todo');
  assert.equal(byName.get('Implementation'), 'state-in-progress');
  assert.equal(byName.get('Code review'), 'state-in-review');
  assert.equal(byName.get('Complete'), 'state-done');
  assert.equal(byName.get('Backlog'), 'state-backlog');
});

test('workflow states get the spec order as positions, from Backlog (0) to Complete (7)', async () => {
  const { db, result } = run({ apply: true });
  await result;
  const position = (name) => db.states.find((state) => state.name === name).position;
  assert.equal(position('Backlog'), 0);
  assert.equal(position('Ready'), 1);
  assert.equal(position('Implementation'), 2);
  assert.equal(position('Code review'), 3);
  assert.equal(position('Remediation'), 4);
  assert.equal(position('Staging/smoke test'), 5);
  assert.equal(position('UAT'), 6);
  assert.equal(position('Complete'), 7);
  // Canceled and Duplicate keep their names but sit AFTER the eight, so the
  // board order is the eight columns and then the terminal states.
  assert.equal(position('Canceled'), 8);
  assert.equal(position('Duplicate'), 9);
});

test('a second --apply is a no-op: no actions, no mutations, no change to the board', async () => {
  const { db, graphql, calls } = makeFakeLinear(freshBoard());
  const firstCapture = captureStdout();
  const first = await boardSetup({
    graphql, teamId: TEST_TEAM_ID, env: { LINEAR_API_KEY: 'k' }, apply: true, stdout: firstCapture.stdout,
  });
  assert.ok(first.actions.length > 0);
  const snapshot = structuredClone(db);
  calls.mutations.length = 0;

  const secondCapture = captureStdout();
  const second = await boardSetup({
    graphql, teamId: TEST_TEAM_ID, env: { LINEAR_API_KEY: 'k' }, apply: true, stdout: secondCapture.stdout,
  });
  assert.deepEqual(second.actions, []);
  assert.deepEqual(calls.mutations, []);
  assert.deepEqual(db, snapshot);
  assert.match(secondCapture.read(), /no changes/);
});

// ---------------------------------------------------------------------------
// Label groups and Status descriptions
// ---------------------------------------------------------------------------

test('--apply creates the Status group with its three described labels', async () => {
  const { db, result } = run({ apply: true });
  await result;
  const group = db.labels.find((label) => label.name === STATUS_LABELS.group);
  assert.ok(group?.isGroup, 'Status must be a label group');
  for (const status of STATUS_LABELS.labels) {
    const child = db.labels.find((label) => label.name === status.name);
    assert.ok(child, `missing Status label ${status.name}`);
    assert.equal(child.parentId, group.id);
    assert.equal(child.description, status.description);
  }
});

test('--apply creates all twelve model/effort groups with their derived children', async () => {
  const { db, result } = run({ apply: true });
  await result;
  for (const agent of GRAPH_AGENTS) {
    for (const groupName of [agent.modelGroup, agent.effortGroup]) {
      const group = db.labels.find((label) => label.name === groupName);
      assert.ok(group?.isGroup, `missing label group ${groupName}`);
      const children = db.labels.filter((label) => label.parentId === group.id);
      assert.ok(children.length > 0, `group ${groupName} has no children`);
    }
  }
});

test('an existing label is moved under the spec group instead of being duplicated', async () => {
  // builder-claude-opus already exists as an ordinary label in freshBoard().
  const { db, result } = run({ apply: true });
  await result;
  const occurrences = db.labels.filter((label) => label.name === 'builder-claude-opus');
  assert.equal(occurrences.length, 1, 'the label must not be duplicated');
  const group = db.labels.find((label) => label.name === 'Feature builder model');
  assert.equal(occurrences[0].parentId, group.id, 'the existing label is re-parented, not recreated');
});

test('the retired orchestrator label groups are archived, not deleted from cards', async () => {
  const { db, calls, result } = run({ apply: true });
  await result;
  assert.ok(!db.labels.some((label) => label.name === 'Orchestrator model'));
  assert.ok(!db.labels.some((label) => label.name === 'Orchestrator effort'));
  assert.equal(calls.mutations.filter((op) => op === 'BoardSetupArchiveLabel').length, 2);
});

// ---------------------------------------------------------------------------
// Template and view
// ---------------------------------------------------------------------------

test('--apply creates the template with every default model and Medium effort label, and sets it as the team default', async () => {
  const { db, result } = run({ apply: true });
  await result;
  const template = db.templates.find((candidate) => candidate.name === TEMPLATE_NAME);
  assert.ok(template, 'the team template must exist');
  assert.equal(db.defaultTemplateId, template.id, 'the template must be the team default');
  const ids = template.templateData.labelIds;
  const idToName = new Map(db.labels.map((label) => [label.id, label.name]));
  const names = ids.map((id) => idToName.get(id)).sort();
  const expected = GRAPH_AGENTS.flatMap((agent) => defaultLabelsFor(agent.key)).sort();
  assert.deepEqual(names, expected);
  assert.equal(names.length, 12);
});

test('--apply creates the Work view whose filter excludes Decision and Parent', async () => {
  const { db, calls, result } = run({ apply: true });
  await result;
  const view = db.views.find((candidate) => candidate.name === WORK_VIEW.name);
  assert.ok(view, 'the Work view must exist');
  assert.ok(view.url, 'the evidence needs a URL');
  const createViewCall = calls.ops.lastIndexOf('BoardSetupCreateView');
  assert.ok(createViewCall >= 0);
});

test('the Work view filter excludes cards carrying Decision or Parent and keeps the rest', async () => {
  const { result } = run({ apply: false });
  const outcome = await result;
  // freshBoard() has 4 issues: Decision, Parent, needs-info, and no labels.
  // Only the last two are work.
  assert.equal(outcome.issueCount, 2);
});

test('the evidence names every state, every label group, the template and the view', async () => {
  const { capture, result } = run({ apply: true });
  await result;
  const evidence = capture.read().slice(capture.read().indexOf('EVIDENCE'));
  assert.match(evidence, /States \(10\):/);
  assert.match(evidence, /Ready \[unstarted\] position 1/);
  assert.match(evidence, /Complete \[completed\] position 7/);
  assert.match(evidence, /Canceled \[canceled\] position 8/);
  assert.match(evidence, /Status/);
  assert.match(evidence, /waiting-on-todd/);
  assert.match(evidence, /Feature builder model/);
  assert.match(evidence, new RegExp(`Template: ${TEMPLATE_NAME} \\(id: template-`));
  assert.match(evidence, /Work view: Work \(id: view-/);
  assert.match(evidence, /Work view matches 2 issue\(s\)/);
});

// ---------------------------------------------------------------------------
// Key handling and argv
// ---------------------------------------------------------------------------

test('resolveLinearApiKey prefers LINEAR_API_KEY and never reads the drop box when it is set', () => {
  const key = resolveLinearApiKey({
    env: { LINEAR_API_KEY: 'env-key' },
    readSecretImpl: () => { throw new Error('must not read the drop box'); },
  });
  assert.equal(key, 'env-key');
});

test('resolveLinearApiKey falls back to the in-process drop-box reader for the linear field', () => {
  const key = resolveLinearApiKey({
    env: {},
    readSecretImpl: (field) => {
      assert.equal(field, 'linear');
      return 'dropbox-key';
    },
  });
  assert.equal(key, 'dropbox-key');
});

test('parseArgs defaults to a dry run and turns on --apply only when asked', () => {
  assert.deepEqual(parseArgs([]), { apply: false, help: false });
  assert.deepEqual(parseArgs(['--apply']), { apply: true, help: false });
  assert.deepEqual(parseArgs(['--help']), { apply: false, help: true });
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});
