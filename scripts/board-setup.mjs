#!/usr/bin/env node
// board-setup.mjs -- JUL-97 step 1: make the real Julia-next Linear board
// match graph/board-spec.mjs. One idempotent program: it reads the board,
// plans the difference from the spec, prints the plan, and -- only with
// --apply -- performs it. A second --apply on an already-correct board finds
// nothing to do.
//
// Two things are deliberate:
//
//  - Everything is matched BY NAME first, but identity is checked too: a state
//    that would carry a wanted name with the wrong TYPE, a label with a wanted
//    group name that is NOT a group, or a board where an old state name and
//    its new name both exist are blocking mismatches. The program reports them
//    and stops BEFORE any mutation rather than papering over them.
//  - The default mode is a dry run. The board is Todd's, and a program that
//    edits it should have to be asked twice.
//
// Every read is paginated (states, labels, templates, views, issues): Linear
// returns 50 records by default and this board alone wants 76 labels, so a
// single page read is the bug that makes the second apply look like work.
//
// The Linear key is read in process only -- from LINEAR_API_KEY or, failing
// that, the protected drop box via read-secret.mjs. It is never an argv entry,
// never a shell string, and never printed. Errors from the transport can embed
// the raw upstream body (which may echo the key), so every stdout/stderr write
// at this boundary is passed through redactSecret() with the resolved key.
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
// Key handling and secret redaction
// ---------------------------------------------------------------------------

export function resolveLinearApiKey({ env = process.env, readSecretImpl = readSecret } = {}) {
  if (env.LINEAR_API_KEY) return env.LINEAR_API_KEY;
  return readSecretImpl('linear');
}

// linearGraphQL embeds the raw upstream body in its error message, and that
// body can contain the Authorization value it was sent. The key is known here
// and nowhere in scripts/linear-cli.mjs, so redaction belongs at this boundary:
// replace every occurrence of the resolved key before a character reaches
// stdout or stderr. linear-cli.mjs is deliberately left alone.
export function redactSecret(text, secret) {
  const raw = String(text ?? '');
  if (!secret) return raw;
  return raw.split(String(secret)).join('[redacted]');
}

// Wrap a writer (process.stdout, or a test capture) so every chunk is redacted.
export function makeRedactingWriter(writer, secret) {
  return {
    write(chunk) {
      return writer.write(redactSecret(chunk, secret));
    },
  };
}

// ---------------------------------------------------------------------------
// Linear documents. Every operation has a `BoardSetup`-prefixed name so a test
// fake (and a human reading a log) can tell them apart without parsing
// variables. Each paginated connection is its own query so it can carry its
// own `$after` cursor.
// ---------------------------------------------------------------------------

const TEAM_QUERY = `
  query BoardSetupTeam($teamId: String!) {
    team(id: $teamId) {
      id
      name
      defaultTemplateForMembers { id }
    }
  }
`;

const STATES_QUERY = `
  query BoardSetupStates($teamId: String!, $after: String) {
    team(id: $teamId) {
      states(first: 50, after: $after) {
        nodes { id name type position color }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const LABELS_QUERY = `
  query BoardSetupLabels($teamId: String!, $after: String) {
    team(id: $teamId) {
      labels(first: 50, after: $after) {
        nodes { id name description isGroup retiredAt parent { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const TEMPLATES_QUERY = `
  query BoardSetupTemplates($teamId: String!, $after: String) {
    team(id: $teamId) {
      templates(first: 50, after: $after) {
        nodes { id name type templateData }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

// Saved views are not part of the team payload in Linear, so they are read
// separately and matched by name like everything else. filterData and shared
// are read too: a view with the right name but the wrong filter or the wrong
// sharing does NOT satisfy the spec.
// CustomView has NO `url` field. The human URL is built from the two fields
// the schema does expose for addressing a view: `slugId` (the view's unique
// URL slug) and the owning organization's `urlKey`. See customViewUrl().
const VIEWS_QUERY = `
  query BoardSetupViews($teamId: ID!, $after: String) {
    customViews(filter: { team: { id: { eq: $teamId } } }, first: 50, after: $after) {
      nodes { id name slugId organization { urlKey } description filterData shared }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ISSUES_QUERY = `
  query BoardSetupIssues($filter: IssueFilter, $after: String) {
    issues(filter: $filter, first: 50, after: $after) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CREATE_STATE_MUTATION = `
  mutation BoardSetupCreateState($input: WorkflowStateCreateInput!) {
    workflowStateCreate(input: $input) {
      success
      workflowState { id name type position color }
    }
  }
`;

// WorkflowStateUpdateInput has NO type field: Linear cannot change a state's
// type after creation. The setup never sends one; a wrong type is a blocking
// mismatch reported before any mutation.
const UPDATE_STATE_MUTATION = `
  mutation BoardSetupUpdateState($id: String!, $input: WorkflowStateUpdateInput!) {
    workflowStateUpdate(id: $id, input: $input) {
      success
      workflowState { id name type position color }
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

// There is no issueLabelArchive mutation. issueLabelRetire keeps the label
// visible on the cards that already carry it and only stops new applications;
// on a later run the returned retiredAt tells the planner there is nothing to
// do.
const RETIRE_LABEL_MUTATION = `
  mutation BoardSetupRetireLabel($id: String!) {
    issueLabelRetire(id: $id) {
      success
      issueLabel { id name retiredAt }
    }
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

// `shared: true` is explicitly requested: the Work view must be visible to
// every human and agent, not only its creator.
const CREATE_VIEW_MUTATION = `
  mutation BoardSetupCreateView($input: CustomViewCreateInput!) {
    customViewCreate(input: $input) {
      success
      customView { id name slugId organization { urlKey } description filterData shared }
    }
  }
`;

const UPDATE_VIEW_MUTATION = `
  mutation BoardSetupUpdateView($id: String!, $input: CustomViewUpdateInput!) {
    customViewUpdate(id: $id, input: $input) {
      success
      customView { id name slugId organization { urlKey } description filterData shared }
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

// CustomView exposes no `url` field (the real API rejects it with
// GRAPHQL_VALIDATION_FAILED). The addressable fields it does expose are `id`,
// `slugId` and `organization { urlKey }`, so the linear.app URL is assembled
// from the organization url key and the view slug. If either is missing, return
// null rather than inventing a URL.
export function customViewUrl(view) {
  const urlKey = view?.organization?.urlKey;
  const slugId = view?.slugId;
  if (!urlKey || !slugId) return null;
  return `https://linear.app/${urlKey}/view/${slugId}`;
}

// Template.templateData is typed JSON! and documented as a JSON-ENCODED
// STRING (unlike CustomView.filterData, which is a JSONObject). Linear may
// hand it back either way, so tolerate both and fail loudly on a string that
// is not JSON rather than silently planning an update on every run.
export function parseTemplateData(raw, templateName = 'template') {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`board-setup: team template "${templateName}" has templateData that is not valid JSON`);
  }
}

// Walk a Relay connection to the end. `select` pulls the connection out of the
// operation's own data shape. A cursor that does not advance, or a connection
// that never ends, is an error rather than a silent partial read.
export async function paginate({ graphql, apiKey, query, variables = {}, select, pageLimit = 1000 }) {
  const nodes = [];
  let after = null;
  for (let page = 0; page < pageLimit; page += 1) {
    const data = await graphql(query, { ...variables, after }, { apiKey });
    const connection = select(data);
    nodes.push(...(connection?.nodes ?? []));
    if (!connection?.pageInfo?.hasNextPage) return nodes;
    const next = connection.pageInfo.endCursor;
    if (next == null || next === after) {
      throw new Error('board-setup: Linear reported another page but returned no usable cursor');
    }
    after = next;
  }
  throw new Error(`board-setup: pagination did not terminate after ${pageLimit} pages`);
}

// Turn the read queries into the small, flat shape the pure planner reasons
// about. Anything Linear does not return is simply absent. Every connection is
// read to the last page before matching or rendering evidence.
export async function loadBoard({ graphql, apiKey, teamId = TEAM_ID } = {}) {
  const callOpts = { apiKey };
  const data = await graphql(TEAM_QUERY, { teamId }, callOpts);
  const team = data?.team;
  if (!team) {
    throw new Error(`board-setup: no Linear team with id ${teamId}`);
  }

  const stateNodes = await paginate({
    graphql, apiKey, query: STATES_QUERY, variables: { teamId }, select: (d) => d?.team?.states,
  });
  const labelNodes = await paginate({
    graphql, apiKey, query: LABELS_QUERY, variables: { teamId }, select: (d) => d?.team?.labels,
  });
  const templateNodes = await paginate({
    graphql, apiKey, query: TEMPLATES_QUERY, variables: { teamId }, select: (d) => d?.team?.templates,
  });
  const viewNodes = await paginate({
    graphql, apiKey, query: VIEWS_QUERY, variables: { teamId }, select: (d) => d?.customViews,
  });

  return {
    teamId,
    name: team.name ?? null,
    defaultTemplateId: team.defaultTemplateForMembers?.id ?? null,
    states: stateNodes.map((state) => ({
      id: state.id,
      name: state.name,
      type: state.type,
      position: Number(state.position),
      color: state.color ?? null,
    })),
    labels: labelNodes.map((label) => ({
      id: label.id,
      name: label.name,
      description: label.description ?? null,
      isGroup: label.isGroup === true,
      parentId: label.parent?.id ?? null,
      retiredAt: label.retiredAt ?? null,
    })),
    templates: templateNodes.map((template) => ({
      id: template.id,
      name: template.name,
      type: template.type,
      templateData: parseTemplateData(template.templateData, template.name),
    })),
    views: viewNodes.map((view) => ({
      id: view.id,
      name: view.name,
      url: customViewUrl(view),
      slugId: view.slugId ?? null,
      organizationUrlKey: view.organization?.urlKey ?? null,
      description: view.description ?? null,
      filterData: view.filterData ?? null,
      shared: view.shared === true,
    })),
  };
}

// Count every issue matching an IssueFilter, paging to the end. Used for the
// evidence line and for the card counts in a coexistence mismatch.
export async function countIssues({ graphql, apiKey, filter }) {
  let after = null;
  let count = 0;
  for (let page = 0; page < 1000; page += 1) {
    const data = await graphql(ISSUES_QUERY, { filter, after }, { apiKey });
    const connection = data?.issues;
    count += connection?.nodes?.length ?? 0;
    if (!connection?.pageInfo?.hasNextPage) return count;
    after = connection.pageInfo.endCursor;
  }
  throw new Error('board-setup: issue count did not terminate after 1000 pages');
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

// Stable stringify so two IssueFilter objects compare equal regardless of key
// order (Linear may echo the filter in a different order than it was sent).
function canonical(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    // A filter's `nin` list is a set: order must not make the same filter look
    // different and drive an endless update-view loop.
    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return `[${[...items].sort().join(',')}]`;
    }
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sameFilterData(a, b) {
  return canonical(a) === canonical(b);
}

// A blocking mismatch is something the spec cannot be reached through without
// losing information or lying. The planner finds them all BEFORE emitting a
// single action, and boardSetup reports them with card counts and exits
// non-zero.
export function findBlockingMismatches(board) {
  const mismatches = [];
  const statesByName = new Map(board.states.map((state) => [state.name, state]));

  // (7) Both an old name and its target name exist. There is no safe rename:
  // updating either one strands the other's cards, so the program stops and
  // reports both, with counts, before changing anything.
  for (const [from, to] of Object.entries(STATE_RENAMES)) {
    const fromState = statesByName.get(from);
    const toState = statesByName.get(to);
    if (fromState && toState) {
      mismatches.push({ kind: 'state-name-coexistence', fromName: from, toName: to, fromState, toState });
    }
  }

  // (1) A state that will carry a target name (already named, or about to be
  // renamed) has the wrong type. WorkflowStateUpdateInput cannot change type,
  // so this is blocking. When both names exist the coexistence above already
  // stops the run; skip the duplicate type report.
  for (const state of WORKFLOW_STATES) {
    const target = statesByName.get(state.name);
    const source = findRenameSource(statesByName, state.name);
    if (target && source) continue;
    const existing = target ?? source;
    if (existing && existing.type !== state.type) {
      mismatches.push({
        kind: 'state-type',
        stateName: existing.name,
        actualType: existing.type,
        wantedType: state.type,
      });
    }
  }

  // (8) A label with a wanted GROUP name that is not a group cannot be a
  // parent. Matching by name alone would let ordinary labels receive children.
  const labelsByName = new Map(board.labels.map((label) => [label.name, label]));
  for (const group of desiredLabelGroups()) {
    const existing = labelsByName.get(group.name);
    if (existing && !existing.isGroup) {
      mismatches.push({ kind: 'label-group-identity', labelName: group.name });
    }
    // (8, inverse) A spec'd CHILD name that already exists as a group cannot
    // be reparented under another group: Linear does not allow a group to be a
    // child. Planning it would fail mid-apply, so it is reported here instead.
    for (const child of group.children) {
      const childLabel = labelsByName.get(child.name);
      if (childLabel?.isGroup) {
        mismatches.push({ kind: 'label-child-identity', labelName: child.name, parentName: group.name });
      }
    }
  }

  // (3) A name the spec retires that exists as an ordinary label is not the
  // group the spec expects. Skipping it silently would leave the retirement
  // undone, so report it rather than say nothing.
  for (const name of RETIRED_LABEL_GROUPS) {
    const existing = labelsByName.get(name);
    if (existing && !existing.isGroup) {
      mismatches.push({ kind: 'retired-label-identity', labelName: name });
    }
  }

  return mismatches;
}

export function mismatchMessage(mismatch, { issueCountByStateId = {} } = {}) {
  const count = (state) => {
    const value = issueCountByStateId[state.id];
    return Number.isFinite(value) ? `${value} card(s)` : 'an unknown number of cards';
  };
  switch (mismatch.kind) {
    case 'state-name-coexistence':
      return `state "${mismatch.fromName}" (${count(mismatch.fromState)}) and state "${mismatch.toName}" (${count(mismatch.toState)}) both exist; renaming either would strand the other's cards, so no state was changed`;
    case 'state-type':
      return `state "${mismatch.stateName}" has type "${mismatch.actualType}" but the spec needs "${mismatch.wantedType}"; Linear cannot change a workflow state's type after creation`;
    case 'label-group-identity':
      return `label "${mismatch.labelName}" exists but is not a label group, so it cannot be the parent of the spec's child labels`;
    case 'label-child-identity':
      return `label "${mismatch.labelName}" already exists as a label group, but the spec needs it as an ordinary child of "${mismatch.parentName}"; a label group cannot be reparented under another group`;
    case 'retired-label-identity':
      return `label "${mismatch.labelName}" exists but is not a label group, so the spec's retirement of the group "${mismatch.labelName}" was not applied; rename or retire it by hand`;
    default:
      return `unknown blocking mismatch: ${JSON.stringify(mismatch)}`;
  }
}

export class BoardConflictError extends Error {
  constructor(messages) {
    super(`board-setup: the board cannot be migrated safely:\n${messages.map((message) => `  - ${message}`).join('\n')}`);
    this.name = 'BoardConflictError';
    this.mismatches = messages;
  }
}

// The action ordering that keeps intermediate state positions collision-free.
// Every claimed state that must change position first moves to a temporary
// slot above every existing and final position; then the missing states are
// created and the moved states land on their final positions. No step puts two
// of the eight at the same position. States outside the eight are never moved,
// even when that leaves an outside state tied with one of the eight -- the
// evidence listing names those ties.
function planStatePositions(board, statesByName) {
  const actions = [];
  const slots = WORKFLOW_STATES.map((state, index) => ({
    state,
    position: index,
    existing: statesByName.get(state.name) ?? findRenameSource(statesByName, state.name),
  }));

  const maxExisting = board.states.reduce((max, state) => {
    const value = Number(state.position);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, WORKFLOW_STATES.length - 1);
  let tempPosition = Math.max(maxExisting, WORKFLOW_STATES.length - 1) + 1;

  const moved = slots.filter((slot) => slot.existing && Number(slot.existing.position) !== slot.position);

  // First: rename and vacate. The temp slot is always above the final range,
  // so a second update is needed to land on the final position.
  for (const slot of moved) {
    const changes = { position: tempPosition };
    if (slot.existing.name !== slot.state.name) changes.name = slot.state.name;
    actions.push({
      kind: 'update-state',
      id: slot.existing.id,
      currentName: slot.existing.name,
      name: slot.state.name,
      changes,
    });
    tempPosition += 1;
  }

  // Second: create the missing states at their final positions. Every moved
  // state is out of the way (at a temp slot), so a create never collides with
  // a claimed state. A state outside the eight may share the position; that is
  // left alone and reported by the evidence.
  for (const slot of slots) {
    if (!slot.existing) {
      actions.push({
        kind: 'create-state',
        name: slot.state.name,
        type: slot.state.type,
        color: slot.state.color,
        position: slot.position,
      });
    }
  }

  // Third: land the moved states on their finals; rename any state that only
  // needed a name change.
  for (const slot of slots) {
    if (!slot.existing) continue;
    const changedPosition = Number(slot.existing.position) !== slot.position;
    if (!changedPosition) {
      if (slot.existing.name !== slot.state.name) {
        actions.push({
          kind: 'update-state',
          id: slot.existing.id,
          currentName: slot.existing.name,
          name: slot.state.name,
          changes: { name: slot.state.name },
        });
      }
      continue;
    }
    actions.push({
      kind: 'update-state',
      id: slot.existing.id,
      currentName: slot.existing.name,
      name: slot.state.name,
      changes: { position: slot.position },
    });
  }

  return actions;
}

// The pure diff: given a board (the shape loadBoard returns), list the actions
// that would make it match the spec. An empty list means the board is already
// correct -- the property a second --apply relies on. Blocking mismatches
// throw here too, so a direct caller cannot get a plan that ignores one. No
// I/O.
export function planBoardSetup(board) {
  const mismatches = findBlockingMismatches(board);
  if (mismatches.length > 0) {
    throw new BoardConflictError(mismatches.map((mismatch) => mismatchMessage(mismatch)));
  }

  const statesByName = new Map(board.states.map((state) => [state.name, state]));
  const actions = planStatePositions(board, statesByName);

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

  // A retired group is done: issueLabelRetire keeps it on the board with a
  // retiredAt stamp, so later runs see it and emit nothing.
  for (const name of RETIRED_LABEL_GROUPS) {
    const existing = labelsByName.get(name);
    if (existing?.isGroup && !existing.retiredAt) {
      actions.push({ kind: 'retire-label', id: existing.id, name });
    }
  }

  // Match the Work view on identity, not just its name: the saved filter and
  // its sharing are both part of what the spec requires.
  const desiredFilter = workViewIssueFilter(board.teamId);
  const existingView = board.views.find((view) => view.name === WORK_VIEW.name);
  if (!existingView) {
    actions.push({
      kind: 'create-view',
      name: WORK_VIEW.name,
      description: WORK_VIEW.description,
      filterData: desiredFilter,
      shared: true,
    });
  } else {
    const changes = {};
    if (!sameFilterData(existingView.filterData, desiredFilter)) changes.filterData = desiredFilter;
    if (existingView.shared !== true) changes.shared = true;
    if (Object.keys(changes).length > 0) {
      actions.push({ kind: 'update-view', id: existingView.id, name: WORK_VIEW.name, changes });
    }
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

  const applyAction = async (action) => {
    switch (action.kind) {
      case 'create-state': {
        const data = await graphql(CREATE_STATE_MUTATION, {
          input: {
            teamId,
            name: action.name,
            type: action.type,
            color: action.color,
            position: action.position,
          },
        }, callOpts);
        assertSuccess(data.workflowStateCreate, `creating workflow state "${action.name}"`);
        break;
      }
      case 'update-state': {
        const input = {};
        if (action.changes.name !== undefined) input.name = action.changes.name;
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
      case 'retire-label': {
        const data = await graphql(RETIRE_LABEL_MUTATION, { id: action.id }, callOpts);
        assertSuccess(data.issueLabelRetire, `retiring label group "${action.name}"`);
        break;
      }
      case 'create-template': {
        const labelIds = resolveIds(action.labelNames, labelIdByName);
        const data = await graphql(CREATE_TEMPLATE_MUTATION, {
          input: { teamId, name: action.name, type: 'issue', templateData: JSON.stringify({ labelIds, teamId }) },
        }, callOpts);
        const payload = assertSuccess(data.templateCreate, `creating team template "${action.name}"`);
        templateIdByName.set(action.name, payload.template.id);
        break;
      }
      case 'update-template': {
        const labelIds = resolveIds(action.labelNames, labelIdByName);
        const data = await graphql(UPDATE_TEMPLATE_MUTATION, {
          id: action.id,
          input: { templateData: JSON.stringify({ labelIds, teamId }) },
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
            shared: action.shared === true,
          },
        }, callOpts);
        assertSuccess(data.customViewCreate, `creating the saved view "${action.name}"`);
        break;
      }
      case 'update-view': {
        const input = {};
        if (action.changes.filterData !== undefined) input.filterData = action.changes.filterData;
        if (action.changes.shared !== undefined) input.shared = action.changes.shared;
        const data = await graphql(UPDATE_VIEW_MUTATION, { id: action.id, input }, callOpts);
        assertSuccess(data.customViewUpdate, `updating the saved view "${action.name}"`);
        break;
      }
      default:
        throw new Error(`board-setup: unknown action kind '${action.kind}'`);
    }
  };

  let applied = 0;
  for (const action of actions) {
    try {
      await applyAction(action);
    } catch (error) {
      if (error && typeof error === 'object') {
        error.boardSetupProgress = { applied, total: actions.length, action };
      }
      throw error;
    }
    applied += 1;
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
      return `create workflow state "${action.name}" (type ${action.type}, color ${action.color}) at position ${action.position}`;
    case 'update-state':
      return `update workflow state "${action.currentName}" -> "${action.name}" [${describeChanges(action.changes)}]`;
    case 'create-label-group':
      return `create label group "${action.name}"`;
    case 'create-label':
      return `create label "${action.name}" under "${action.parentName}"${action.description ? ` -- ${action.description}` : ''}`;
    case 'update-label':
      return `update label "${action.name}" [${describeChanges(action.changes)}]`;
    case 'retire-label':
      return `retire label group "${action.name}" (issueLabelRetire; cards keep the label)`;
    case 'create-template':
      return `create team template "${action.name}" with ${action.labelNames.length} default label(s)`;
    case 'update-template':
      return `update team template "${action.name}" with ${action.labelNames.length} default label(s)`;
    case 'set-default-template':
      return `set the team default template to "${action.templateName}"`;
    case 'create-view':
      return `create saved view "${action.name}" (shared)`;
    case 'update-view':
      return `update saved view "${action.name}" [${describeChanges(action.changes)}]`;
    default:
      return `unknown action: ${JSON.stringify(action)}`;
  }
}

// The human-readable target of an action, for the partial-apply report.
function actionTargetName(action) {
  switch (action.kind) {
    case 'set-default-template':
      return action.templateName;
    case 'update-state':
      return action.name ?? action.currentName;
    default:
      return action.name ?? null;
  }
}

// When a mutation is refused partway through, say exactly how far the board
// got, which action failed, and that re-running resumes. The original API
// error is rethrown untouched and printed after this by main().
export function renderPartialApplyReport({ applied, total, action } = {}) {
  const target = action ? actionTargetName(action) : null;
  const failed = action
    ? `${action.kind}${target == null ? '' : ` "${target}"`}`
    : 'unknown action';
  return [
    `board-setup: WARNING -- ${applied} of ${total} action(s) succeeded before the failure; the board is now partly migrated`,
    `board-setup: the action that failed was ${failed}`,
    'board-setup: re-running the program continues from where it stopped (already-correct items are skipped by name)',
    '',
  ].join('\n');
}

// The evidence block. It is rendered from a fresh board read (after an apply)
// so it describes what is really there, never the plan that was hoped for. The
// issue count is passed in from the SAVED view's own filter when one exists.
export function renderEvidence(board, issueCount, { issueCountFromSavedView = false } = {}) {
  const lines = ['EVIDENCE'];
  const states = [...board.states].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  lines.push(`States (${states.length}):`);
  for (const state of states) {
    lines.push(`  ${state.name} [${state.type}] position ${state.position}`);
  }

  // States outside the eight are never moved, so one of them can share a
  // position with a column. Say so here instead of hiding it.
  const byPosition = new Map();
  for (const state of board.states) {
    const names = byPosition.get(state.position) ?? [];
    names.push(state.name);
    byPosition.set(state.position, names);
  }
  const collisions = [...byPosition.entries()]
    .filter(([, names]) => names.length > 1)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  if (collisions.length > 0) {
    lines.push('Position collisions (excluded states are left where they are):');
    for (const [position, names] of collisions) {
      lines.push(`  position ${position}: ${names.join(', ')}`);
    }
  }

  const groups = board.labels.filter((label) => label.isGroup);
  lines.push(`Label groups (${groups.length}):`);
  for (const group of groups) {
    lines.push(`  ${group.name}${group.retiredAt ? ' (retired)' : ''}`);
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
    : 'Template: (none -- dry run before creation)');

  const view = board.views.find((candidate) => candidate.name === WORK_VIEW.name);
  // CustomView has no url field: when a URL is present it was built from
  // slugId + organization.urlKey. If the schema returned neither, say so
  // instead of inventing one.
  const viewUrl = view
    ? (view.url
      ? `, url: ${view.url}`
      : `, url: none -- Linear exposes no URL field for a view; address it by id ${view.id}`)
    : '';
  lines.push(view
    ? `Work view: ${view.name} (id: ${view.id}${viewUrl}, ${view.shared ? 'shared' : 'private'})`
    : 'Work view: (none -- dry run before creation)');
  lines.push(`Work view matches ${issueCount} issue(s) (${issueCountFromSavedView
    ? "counted with the saved view's filter"
    : 'counted with the desired filter; the view is not saved yet'})`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function boardSetup({
  graphql = linearGraphQL,
  env = process.env,
  readSecretImpl = readSecret,
  apiKey: providedApiKey,
  teamId = TEAM_ID,
  apply = false,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const apiKey = providedApiKey ?? resolveLinearApiKey({ env, readSecretImpl });
  const safeStdout = makeRedactingWriter(stdout, apiKey);
  const safeStderr = makeRedactingWriter(stderr, apiKey);

  const board = await loadBoard({ graphql, apiKey, teamId });

  // Blocking mismatches are found BEFORE any mutation. Coexistence needs card
  // counts, so it is the one mismatch that costs a read; the counts come from
  // the live board, never from the plan.
  const mismatches = findBlockingMismatches(board);
  if (mismatches.length > 0) {
    const stateIds = new Set();
    for (const mismatch of mismatches) {
      if (mismatch.kind === 'state-name-coexistence') {
        stateIds.add(mismatch.fromState.id);
        stateIds.add(mismatch.toState.id);
      }
    }
    const issueCountByStateId = {};
    for (const id of stateIds) {
      issueCountByStateId[id] = await countIssues({ graphql, apiKey, filter: { state: { id: { eq: id } } } });
    }
    throw new BoardConflictError(
      mismatches.map((mismatch) => mismatchMessage(mismatch, { issueCountByStateId })),
    );
  }

  const actions = planBoardSetup(board);

  safeStdout.write(apply
    ? 'board-setup: APPLY -- changing the Julia-next board to match graph/board-spec.mjs\n'
    : 'board-setup: DRY RUN -- pass --apply to change the board\n');
  if (actions.length === 0) {
    safeStdout.write('board-setup: the board already matches graph/board-spec.mjs; no changes\n');
  } else {
    for (const action of actions) safeStdout.write(`- ${describeAction(action)}\n`);
    safeStdout.write(`board-setup: ${actions.length} action(s) ${apply ? 'to apply' : 'planned'}\n`);
  }

  if (apply && actions.length > 0) {
    try {
      await applyBoardSetup(actions, { graphql, apiKey, teamId, board });
    } catch (error) {
      // Say how far the apply got before the refusal, on stderr, and then let
      // the original API error surface unchanged.
      if (error && typeof error === 'object' && error.boardSetupProgress) {
        safeStderr.write(renderPartialApplyReport(error.boardSetupProgress));
      }
      throw error;
    }
    safeStdout.write(`board-setup: applied ${actions.length} action(s)\n`);
  }

  // Re-read after an apply so the evidence is the board as it now is. A dry
  // run has nothing new to read.
  const finalBoard = apply && actions.length > 0
    ? await loadBoard({ graphql, apiKey, teamId })
    : board;

  // The evidence count comes from the SAVED view's own filter when there is
  // one; a view with a wrong filter must count the wrong things and say so, not
  // be silently re-counted with the desired filter.
  const savedView = finalBoard.views.find((view) => view.name === WORK_VIEW.name);
  const countFilter = savedView?.filterData ?? workViewIssueFilter(finalBoard.teamId);
  const issueCount = await countIssues({ graphql, apiKey, filter: countFilter });
  safeStdout.write(renderEvidence(finalBoard, issueCount, { issueCountFromSavedView: Boolean(savedView) }));
  return { actions, board: finalBoard, issueCount };
}

export function parseArgs(argv) {
  const parsed = { apply: false, help: false };
  for (const arg of argv) {
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error('unknown argument: [redacted]');
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

  // Resolve the key once, here, so an error thrown by the transport can have
  // the key redacted before it reaches stderr.
  let apiKey;
  try {
    apiKey = resolveLinearApiKey({});
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  try {
    await boardSetup({ apply: options.apply, apiKey });
  } catch (error) {
    console.error(redactSecret(error.message, apiKey));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
