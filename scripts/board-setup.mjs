#!/usr/bin/env node
// board-setup.mjs -- JUL-97 step 1: make the real Julia-next Linear board
// match graph/board-spec.mjs. One idempotent program: it reads the board,
// plans the difference from the spec, prints the plan, and -- only with
// --apply -- performs it. A second --apply on an already-correct board finds
// nothing to do.
//
// Two things are deliberate:
//
//  - Everything is matched BY NAME first. A state called "Todo" is renamed to
//    "Ready" (same id, so every card in it survives); a state already called
//    "Ready" is left alone; only a name that exists nowhere is created.
//  - The default mode is a dry run. The board is Todd's, and a program that
//    edits it should have to be asked twice.
//
// The Linear key is read in process only -- from LINEAR_API_KEY or, failing
// that, the protected drop box via read-secret.mjs. It is never an argv entry,
// never a shell string, and never printed. That is the same rule
// scripts/ready-queue.mjs follows.
//
// Everything goes through the injected `graphql` function, so the unit tests
// exercise the plan/apply loop with an in-memory board and never touch the
// network.
import { pathToFileURL } from 'node:url';

import { linearGraphQL } from './linear-cli.mjs';
import { readSecret } from '../ops/service-dropbox/read-secret.mjs';
import {
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
} from '../graph/board-spec.mjs';

// The team template every new card starts from. Named so the setup can find it
// again on the next run.
export const TEMPLATE_NAME = 'Julia-next agent defaults';

// ---------------------------------------------------------------------------
// Key handling
// ---------------------------------------------------------------------------

export function resolveLinearApiKey({ env = process.env, readSecretImpl = readSecret } = {}) {
  if (env.LINEAR_API_KEY) return env.LINEAR_API_KEY;
  return readSecretImpl('linear');
}

// ---------------------------------------------------------------------------
// Linear documents. Every operation has a `BoardSetup`-prefixed name so a test
// fake (and a human reading a log) can tell them apart without parsing
// variables.
// ---------------------------------------------------------------------------

const TEAM_QUERY = `
  query BoardSetupTeam($teamId: String!) {
    team(id: $teamId) {
      id
      name
      defaultTemplateForMembers { id }
      states { nodes { id name type position } }
      labels { nodes { id name description isGroup parent { id } } }
      templates { nodes { id name type templateData } }
    }
  }
`;

// Saved views are not part of the team payload in Linear, so they are read
// separately and matched by name like everything else.
const VIEWS_QUERY = `
  query BoardSetupViews($teamId: String!) {
    customViews(filter: { team: { id: { eq: $teamId } } }, first: 100) {
      nodes { id name url }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ISSUES_QUERY = `
  query BoardSetupWorkIssues($filter: IssueFilter, $after: String) {
    issues(filter: $filter, first: 100, after: $after) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CREATE_STATE_MUTATION = `
  mutation BoardSetupCreateState($input: WorkflowStateCreateInput!) {
    workflowStateCreate(input: $input) {
      success
      workflowState { id name type position }
    }
  }
`;

const UPDATE_STATE_MUTATION = `
  mutation BoardSetupUpdateState($id: String!, $input: WorkflowStateUpdateInput!) {
    workflowStateUpdate(id: $id, input: $input) {
      success
      workflowState { id name type position }
    }
  }
`;

const CREATE_LABEL_MUTATION = `
  mutation BoardSetupCreateLabel($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
      success
      issueLabel { id name description isGroup parent { id } }
    }
  }
`;

const UPDATE_LABEL_MUTATION = `
  mutation BoardSetupUpdateLabel($id: String!, $input: IssueLabelUpdateInput!) {
    issueLabelUpdate(id: $id, input: $input) {
      success
      issueLabel { id name description isGroup parent { id } }
    }
  }
`;

const ARCHIVE_LABEL_MUTATION = `
  mutation BoardSetupArchiveLabel($id: String!) {
    issueLabelArchive(id: $id) { success }
  }
`;

const CREATE_TEMPLATE_MUTATION = `
  mutation BoardSetupCreateTemplate($input: TemplateCreateInput!) {
    templateCreate(input: $input) {
      success
      template { id name type templateData }
    }
  }
`;

const UPDATE_TEMPLATE_MUTATION = `
  mutation BoardSetupUpdateTemplate($id: String!, $input: TemplateUpdateInput!) {
    templateUpdate(id: $id, input: $input) {
      success
      template { id name type templateData }
    }
  }
`;

// `defaultTemplateForMembersId` is the team setting Linear's UI calls
// "Default template for members". The update is idempotent because the plan
// only emits it when the live team points somewhere else.
const SET_DEFAULT_TEMPLATE_MUTATION = `
  mutation BoardSetupSetDefaultTemplate($id: String!, $input: TeamUpdateInput!) {
    teamUpdate(id: $id, input: $input) {
      success
      team { id defaultTemplateForMembers { id } }
    }
  }
`;

const CREATE_VIEW_MUTATION = `
  mutation BoardSetupCreateView($input: CustomViewCreateInput!) {
    customViewCreate(input: $input) {
      success
      customView { id name url }
    }
  }
`;

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------

function assertSuccess(payload, what) {
  if (!payload || payload.success === false) {
    throw new Error(`board-setup: Linear did not confirm ${what}`);
  }
  return payload;
}

// Turn the two read queries into the small, flat shape the pure planner
// reasons about. Anything Linear does not return is simply absent.
export async function loadBoard({ graphql, apiKey, teamId = TEAM_ID } = {}) {
  const callOpts = { apiKey };
  const data = await graphql(TEAM_QUERY, { teamId }, callOpts);
  const team = data?.team;
  if (!team) {
    throw new Error(`board-setup: no Linear team with id ${teamId}`);
  }
  const viewData = await graphql(VIEWS_QUERY, { teamId }, callOpts);
  return {
    teamId,
    name: team.name ?? null,
    defaultTemplateId: team.defaultTemplateForMembers?.id ?? null,
    states: (team.states?.nodes ?? []).map((state) => ({
      id: state.id,
      name: state.name,
      type: state.type,
      position: Number(state.position),
    })),
    labels: (team.labels?.nodes ?? []).map((label) => ({
      id: label.id,
      name: label.name,
      description: label.description ?? null,
      isGroup: label.isGroup === true,
      parentId: label.parent?.id ?? null,
    })),
    templates: (team.templates?.nodes ?? []).map((template) => ({
      id: template.id,
      name: template.name,
      type: template.type,
      templateData: template.templateData ?? null,
    })),
    views: (viewData?.customViews?.nodes ?? []).map((view) => ({
      id: view.id,
      name: view.name,
      url: view.url ?? null,
    })),
  };
}

// The issue count the evidence reports. Pages until Linear says there are no
// more; a 100-page cap keeps a pathological filter from looping forever.
export async function countWorkViewIssues({ graphql, apiKey, teamId = TEAM_ID } = {}) {
  const filter = workViewIssueFilter(teamId);
  let after = null;
  let count = 0;
  for (let page = 0; page < 100; page += 1) {
    const data = await graphql(ISSUES_QUERY, { filter, after }, { apiKey });
    const connection = data?.issues;
    count += connection?.nodes?.length ?? 0;
    if (!connection?.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Planning (pure)
// ---------------------------------------------------------------------------

// Every label group the spec wants, with the children it wants under it. The
// Status group first, then each agent's model and effort groups; the order is
// the order the setup applies them, so a parent always exists before its
// children.
export function desiredLabelGroups() {
  const groups = [{
    name: STATUS_LABELS.group,
    children: STATUS_LABELS.labels.map((label) => ({ name: label.name, description: label.description })),
  }];
  for (const agent of GRAPH_AGENTS) {
    groups.push({
      name: agent.modelGroup,
      children: modelLabelsFor(agent.key).map((name) => ({ name, description: null })),
    });
    groups.push({
      name: agent.effortGroup,
      children: effortLabelsFor(agent.key).map((name) => ({ name, description: null })),
    });
  }
  return groups;
}

// The label names the team template pre-applies: every agent's seat-table
// default model plus Medium effort.
export function templateLabelNames() {
  return GRAPH_AGENTS.flatMap((agent) => defaultLabelsFor(agent.key));
}

function findRenameSource(statesByName, targetName) {
  for (const [from, to] of Object.entries(STATE_RENAMES)) {
    if (to === targetName && statesByName.has(from)) return statesByName.get(from);
  }
  return null;
}

// The pure diff: given a board (the shape loadBoard returns), list the actions
// that would make it match the spec. An empty list means the board is already
// correct -- the property a second --apply relies on. No I/O.
export function planBoardSetup(board) {
  const actions = [];

  const statesByName = new Map(board.states.map((state) => [state.name, state]));
  const claimedStateIds = new Set();
  WORKFLOW_STATES.forEach((state, index) => {
    const position = index;
    // Match the target name first (a previous run already renamed it), then
    // the old name it may still carry. This is the "rename, never replace"
    // rule: the found state keeps its id and every card in it.
    const existing = statesByName.get(state.name) ?? findRenameSource(statesByName, state.name);
    if (!existing) {
      actions.push({ kind: 'create-state', name: state.name, type: state.type, position });
      return;
    }
    claimedStateIds.add(existing.id);
    const changes = {};
    if (existing.name !== state.name) changes.name = state.name;
    if (existing.type !== state.type) changes.type = state.type;
    if (Number(existing.position) !== position) changes.position = position;
    if (Object.keys(changes).length > 0) {
      actions.push({
        kind: 'update-state',
        id: existing.id,
        currentName: existing.name,
        name: state.name,
        changes,
      });
    }
  });

  // States that are not one of the eight (Canceled, Duplicate, any other
  // custom state) are never renamed, but they must not sit BETWEEN the eight
  // columns either -- that would make the board order lie. Any such state
  // still inside the eight's 0..7 range is moved past every existing state,
  // preserving its name and every card in it.
  const maxExistingPosition = board.states.reduce((max, state) => {
    const value = Number(state.position);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, WORKFLOW_STATES.length - 1);
  let nextPosition = Math.max(WORKFLOW_STATES.length, maxExistingPosition + 1);
  const unclaimed = board.states
    .filter((state) => !claimedStateIds.has(state.id))
    .sort((a, b) => Number(a.position) - Number(b.position));
  for (const state of unclaimed) {
    if (Number(state.position) < WORKFLOW_STATES.length) {
      actions.push({
        kind: 'update-state',
        id: state.id,
        currentName: state.name,
        name: state.name,
        changes: { position: nextPosition },
      });
      nextPosition += 1;
    }
  }

  const labelsByName = new Map(board.labels.map((label) => [label.name, label]));
  const labelNameById = new Map(board.labels.map((label) => [label.id, label.name]));
  for (const group of desiredLabelGroups()) {
    const groupLabel = labelsByName.get(group.name);
    if (!groupLabel) {
      actions.push({ kind: 'create-label-group', name: group.name });
    }
    for (const child of group.children) {
      const existing = labelsByName.get(child.name);
      if (!existing) {
        actions.push({
          kind: 'create-label',
          name: child.name,
          description: child.description ?? null,
          parentName: group.name,
        });
        continue;
      }
      const changes = {};
      const currentParentName = existing.parentId ? (labelNameById.get(existing.parentId) ?? null) : null;
      if (currentParentName !== group.name) changes.parentName = group.name;
      // A spec'd description (the Status labels) must match; a null one means
      // "the spec does not care", so an existing description is left alone.
      if (child.description != null && existing.description !== child.description) {
        changes.description = child.description;
      }
      if (Object.keys(changes).length > 0) {
        actions.push({ kind: 'update-label', id: existing.id, name: child.name, changes });
      }
    }
  }

  const defaultLabels = templateLabelNames();
  const template = board.templates.find((candidate) => candidate.name === TEMPLATE_NAME);
  if (!template) {
    actions.push({ kind: 'create-template', name: TEMPLATE_NAME, labelNames: defaultLabels });
    actions.push({ kind: 'set-default-template', templateName: TEMPLATE_NAME });
  } else {
    const existingIds = new Set((template.templateData?.labelIds ?? []).map(String));
    const desiredIds = defaultLabels.map((name) => labelsByName.get(name)?.id);
    const allPresent = desiredIds.every(Boolean);
    const sameLabels = allPresent
      && existingIds.size === desiredIds.length
      && desiredIds.every((id) => existingIds.has(id));
    if (!sameLabels) {
      actions.push({ kind: 'update-template', id: template.id, name: template.name, labelNames: defaultLabels });
    }
    if (board.defaultTemplateId !== template.id) {
      actions.push({ kind: 'set-default-template', templateName: TEMPLATE_NAME });
    }
  }

  for (const name of RETIRED_LABEL_GROUPS) {
    const existing = labelsByName.get(name);
    if (existing?.isGroup) {
      actions.push({ kind: 'archive-label', id: existing.id, name });
    }
  }

  if (!board.views.some((view) => view.name === WORK_VIEW.name)) {
    actions.push({
      kind: 'create-view',
      name: WORK_VIEW.name,
      description: WORK_VIEW.description,
      filterData: workViewIssueFilter(board.teamId),
    });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

function resolveIds(names, labelIdByName) {
  return names.map((name) => {
    const id = labelIdByName.get(name);
    if (!id) throw new Error(`board-setup: cannot resolve the id of label "${name}" for the team template`);
    return id;
  });
}

// Execute the actions in order. Ids minted during this run (new groups, the
// new template) are added to the lookup maps as we go, so a child or a
// template always resolves its parent even on the very first apply.
export async function applyBoardSetup(actions, {
  graphql,
  apiKey,
  teamId = TEAM_ID,
  board,
} = {}) {
  const callOpts = { apiKey };
  const labelIdByName = new Map(board.labels.map((label) => [label.name, label.id]));
  const groupIdByName = new Map(board.labels.filter((label) => label.isGroup).map((label) => [label.name, label.id]));
  const templateIdByName = new Map(board.templates.map((template) => [template.name, template.id]));

  for (const action of actions) {
    switch (action.kind) {
      case 'create-state': {
        const data = await graphql(CREATE_STATE_MUTATION, {
          input: { teamId, name: action.name, type: action.type, position: action.position },
        }, callOpts);
        assertSuccess(data.workflowStateCreate, `creating workflow state "${action.name}"`);
        break;
      }
      case 'update-state': {
        const input = {};
        if (action.changes.name !== undefined) input.name = action.changes.name;
        if (action.changes.type !== undefined) input.type = action.changes.type;
        if (action.changes.position !== undefined) input.position = action.changes.position;
        const data = await graphql(UPDATE_STATE_MUTATION, { id: action.id, input }, callOpts);
        assertSuccess(data.workflowStateUpdate, `updating workflow state "${action.currentName}"`);
        break;
      }
      case 'create-label-group': {
        const data = await graphql(CREATE_LABEL_MUTATION, {
          input: { teamId, name: action.name, isGroup: true },
        }, callOpts);
        const payload = assertSuccess(data.issueLabelCreate, `creating label group "${action.name}"`);
        const id = payload.issueLabel.id;
        labelIdByName.set(action.name, id);
        groupIdByName.set(action.name, id);
        break;
      }
      case 'create-label': {
        const parentId = groupIdByName.get(action.parentName) ?? labelIdByName.get(action.parentName);
        if (!parentId) throw new Error(`board-setup: label group "${action.parentName}" does not exist for "${action.name}"`);
        const input = { teamId, name: action.name, parentId };
        if (action.description != null) input.description = action.description;
        const data = await graphql(CREATE_LABEL_MUTATION, { input }, callOpts);
        const payload = assertSuccess(data.issueLabelCreate, `creating label "${action.name}"`);
        labelIdByName.set(action.name, payload.issueLabel.id);
        break;
      }
      case 'update-label': {
        const input = {};
        if (action.changes.parentName !== undefined) {
          const parentId = groupIdByName.get(action.changes.parentName) ?? labelIdByName.get(action.changes.parentName);
          if (!parentId) throw new Error(`board-setup: label group "${action.changes.parentName}" does not exist for "${action.name}"`);
          input.parentId = parentId;
        }
        if (action.changes.description !== undefined) input.description = action.changes.description;
        const data = await graphql(UPDATE_LABEL_MUTATION, { id: action.id, input }, callOpts);
        assertSuccess(data.issueLabelUpdate, `updating label "${action.name}"`);
        break;
      }
      case 'archive-label': {
        const data = await graphql(ARCHIVE_LABEL_MUTATION, { id: action.id }, callOpts);
        assertSuccess(data.issueLabelArchive, `retiring label group "${action.name}"`);
        break;
      }
      case 'create-template': {
        const labelIds = resolveIds(action.labelNames, labelIdByName);
        const data = await graphql(CREATE_TEMPLATE_MUTATION, {
          input: { teamId, name: action.name, type: 'issue', templateData: { labelIds, teamId } },
        }, callOpts);
        const payload = assertSuccess(data.templateCreate, `creating team template "${action.name}"`);
        templateIdByName.set(action.name, payload.template.id);
        break;
      }
      case 'update-template': {
        const labelIds = resolveIds(action.labelNames, labelIdByName);
        const data = await graphql(UPDATE_TEMPLATE_MUTATION, {
          id: action.id,
          input: { templateData: { labelIds, teamId } },
        }, callOpts);
        assertSuccess(data.templateUpdate, `updating team template "${action.name}"`);
        break;
      }
      case 'set-default-template': {
        const templateId = templateIdByName.get(action.templateName);
        if (!templateId) throw new Error(`board-setup: template "${action.templateName}" does not exist to set as default`);
        const data = await graphql(SET_DEFAULT_TEMPLATE_MUTATION, {
          id: teamId,
          input: { defaultTemplateForMembersId: templateId },
        }, callOpts);
        assertSuccess(data.teamUpdate, `setting the team default template to "${action.templateName}"`);
        break;
      }
      case 'create-view': {
        const data = await graphql(CREATE_VIEW_MUTATION, {
          input: {
            teamId,
            name: action.name,
            description: action.description,
            filterData: action.filterData,
          },
        }, callOpts);
        assertSuccess(data.customViewCreate, `creating the saved view "${action.name}"`);
        break;
      }
      default:
        throw new Error(`board-setup: unknown action kind '${action.kind}'`);
    }
  }
  return actions.length;
}

// ---------------------------------------------------------------------------
// Describing what will happen, and the evidence afterwards
// ---------------------------------------------------------------------------

function describeChanges(changes) {
  return Object.entries(changes).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ');
}

export function describeAction(action) {
  switch (action.kind) {
    case 'create-state':
      return `create workflow state "${action.name}" (type ${action.type}) at position ${action.position}`;
    case 'update-state':
      return `update workflow state "${action.currentName}" -> "${action.name}" [${describeChanges(action.changes)}]`;
    case 'create-label-group':
      return `create label group "${action.name}"`;
    case 'create-label':
      return `create label "${action.name}" under "${action.parentName}"${action.description ? ` -- ${action.description}` : ''}`;
    case 'update-label':
      return `update label "${action.name}" [${describeChanges(action.changes)}]`;
    case 'archive-label':
      return `retire label group "${action.name}" (archive)`;
    case 'create-template':
      return `create team template "${action.name}" with ${action.labelNames.length} default label(s)`;
    case 'update-template':
      return `update team template "${action.name}" with ${action.labelNames.length} default label(s)`;
    case 'set-default-template':
      return `set the team default template to "${action.templateName}"`;
    case 'create-view':
      return `create saved view "${action.name}"`;
    default:
      return `unknown action: ${JSON.stringify(action)}`;
  }
}

// The evidence block. It is rendered from a fresh board read (after an apply)
// so it describes what is really there, never the plan that was hoped for.
export function renderEvidence(board, issueCount) {
  const lines = ['EVIDENCE'];
  const states = [...board.states].sort((a, b) => a.position - b.position);
  lines.push(`States (${states.length}):`);
  for (const state of states) {
    lines.push(`  ${state.name} [${state.type}] position ${state.position}`);
  }

  const groups = board.labels.filter((label) => label.isGroup);
  lines.push(`Label groups (${groups.length}):`);
  for (const group of groups) {
    lines.push(`  ${group.name}`);
    const children = board.labels
      .filter((label) => label.parentId === group.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      lines.push(`    - ${child.name}${child.description ? `: ${child.description}` : ''}`);
    }
  }

  const template = board.templates.find((candidate) => candidate.name === TEMPLATE_NAME);
  lines.push(template
    ? `Template: ${template.name} (id: ${template.id})`
    : `Template: (none -- dry run before creation)`);

  const view = board.views.find((candidate) => candidate.name === WORK_VIEW.name);
  lines.push(view
    ? `Work view: ${view.name} (id: ${view.id}${view.url ? `, url: ${view.url}` : ''})`
    : `Work view: (none -- dry run before creation)`);
  lines.push(`Work view matches ${issueCount} issue(s)`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function boardSetup({
  graphql = linearGraphQL,
  env = process.env,
  readSecretImpl = readSecret,
  teamId = TEAM_ID,
  apply = false,
  stdout = process.stdout,
} = {}) {
  const apiKey = resolveLinearApiKey({ env, readSecretImpl });
  const board = await loadBoard({ graphql, apiKey, teamId });
  const actions = planBoardSetup(board);

  stdout.write(apply
    ? 'board-setup: APPLY -- changing the Julia-next board to match graph/board-spec.mjs\n'
    : 'board-setup: DRY RUN -- pass --apply to change the board\n');
  if (actions.length === 0) {
    stdout.write('board-setup: the board already matches graph/board-spec.mjs; no changes\n');
  } else {
    for (const action of actions) stdout.write(`- ${describeAction(action)}\n`);
    stdout.write(`board-setup: ${actions.length} action(s) ${apply ? 'to apply' : 'planned'}\n`);
  }

  if (apply && actions.length > 0) {
    await applyBoardSetup(actions, { graphql, apiKey, teamId, board });
    stdout.write(`board-setup: applied ${actions.length} action(s)\n`);
  }

  // Re-read after an apply so the evidence is the board as it now is. A dry
  // run has nothing new to read.
  const finalBoard = apply && actions.length > 0
    ? await loadBoard({ graphql, apiKey, teamId })
    : board;
  const issueCount = await countWorkViewIssues({ graphql, apiKey, teamId });
  stdout.write(renderEvidence(finalBoard, issueCount));
  return { actions, board: finalBoard, issueCount };
}

export function parseArgs(argv) {
  const parsed = { apply: false, help: false };
  for (const arg of argv) {
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

const USAGE = `usage: node scripts/board-setup.mjs [--apply]

Makes the Julia-next Linear board match graph/board-spec.mjs. The default is a
dry run that prints every action it would take and changes nothing; pass
--apply to perform them. The Linear API key is read in process (LINEAR_API_KEY
or the protected drop box), never from argv and never printed.
`;

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  try {
    await boardSetup({ apply: options.apply });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
