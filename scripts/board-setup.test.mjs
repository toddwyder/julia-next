// board-setup.test.mjs -- JUL-97 step 1. Every Linear call goes through a fake
// `graphql` function backed by an in-memory board, so this suite never touches
// the network and a second --apply can be run against the first run's result to
// prove idempotency. The key is supplied through the injected env, never read
// from the real drop box.
//
// The fake is deliberately schema-aware and honest:
//   - it rejects a state create with no color and a state update carrying a
//     type, and it rejects unknown mutation names (including issueLabelArchive,
//     which does not exist);
//   - it paginates every connection at 50 records a page, so a >50-label board
//     exercises the real read loop;
//   - it keeps the issue -> state and issue -> label references, so a rename
//     can be shown not to lose a card;
//   - it stores what a view was actually created with, so the filter assertion
//     reads the saved filter rather than recomputing the desired one.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boardSetup,
  parseArgs,
  resolveLinearApiKey,
  redactSecret,
  makeRedactingWriter,
  findBlockingMismatches,
  mismatchMessage,
  planBoardSetup,
  BoardConflictError,
  TEMPLATE_NAME,
} from './board-setup.mjs';
import {
  WORK_VIEW,
  WORKFLOW_STATES,
  STATUS_LABELS,
  GRAPH_AGENTS,
  defaultLabelsFor,
  workViewIssueFilter,
} from '../graph/board-spec.mjs';

const TEST_TEAM_ID = '31138162-65a4-4dd3-bcc8-6b6ac0709bca';
const PAGE_SIZE = 50;

// A board shaped like a real fresh Julia-next team: the default Linear states
// (before the JUL-97 renames), a couple of labels, no template, no view, and
// four issues that exercise the Work filter. The issues carry a stateId, so a
// rename can be shown to keep the card.
function freshBoard() {
  return {
    teamId: TEST_TEAM_ID,
    states: [
      { id: 'state-backlog', name: 'Backlog', type: 'backlog', position: 0, color: '#bec2c8' },
      { id: 'state-todo', name: 'Todo', type: 'unstarted', position: 1, color: '#e2e2e2' },
      { id: 'state-in-progress', name: 'In Progress', type: 'started', position: 2, color: '#f2c94c' },
      { id: 'state-in-review', name: 'In Review', type: 'started', position: 3, color: '#f2994a' },
      { id: 'state-done', name: 'Done', type: 'completed', position: 4, color: '#5e6ad2' },
      { id: 'state-canceled', name: 'Canceled', type: 'canceled', position: 5, color: '#95a2b3' },
      { id: 'state-duplicate', name: 'Duplicate', type: 'canceled', position: 6, color: '#6b6f76' },
    ],
    labels: [
      { id: 'label-orch-model', name: 'Orchestrator model', description: null, isGroup: true, parentId: null, retiredAt: null },
      { id: 'label-orch-effort', name: 'Orchestrator effort', description: null, isGroup: true, parentId: null, retiredAt: null },
      { id: 'label-decision', name: 'Decision', description: null, isGroup: false, parentId: null, retiredAt: null },
      { id: 'label-parent', name: 'Parent', description: null, isGroup: false, parentId: null, retiredAt: null },
      { id: 'label-opus', name: 'builder-claude-opus', description: null, isGroup: false, parentId: null, retiredAt: null },
    ],
    templates: [],
    defaultTemplateId: null,
    views: [],
    issues: [
      { id: 'issue-1', labels: ['Decision'], stateId: 'state-todo' },
      { id: 'issue-2', labels: ['Parent'], stateId: 'state-todo' },
      { id: 'issue-3', labels: ['needs-info'], stateId: 'state-backlog' },
      { id: 'issue-4', labels: [], stateId: 'state-in-progress' },
    ],
  };
}

function operationName(query) {
  return query.match(/\b(?:query|mutation)\s+(\w+)/)?.[1] ?? 'unknown';
}

// The fake's own Relay pagination: 50 records a page, cursor = the next index.
function paginateList(list, after) {
  const start = after ? Number(after) : 0;
  const page = list.slice(start, start + PAGE_SIZE);
  const hasNextPage = start + PAGE_SIZE < list.length;
  return { nodes: page, pageInfo: { hasNextPage, endCursor: hasNextPage ? String(start + PAGE_SIZE) : null } };
}

// Interpret the part of IssueFilter the program actually builds. `every` over
// an empty label set is true (an unlabeled card is work), and a card carrying
// an excluded label fails it. `state.id.eq` is used for the coexistence counts.
function issueMatchesFilter(issue, filter) {
  if (!filter) return true;
  if (filter.team?.id?.eq && filter.team.id.eq !== TEST_TEAM_ID) return false;
  if (filter.state?.id?.eq && issue.stateId !== filter.state.id.eq) return false;
  const nin = filter.labels?.every?.name?.nin;
  if (Array.isArray(nin)) {
    const excluded = new Set(nin);
    if ((issue.labels ?? []).some((name) => excluded.has(name))) return false;
  }
  return true;
}

function makeFakeLinear(initial = freshBoard()) {
  const db = structuredClone(initial);
  const calls = { ops: [], mutations: [] };
  let counter = 0;
  const nextId = (prefix) => `${prefix}-${++counter}`;

  const labelNode = (label) => ({
    id: label.id,
    name: label.name,
    description: label.description ?? null,
    isGroup: label.isGroup ?? false,
    retiredAt: label.retiredAt ?? null,
    parent: label.parentId ? { id: label.parentId } : null,
  });

  const viewNode = (view) => ({
    id: view.id,
    name: view.name,
    url: view.url ?? null,
    description: view.description ?? null,
    filterData: view.filterData === undefined || view.filterData === null ? null : structuredClone(view.filterData),
    shared: view.shared === true,
  });

  const graphql = async (query, variables = {}) => {
    const op = operationName(query);
    calls.ops.push(op);
    if (/^BoardSetup(Create|Update|Retire|Set)/.test(op)) calls.mutations.push(op);

    switch (op) {
      case 'BoardSetupTeam':
        return {
          team: {
            id: db.teamId,
            name: 'Julia-next',
            defaultTemplateForMembers: db.defaultTemplateId ? { id: db.defaultTemplateId } : null,
          },
        };
      case 'BoardSetupStates':
        return { team: { states: paginateList(db.states.map((state) => ({ ...state })), variables.after) } };
      case 'BoardSetupLabels':
        return { team: { labels: paginateList(db.labels.map(labelNode), variables.after) } };
      case 'BoardSetupTemplates':
        return { team: { templates: paginateList(db.templates.map((template) => structuredClone(template)), variables.after) } };
      case 'BoardSetupViews':
        return { customViews: paginateList(db.views.map(viewNode), variables.after) };
      case 'BoardSetupIssues': {
        const matched = db.issues.filter((issue) => issueMatchesFilter(issue, variables.filter));
        return { issues: paginateList(matched.map((issue) => ({ id: issue.id })), variables.after) };
      }
      case 'BoardSetupCreateState': {
        if (!variables.input?.color) {
          throw new Error('fake Linear: WorkflowStateCreateInput.color is required');
        }
        if (!variables.input?.type) {
          throw new Error('fake Linear: WorkflowStateCreateInput.type is required');
        }
        if (db.states.some((state) => state.name === variables.input.name)) {
          throw new Error(`fake Linear: a state named "${variables.input.name}" already exists`);
        }
        const state = { id: nextId('state'), color: null, ...structuredClone(variables.input) };
        db.states.push(state);
        return { workflowStateCreate: { success: true, workflowState: { ...state } } };
      }
      case 'BoardSetupUpdateState': {
        const state = db.states.find((candidate) => candidate.id === variables.id);
        if (!state) throw new Error(`fake Linear: no state ${variables.id}`);
        if (Object.hasOwn(variables.input ?? {}, 'type')) {
          throw new Error('fake Linear: WorkflowStateUpdateInput has no type field');
        }
        Object.assign(state, structuredClone(variables.input));
        return { workflowStateUpdate: { success: true, workflowState: { ...state } } };
      }
      case 'BoardSetupCreateLabel': {
        const input = variables.input ?? {};
        if (!input.name) throw new Error('fake Linear: IssueLabelCreateInput.name is required');
        if (input.isGroup !== true && !input.parentId) {
          throw new Error('fake Linear: a non-group label needs a parentId');
        }
        const label = {
          id: nextId('label'),
          name: input.name,
          description: input.description ?? null,
          isGroup: input.isGroup === true,
          parentId: input.parentId ?? null,
          retiredAt: null,
        };
        db.labels.push(label);
        return { issueLabelCreate: { success: true, issueLabel: labelNode(label) } };
      }
      case 'BoardSetupUpdateLabel': {
        const label = db.labels.find((candidate) => candidate.id === variables.id);
        if (!label) throw new Error(`fake Linear: no label ${variables.id}`);
        if (variables.input.parentId !== undefined) label.parentId = variables.input.parentId;
        if (variables.input.description !== undefined) label.description = variables.input.description;
        if (variables.input.name !== undefined) label.name = variables.input.name;
        return { issueLabelUpdate: { success: true, issueLabel: labelNode(label) } };
      }
      case 'BoardSetupRetireLabel': {
        const label = db.labels.find((candidate) => candidate.id === variables.id);
        if (!label) throw new Error(`fake Linear: no label ${variables.id}`);
        // Linear keeps the label on the board and on the cards that already
        // carry it; retirement only stamps retiredAt.
        label.retiredAt = '2026-09-19T00:00:00.000Z';
        return { issueLabelRetire: { success: true, issueLabel: labelNode(label) } };
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
        if (!template) throw new Error(`fake Linear: no template ${variables.id}`);
        template.templateData = structuredClone(variables.input.templateData);
        return { templateUpdate: { success: true, template: structuredClone(template) } };
      }
      case 'BoardSetupSetDefaultTemplate': {
        db.defaultTemplateId = variables.input.defaultTemplateForMembersId;
        return { teamUpdate: { success: true, team: { id: db.teamId, defaultTemplateForMembers: { id: db.defaultTemplateId } } } };
      }
      case 'BoardSetupCreateView': {
        if (!variables.input?.name) throw new Error('fake Linear: CustomViewCreateInput.name is required');
        const id = nextId('view');
        const view = {
          id,
          name: variables.input.name,
          url: `https://linear.app/view/${id}`,
          description: variables.input.description ?? null,
          filterData: structuredClone(variables.input.filterData ?? null),
          shared: variables.input.shared === true,
        };
        db.views.push(view);
        return { customViewCreate: { success: true, customView: viewNode(view) } };
      }
      case 'BoardSetupUpdateView': {
        const view = db.views.find((candidate) => candidate.id === variables.id);
        if (!view) throw new Error(`fake Linear: no view ${variables.id}`);
        if (variables.input.filterData !== undefined) view.filterData = structuredClone(variables.input.filterData);
        if (variables.input.shared !== undefined) view.shared = variables.input.shared;
        if (variables.input.description !== undefined) view.description = variables.input.description;
        return { customViewUpdate: { success: true, customView: viewNode(view) } };
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

function run(options = {}) {
  const fake = makeFakeLinear(options.board ?? freshBoard());
  const capture = captureStdout();
  return {
    calls: fake.calls,
    db: fake.db,
    capture,
    result: boardSetup({
      graphql: fake.graphql,
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
  // Canceled and Duplicate are left alone -- never moved, never renamed.
  assert.equal(db.states.find((state) => state.name === 'Canceled').position, 5);
  assert.equal(db.states.find((state) => state.name === 'Duplicate').position, 6);
  assert.ok(outcome.actions.length > 0);
});

test('every created state carries a color (WorkflowStateCreateInput.color is required)', async () => {
  const { calls, result } = run({ apply: true });
  await result;
  const stateCreates = calls.ops.filter((op) => op === 'BoardSetupCreateState');
  assert.ok(stateCreates.length > 0);
  // The fake rejects a colorless create, so the apply reaching the end proves
  // every create had one; the spec itself supplies exactly one per state.
  assert.deepEqual(WORKFLOW_STATES.map((state) => state.color), [
    '#bec2c8', '#e2e2e2', '#f2c94c', '#f2994a', '#eb5757', '#bb87fc', '#4ea7fc', '#5e6ad2',
  ]);
});

test('existing states are renamed, not replaced: the ids survive and the cards keep pointing at them', async () => {
  const { db, result } = run({ apply: true });
  await result;
  const byName = new Map(db.states.map((state) => [state.name, state.id]));
  assert.equal(byName.get('Ready'), 'state-todo');
  assert.equal(byName.get('Implementation'), 'state-in-progress');
  assert.equal(byName.get('Code review'), 'state-in-review');
  assert.equal(byName.get('Complete'), 'state-done');
  assert.equal(byName.get('Backlog'), 'state-backlog');
  // The cards that sat in Todo still point at the same state id, now named
  // Ready: a rename cannot lose a card.
  const byId = new Map(db.states.map((state) => [state.id, state.name]));
  for (const issue of db.issues) {
    assert.ok(byId.has(issue.stateId), `issue ${issue.id} points at a missing state`);
  }
  assert.equal(byId.get('state-todo'), 'Ready');
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
  // Canceled and Duplicate are never moved: they keep positions 5 and 6, even
  // though Staging and UAT now sit at the same positions.
  assert.equal(position('Canceled'), 5);
  assert.equal(position('Duplicate'), 6);
});

test('no intermediate plan step puts two of the eight at the same position', () => {
  const board = freshBoard();
  const actions = planBoardSetup(board);
  const eight = new Set(WORKFLOW_STATES.map((state) => state.name));
  const live = new Map(board.states.map((state) => [state.id, { name: state.name, position: state.position }]));
  const check = (step) => {
    const occupied = new Map();
    for (const state of live.values()) {
      if (!eight.has(state.name)) continue;
      if (occupied.has(state.position)) {
        assert.fail(`after ${step}: position ${state.position} holds two of the eight (${occupied.get(state.position)} and ${state.name})`);
      }
      occupied.set(state.position, state.name);
    }
  };
  check('the initial board');
  for (const action of actions) {
    if (action.kind === 'create-state') {
      live.set(`created-${action.name}`, { name: action.name, position: action.position });
    } else if (action.kind === 'update-state') {
      const state = live.get(action.id);
      assert.ok(state, `update for unknown state ${action.id}`);
      if (action.changes.name !== undefined) state.name = action.changes.name;
      if (action.changes.position !== undefined) state.position = action.changes.position;
    }
    check(`${action.kind} ${action.name}`);
  }
  // And the final state is the eight at exactly 0..7.
  check('the final board');
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
  calls.ops.length = 0;

  const secondCapture = captureStdout();
  const second = await boardSetup({
    graphql, teamId: TEST_TEAM_ID, env: { LINEAR_API_KEY: 'k' }, apply: true, stdout: secondCapture.stdout,
  });
  assert.deepEqual(second.actions, []);
  assert.deepEqual(calls.mutations, []);
  assert.deepEqual(db, snapshot);
  assert.match(secondCapture.read(), /no changes/);
  // The 83-label board is read across more than one page; this is what makes
  // the no-op real rather than the accidental result of one short page.
  const labelReads = calls.ops.filter((op) => op === 'BoardSetupLabels').length;
  assert.ok(labelReads >= 2, `expected a paginated label read, saw ${labelReads}`);
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

test('the retired orchestrator label groups are retired with issueLabelRetire, keeping the label and its cards', async () => {
  const board = freshBoard();
  // A card that already carries the retired label: retirement must not strip
  // it from the card.
  board.issues = [{ id: 'issue-orch', labels: ['Orchestrator model'], stateId: 'state-todo' }];
  const { db, calls, result } = run({ board, apply: true });
  await result;
  const model = db.labels.find((label) => label.name === 'Orchestrator model');
  const effort = db.labels.find((label) => label.name === 'Orchestrator effort');
  // Retirement is not deletion: the groups stay on the board with retiredAt.
  assert.ok(model && model.retiredAt, 'Orchestrator model must be retired, not removed');
  assert.ok(effort && effort.retiredAt, 'Orchestrator effort must be retired, not removed');
  assert.deepEqual(
    db.issues.find((issue) => issue.id === 'issue-orch').labels,
    ['Orchestrator model'],
    'a card that already carried the label keeps it',
  );
  assert.equal(calls.mutations.filter((op) => op === 'BoardSetupRetireLabel').length, 2);
  assert.equal(calls.mutations.filter((op) => op === 'BoardSetupArchiveLabel').length, 0, 'there is no issueLabelArchive mutation');
});

test('a second apply does not retire an already-retired group again', async () => {
  const { db, graphql, calls } = makeFakeLinear(freshBoard());
  await boardSetup({ graphql, teamId: TEST_TEAM_ID, env: { LINEAR_API_KEY: 'k' }, apply: true, stdout: { write() {} } });
  calls.mutations.length = 0;
  const second = await boardSetup({ graphql, teamId: TEST_TEAM_ID, env: { LINEAR_API_KEY: 'k' }, apply: true, stdout: { write() {} } });
  assert.deepEqual(second.actions, []);
  assert.equal(calls.mutations.filter((op) => op === 'BoardSetupRetireLabel').length, 0);
  assert.ok(db.labels.find((label) => label.name === 'Orchestrator model').retiredAt);
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

test('--apply creates the Work view with the spec filter and shared: true (the stored view, not the desired one)', async () => {
  const { db, result } = run({ apply: true });
  await result;
  const view = db.views.find((candidate) => candidate.name === WORK_VIEW.name);
  assert.ok(view, 'the Work view must exist');
  assert.ok(view.url, 'the evidence needs a URL');
  // Read what the view was actually created with.
  assert.deepEqual(view.filterData, workViewIssueFilter(TEST_TEAM_ID));
  assert.equal(view.shared, true, 'the Work view must be shared with everyone');
});

test('a preexisting Work view with the wrong filter is updated, not accepted by name', async () => {
  const board = freshBoard();
  board.views.push({
    id: 'view-work',
    name: WORK_VIEW.name,
    url: 'https://linear.app/view/existing',
    description: 'stale',
    filterData: { team: { id: { eq: TEST_TEAM_ID } } }, // no label exclusion at all
    shared: true,
  });
  const { db, result } = run({ board, apply: true });
  await result;
  const view = db.views.find((candidate) => candidate.name === WORK_VIEW.name);
  assert.equal(view.id, 'view-work', 'the existing view is updated, not duplicated');
  assert.equal(db.views.filter((candidate) => candidate.name === WORK_VIEW.name).length, 1);
  assert.deepEqual(view.filterData, workViewIssueFilter(TEST_TEAM_ID), 'the saved filter is repaired');
  assert.equal(view.shared, true);
});

test('a preexisting private Work view is made shared', async () => {
  const board = freshBoard();
  board.views.push({
    id: 'view-work',
    name: WORK_VIEW.name,
    url: 'https://linear.app/view/existing',
    description: WORK_VIEW.description,
    filterData: workViewIssueFilter(TEST_TEAM_ID),
    shared: false,
  });
  const { db, result } = run({ board, apply: true });
  await result;
  const view = db.views.find((candidate) => candidate.name === WORK_VIEW.name);
  assert.equal(view.shared, true, 'a private view does not satisfy the spec');
});

test('the evidence count comes from the SAVED view filter, not a separately built desired filter', async () => {
  const board = freshBoard();
  // A saved view that excludes needs-info as well: with this filter only
  // issue-4 (no labels) matches, so the count must be 1, not the desired 2.
  board.views.push({
    id: 'view-work',
    name: WORK_VIEW.name,
    url: 'https://linear.app/view/existing',
    description: 'wrong filter',
    filterData: {
      team: { id: { eq: TEST_TEAM_ID } },
      labels: { every: { name: { nin: ['Decision', 'Parent', 'needs-info'] } } },
    },
    shared: true,
  });
  const { capture, result } = run({ board, apply: false });
  const outcome = await result;
  assert.equal(outcome.issueCount, 1, 'the saved (wrong) filter is what the evidence counts with');
  assert.match(capture.read(), /counted with the saved view's filter/);
  // The plan still wants to repair the saved filter.
  assert.ok(outcome.actions.some((action) => action.kind === 'update-view'));
});

test('the Work view filter excludes cards carrying Decision or Parent and keeps the rest', async () => {
  const { result } = run({ apply: false });
  const outcome = await result;
  // freshBoard() has 4 issues: Decision, Parent, needs-info, and no labels.
  // Only the last two are work. The dry run has no saved view, so the desired
  // filter is used and the evidence says so.
  assert.equal(outcome.issueCount, 2);
});

test('a filter rejected at apply time propagates the exact API error and is never swallowed', async () => {
  const fake = makeFakeLinear(freshBoard());
  const base = fake.graphql;
  const rejection = 'Linear API error: 400 {"errors":[{"message":"Unknown argument \\"none\\" on field IssueLabelCollectionFilter"}]}';
  const graphql = async (query, variables, opts) => {
    if (operationName(query) === 'BoardSetupCreateView') throw new Error(rejection);
    return base(query, variables, opts);
  };
  await assert.rejects(
    boardSetup({
      graphql,
      teamId: TEST_TEAM_ID,
      env: { LINEAR_API_KEY: 'test-key' },
      apply: true,
      stdout: { write() {} },
    }),
    (error) => {
      assert.equal(error.message, rejection, 'the exact API error must surface unchanged');
      return true;
    },
  );
});

test('the evidence names every state, every label group, the template, the view and any position collision', async () => {
  const { capture, result } = run({ apply: true });
  await result;
  const evidence = capture.read().slice(capture.read().indexOf('EVIDENCE'));
  assert.match(evidence, /States \(10\):/);
  assert.match(evidence, /Ready \[unstarted\] position 1/);
  assert.match(evidence, /Complete \[completed\] position 7/);
  assert.match(evidence, /Canceled \[canceled\] position 5/);
  assert.match(evidence, /Position collisions \(excluded states are left where they are\):/);
  assert.match(evidence, /position 5: Canceled, Staging\/smoke test/);
  assert.match(evidence, /Status/);
  assert.match(evidence, /waiting-on-todd/);
  assert.match(evidence, /Feature builder model/);
  assert.match(evidence, /Orchestrator model \(retired\)/);
  assert.match(evidence, new RegExp(`Template: ${TEMPLATE_NAME} \\(id: template-`));
  assert.match(evidence, /Work view: Work \(id: view-\d+, url: https:\/\/linear\.app\/view\/view-\d+, shared\)/);
  assert.match(evidence, /Work view matches 2 issue\(s\)/);
});

// ---------------------------------------------------------------------------
// Blocking mismatches (findings 1, 7, 8)
// ---------------------------------------------------------------------------

test('both an old state name and its new name present is a blocking conflict: reported with card counts, no mutation', async () => {
  const board = freshBoard();
  board.states.push({ id: 'state-ready', name: 'Ready', type: 'unstarted', position: 7, color: '#e2e2e2' });
  board.issues = [
    { id: 't1', labels: [], stateId: 'state-todo' },
    { id: 't2', labels: [], stateId: 'state-todo' },
    { id: 'r1', labels: [], stateId: 'state-ready' },
  ];
  const { calls, result } = run({ board, apply: true });
  await assert.rejects(result, (error) => {
    assert.ok(error instanceof BoardConflictError);
    assert.match(error.message, /state "Todo" \(2 card\(s\)\) and state "Ready" \(1 card\(s\)\) both exist/);
    return true;
  });
  assert.deepEqual(calls.mutations, [], 'a conflict must be detected before any mutation');
});

test('an existing state with the wrong type is a blocking mismatch, not an attempted repair', async () => {
  const board = freshBoard();
  // Ready exists but with the wrong type; WorkflowStateUpdateInput cannot fix
  // it, so the program must stop.
  board.states = board.states.filter((state) => state.name !== 'Todo');
  board.states.push({ id: 'state-ready', name: 'Ready', type: 'started', position: 1, color: '#e2e2e2' });
  const { calls, result } = run({ board, apply: true });
  await assert.rejects(result, (error) => {
    assert.ok(error instanceof BoardConflictError);
    assert.match(error.message, /state "Ready" has type "started" but the spec needs "unstarted"/);
    return true;
  });
  assert.deepEqual(calls.mutations, []);
});

test('a label with a wanted group name that is not a group is a blocking mismatch', async () => {
  const board = freshBoard();
  board.labels.push({ id: 'label-status-flat', name: 'Status', description: null, isGroup: false, parentId: null, retiredAt: null });
  const { calls, result } = run({ board, apply: true });
  await assert.rejects(result, (error) => {
    assert.ok(error instanceof BoardConflictError);
    assert.match(error.message, /label "Status" exists but is not a label group/);
    return true;
  });
  assert.deepEqual(calls.mutations, []);
});

test('findBlockingMismatches and mismatchMessage describe each mismatch in one place', () => {
  const board = freshBoard();
  board.states.push({ id: 'state-ready', name: 'Ready', type: 'unstarted', position: 7, color: '#e2e2e2' });
  const mismatches = findBlockingMismatches(board);
  assert.equal(mismatches.length, 1);
  const message = mismatchMessage(mismatches[0], { issueCountByStateId: { 'state-todo': 4, 'state-ready': 2 } });
  assert.match(message, /Todo" \(4 card\(s\)\)/);
  assert.match(message, /Ready" \(2 card\(s\)\)/);
  assert.match(message, /renaming either would strand/);
});

// ---------------------------------------------------------------------------
// Secret redaction (finding 9)
// ---------------------------------------------------------------------------

test('redactSecret replaces every occurrence of the resolved key and leaves other text alone', () => {
  const key = 'lin_api_synthetic_secret_1234567890';
  const text = `Linear API error: 401 {"errors":[{"message":"bad key ${key}"}]} (again: ${key})`;
  const redacted = redactSecret(text, key);
  assert.ok(!redacted.includes(key), 'the key must not survive redaction');
  assert.equal((redacted.match(/\[redacted\]/g) ?? []).length, 2);
  assert.match(redacted, /Linear API error: 401/);
});

test('makeRedactingWriter redacts the key from every stdout chunk', () => {
  const key = 'lin_api_synthetic_secret_9876543210';
  let out = '';
  const writer = makeRedactingWriter({ write: (chunk) => { out += chunk; } }, key);
  writer.write(`before ${key} after`);
  assert.ok(!out.includes(key), 'the key must never reach the underlying writer');
  assert.match(out, /before \[redacted\] after/);
});

test('a transport error that echoes the key is redacted before boardSetup rethrows/reports it', async () => {
  const key = 'lin_api_synthetic_secret_1234567890';
  const graphql = async () => {
    // This is the shape scripts/linear-cli.mjs produces: it embeds the raw
    // upstream body, which can echo the key back.
    throw new Error(`Linear API error: 401 {"errors":[{"message":"invalid api key ${key}"}]}`);
  };
  const capture = captureStdout();
  await assert.rejects(
    boardSetup({ graphql, teamId: TEST_TEAM_ID, apiKey: key, stdout: capture.stdout }),
    (error) => {
      // The raw error still carries the key for a programmatic caller, but the
      // program's own stdout never printed it.
      assert.ok(error.message.includes(key));
      assert.ok(!capture.read().includes(key), 'the key must never reach stdout');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Fake honesty (finding 10)
// ---------------------------------------------------------------------------

test('the fake rejects a state create with no color', async () => {
  const { graphql } = makeFakeLinear();
  await assert.rejects(
    () => graphql('mutation BoardSetupCreateState($input: WorkflowStateCreateInput!) { x }', {
      input: { teamId: TEST_TEAM_ID, name: 'Colorless', type: 'started', position: 1 },
    }),
    /color is required/,
  );
});

test('the fake rejects an update-state carrying a type (WorkflowStateUpdateInput has none)', async () => {
  const { graphql } = makeFakeLinear();
  await assert.rejects(
    () => graphql('mutation BoardSetupUpdateState($id: String!, $input: WorkflowStateUpdateInput!) { x }', {
      id: 'state-todo', input: { type: 'started' },
    }),
    /no type field/,
  );
});

test('the fake rejects the nonexistent issueLabelArchive operation', async () => {
  const { graphql } = makeFakeLinear();
  await assert.rejects(
    () => graphql('mutation BoardSetupArchiveLabel($id: String!) { x }', { id: 'label-orch-model' }),
    /unexpected operation BoardSetupArchiveLabel/,
  );
});

test('the fake rejects an unknown mutation name', async () => {
  const { graphql } = makeFakeLinear();
  await assert.rejects(
    () => graphql('mutation BoardSetupSomethingElse { x }', {}),
    /unexpected operation/,
  );
});

test('the fake paginates its own responses at 50 records a page', async () => {
  const board = freshBoard();
  for (let i = 0; i < 60; i += 1) {
    board.labels.push({ id: `extra-${i}`, name: `extra-label-${i}`, description: null, isGroup: false, parentId: null, retiredAt: null });
  }
  const { graphql } = makeFakeLinear(board);
  const first = await graphql('query BoardSetupLabels($teamId: String!, $after: String) { x }', { teamId: TEST_TEAM_ID });
  assert.equal(first.team.labels.nodes.length, 50);
  assert.equal(first.team.labels.pageInfo.hasNextPage, true);
  const second = await graphql('query BoardSetupLabels($teamId: String!, $after: String) { x }', {
    teamId: TEST_TEAM_ID, after: first.team.labels.pageInfo.endCursor,
  });
  assert.ok(second.team.labels.nodes.length > 0);
  assert.equal(second.team.labels.pageInfo.hasNextPage, false);
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
