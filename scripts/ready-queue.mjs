#!/usr/bin/env node
// ready-queue.mjs -- JUL-79 step 1: the plain-script half of "run the graph
// from the board". A card in the board's *Ready* column is a queue entry, not
// a trigger: this script performs exactly ONE check cycle and exits (a systemd
// timer, a later parked step, repeats it -- this process never sleeps). The
// check is width-1: while any run is active on the orchestrator-local Orca
// environment, it does nothing at all. Otherwise it takes the top Ready card
// by board order (lowest `Issue.sortOrder`, sorted client-side because
// Linear's paginated connections only order by createdAt/updatedAt) and, once
// the card has been seen in Ready by a previous check, either starts it
// through `julia-run` or posts one explanation comment and stays quiet.
//
// Every external effect -- Linear query/comment, Orca run/task/terminal,
// state-file I/O, the clock -- sits behind an injected implementation so the
// unit tests never touch the network, Linear, Orca, or the real state path.
// The real CLI entry reads the Linear key in-process (env first, then the
// drop box) and never passes it through argv or a shell string.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { linearGraphQL, checkForToddGuard } from './linear-cli.mjs';
import { readSecret } from '../ops/service-dropbox/read-secret.mjs';
import { runList, taskList, terminalCreate } from './orca-cli.mjs';
// Reuse julia-run's own definition of "the run is done": a run with an active
// Task is in progress, a zero-Task run counts as active inside a 15-minute
// grace window, and completed/failed/stopped/cancelled are terminal. Sharing
// the function (instead of re-deriving it here) keeps the width-1 gate and the
// double-start guard telling the same story; julia-run.mjs's public behavior
// is unchanged.
import { isRunFinished } from './julia-run.mjs';
// JUL-79 step 5: the real model-choice rule and the default-label filler are
// pure and live in seat-labels.mjs. The queue only wires them in (injectable
// validator stays injectable, so the pure tests remain pure).
import { resolveSeatChoices, validateFamilyChoice, missingSeatLabels } from './seat-labels.mjs';
// JUL-97 step 2, item 6c: "a blocker at UAT or later is cleared" is a fact
// about the board's COLUMN ORDER, not about Linear state types -- UAT's type
// is `started`, exactly like Implementation. Reading the order from the board
// spec means inserting a column later cannot silently change the answer.
import { WORKFLOW_STATE_NAMES, workflowColumnIndex } from '../graph/board-spec.mjs';

export const DEFAULT_TEAM_NAME = 'Julia-next';
export const DEFAULT_STATE_NAME = 'Ready';
// JUL-97 step 1: the board's started column is now `Implementation`. The
// post-start state move follows the renamed column so a started card leaves
// Ready for the column the board actually has.
export const IN_PROGRESS_STATE_NAME = 'Implementation';
export const DEFAULT_INTERVAL_MINUTES = 5;
// Kept exported because the triage vocabulary still uses it; the Ready queue
// itself no longer requires it (JUL-97: a card in Ready is eligible without
// it, and only a Decision or Parent card is refused by label).
export const READY_FOR_AGENT_LABEL = 'ready-for-agent';
// The two coordinate-only labels: a Decision is an answer and a Parent is a
// container, so neither belongs in the Ready queue.
export const DECISION_LABEL = 'Decision';
export const PARENT_LABEL = 'Parent';
export const ORCHESTRATOR_ENVIRONMENT = 'orchestrator-local';
export const ORCHESTRATOR_CHECKOUT = '/srv/orchestrator-svc/julia-next';

// The state file holds only what the previous check saw -- newly-ready cards
// (so a card counts only after one full check) and, per card, the fingerprint
// of the last ineligible state the queue already commented on. `started` is
// the record that a start happened, keyed BY ISSUE ID; keeping it separate
// from `ready` is what makes the script idempotent if it is ever run twice for
// one card, and keying it by issue is what keeps one card's start from erasing
// another card's cooldown now that the queue can walk past a card and start a
// later one (JUL-97 step 2, finding 1).
export const DEFAULT_STATE_PATH = join(os.homedir(), '.local', 'state', 'julia-next', 'ready-queue.json');

// ---------------------------------------------------------------------------
// Pure decision helpers
// ---------------------------------------------------------------------------

function sortOrderOf(issue) {
  const value = Number(issue?.sortOrder);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

// Board order: ascending `Issue.sortOrder`, not the order Linear happened to
// return the connection in. Ties keep the incoming (board) order --
// Array.prototype.sort is stable, so copies preserve it.
export function sortCardsByBoardOrder(issues) {
  return [...(issues ?? [])].sort((a, b) => sortOrderOf(a) - sortOrderOf(b));
}

// The single top card, kept for callers that only want to name it.
export function pickTopCard(issues) {
  return sortCardsByBoardOrder(issues)[0] ?? null;
}

// The column from which a blocker counts as cleared. A card that has reached
// UAT has been built, reviewed and smoke-tested; what remains is Todd's
// acceptance, and holding a dependent card for that serialises the whole
// board on him. `Evidence review` sits EARLIER in WORKFLOW_STATE_NAMES and
// therefore does NOT clear.
export const BLOCKER_CLEARED_FROM_COLUMN = 'UAT';
const CLEARED_FROM_INDEX = workflowColumnIndex(BLOCKER_CLEARED_FROM_COLUMN);
if (CLEARED_FROM_INDEX < 0) {
  throw new Error(`ready-queue: the board spec has no "${BLOCKER_CLEARED_FROM_COLUMN}" column (columns: ${WORKFLOW_STATE_NAMES.join(', ')})`);
}

export function isBlockerClosed(blocker) {
  const state = blocker?.state ?? {};
  const type = String(state.type ?? '').toLowerCase();
  // A finished or abandoned blocker is cleared whatever its column is called.
  if (type === 'completed' || type === 'canceled') return true;
  // Otherwise the board order decides: UAT or later clears, everything before
  // it does not. Derived from WORKFLOW_STATE_NAMES, never from the state type
  // -- UAT is `started` just like Implementation, so a type test cannot tell
  // them apart.
  const name = String(state.name ?? '');
  const index = workflowColumnIndex(name);
  if (index >= 0) return index >= CLEARED_FROM_INDEX;
  // A blocker shape that carries no type and no spec column name at all: fall
  // back to the human name, as before.
  if (type) return false;
  const lower = name.toLowerCase();
  return lower === 'done' || lower === 'canceled' || lower === 'cancelled';
}

export function openBlockers(issue) {
  return (issue?.blockers ?? []).filter((blocker) => !isBlockerClosed(blocker));
}

function blockerLabel(blocker) {
  return `${blocker.identifier ?? blocker.id} (${blocker.state?.name ?? blocker.state?.type ?? 'unknown state'})`;
}

// A fingerprint of everything that can make a Ready card ineligible: its
// labels, its state, and its blockers. Two checks that see the same
// fingerprint are the same request for help, so the queue comments once and
// then stays quiet until this string changes.
export function issueFingerprint(issue) {
  const labels = [...(issue?.labels ?? [])].map(String).sort();
  const blockers = (issue?.blockers ?? [])
    .map((blocker) => `${blocker.identifier ?? blocker.id}:${blocker.state?.name ?? blocker.state?.type ?? ''}`)
    .sort();
  return JSON.stringify({
    labels,
    state: issue?.state?.name ?? null,
    blockers,
  });
}

// The real label-group -> model/effort rule (JUL-79 step 5): resolve the
// card's labels to each agent's seat + effort, then enforce that builder and
// reviewer are from different families and every seat is a real seat-table
// entry. Still injected through `validateModelChoiceImpl`, so the pure tests
// stay pure; the default is now the real rule instead of the old permissive
// placeholder.
export function defaultValidateModelChoice(issue) {
  return validateFamilyChoice(resolveSeatChoices(issue?.labels));
}

export function evaluateEligibility(issue, { validateModelChoiceImpl = defaultValidateModelChoice } = {}) {
  const reasons = [];

  // JUL-97: the ready-for-agent label is no longer a gate -- a card sitting in
  // Ready is a queue entry by virtue of its column. The two labels that still
  // refuse a card are the coordinate-only ones, each named in its reason so the
  // comment on the card says exactly why.
  const labels = new Set(issue?.labels ?? []);
  for (const label of [DECISION_LABEL, PARENT_LABEL]) {
    if (labels.has(label)) {
      reasons.push(`the card carries the ${label} label; ${label} cards are not agent work`);
    }
  }

  const open = openBlockers(issue);
  if (open.length > 0) {
    reasons.push(`blocked by ${open.map(blockerLabel).join(', ')}`);
  }

  const model = validateModelChoiceImpl(issue) ?? {};
  if (model.ok !== true) {
    reasons.push(model.reason ?? 'no valid model choice is configured for this card');
  }

  return { eligible: reasons.length === 0, reasons };
}

export function ineligibleCommentBody(issue, reasons) {
  return [
    `Ready queue: \`${issue.identifier}\` is at the top of Ready but can't start yet.`,
    '',
    ...reasons.map((reason) => `- ${reason}`),
    '',
    'The queue will not comment again for this card until its labels, state, or blockers change.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Width-1 slot check
// ---------------------------------------------------------------------------

export async function isSlotBusy({
  runListImpl = runList,
  isRunFinishedImpl = isRunFinished,
  taskListImpl = taskList,
  now = () => Date.now(),
  environment = ORCHESTRATOR_ENVIRONMENT,
  limit = 100,
} = {}) {
  const { runs } = await runListImpl({ environment, limit });
  for (const run of runs ?? []) {
    const finished = await isRunFinishedImpl(run, { taskListImpl, now });
    if (!finished) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

function emptyState() {
  return { ready: {}, commented: {}, started: {} };
}

// Older state files (before JUL-97 step 2) held a single `lastStarted` record
// instead of the per-issue `started` map. We MIGRATE rather than tolerate both
// shapes: the old record is folded into the map on read and never written
// again, so there is exactly one code path for the cooldown lookup and no
// running queue crashes -- or silently loses a cooldown -- on the first check
// after the upgrade. The migration is lossless: the one card the old file knew
// about keeps its cooldown under its own id.
function startedRecords(parsed) {
  const started = { ...(parsed?.started ?? {}) };
  const legacy = parsed?.lastStarted;
  if (legacy?.issueId && !(legacy.issueId in started)) {
    started[legacy.issueId] = {
      identifier: legacy.identifier ?? null,
      at: legacy.at ?? null,
      fingerprint: legacy.fingerprint ?? null,
      stateMoved: legacy.stateMoved ?? false,
    };
  }
  return started;
}

// The cooldown only ever matters for a card that is still in Ready, so records
// for cards that have left the column are dropped each cycle -- the same way
// `ready` itself is replaced wholesale -- and the file cannot grow without
// bound.
function pruneStarted(started, currentReady) {
  const kept = {};
  for (const [issueId, record] of Object.entries(started)) {
    if (issueId in currentReady) kept[issueId] = record;
  }
  return kept;
}

export function readState({ statePath = DEFAULT_STATE_PATH, readFileImpl = readFileSync } = {}) {
  let raw;
  try {
    raw = readFileImpl(statePath, 'utf8');
  } catch (error) {
    // A missing file is simply "no previous check" -- the normal first run.
    // Any other read error (permissions, corrupt JSON) is a real problem and
    // is surfaced rather than silently reset, which would only delay starts.
    if (error?.code === 'ENOENT') return emptyState();
    throw error;
  }
  const parsed = JSON.parse(raw);
  return {
    ready: parsed?.ready ?? {},
    commented: parsed?.commented ?? {},
    started: startedRecords(parsed),
  };
}

export function writeState(state, {
  statePath = DEFAULT_STATE_PATH,
  mkdirImpl = mkdirSync,
  writeFileImpl = writeFileSync,
} = {}) {
  mkdirImpl(dirname(statePath), { recursive: true });
  writeFileImpl(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Linear access
// ---------------------------------------------------------------------------

// Live-verified (JUL-79, 2026-09-18): board order is `Issue.sortOrder` (a
// populated float, e.g. -28624) and the only allowed `PaginationOrderBy`
// values are createdAt/updatedAt, so the top card is sorted client-side.
// Relation direction is verified live too: there is no `blocked_by` type and
// no `blockedBy` field on `Issue`; every blocking relation is typed `blocks`
// and sits on the blocker's own `relations` connection. The blocked card sees
// it in its `inverseRelations`, where `issue` is the blocker and `relatedIssue`
// is the blocked card itself -- so `normalizeIssue` reads blockers from the
// inverse side and takes `relation.issue`. Both sides are requested so the
// parse cannot depend on which side Linear happens to return.
const TEAM_STATES_QUERY = `
  query ReadyQueueTeamStates($teamName: String!) {
    teams(filter: { name: { eq: $teamName } }, first: 1) {
      nodes {
        id
        states { nodes { id name type } }
      }
    }
  }
`;

const READY_ISSUES_QUERY = `
  query ReadyQueueIssues($stateId: ID!) {
    issues(filter: { state: { id: { eq: $stateId } } }, first: 100) {
      nodes {
        id
        identifier
        title
        sortOrder
        state { id name type }
        labels { nodes { id name } }
        relations {
          nodes {
            type
            issue { id identifier state { name type } }
            relatedIssue { id identifier state { name type } }
          }
        }
        inverseRelations {
          nodes {
            type
            issue { id identifier state { name type } }
            relatedIssue { id identifier state { name type } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COMMENT_CREATE_MUTATION = `
  mutation ReadyQueueComment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment { id url }
    }
  }
`;

// JUL-79 step 5 (D3): label ids live on the team, not on the card, and the
// model/effort labels may not exist on the real board until the coordinator
// creates them -- so a lookup reports what is present and the caller skips
// the rest.
// Paginated: the team holds 88 labels and Linear returns 50 a page, so the
// single-page read this query used to do reported labels that DO exist as
// missing (observed on the live board 2026-09-20, which is why a started card
// came out without its seat labels). `$after` walks the connection to the end.
const TEAM_LABELS_QUERY = `
  query ReadyQueueTeamLabels($teamName: String!, $after: String) {
    teams(filter: { name: { eq: $teamName } }, first: 1) {
      nodes {
        id
        labels(first: 50, after: $after) {
          nodes { id name }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const ISSUE_ADD_LABELS_MUTATION = `
  mutation ReadyQueueAddLabels($issueId: String!, $labelIds: [String!]!) {
    issueUpdate(id: $issueId, input: { addedLabelIds: $labelIds }) {
      success
      issue { id }
    }
  }
`;

// JUL-79 step 5 (D4 belt 1): move a started card out of Ready. `issueUpdate`
// with a `stateId` is the Linear mutation for that.
const ISSUE_SET_STATE_MUTATION = `
  mutation ReadyQueueSetState($issueId: String!, $stateId: String!) {
    issueUpdate(id: $issueId, input: { stateId: $stateId }) {
      success
      issue { id state { id name type } }
    }
  }
`;

function isBlocksRelation(type) {
  return /^blocks$/i.test(String(type ?? ''));
}

// On the inverse side of a `blocks` relation the blocker is `relation.issue`;
// `relation.relatedIssue` is this card itself.
function toBlocker(relation) {
  const blocker = relation?.issue;
  return {
    id: blocker?.id,
    identifier: blocker?.identifier,
    state: blocker?.state ?? null,
  };
}

// Turn a raw Linear issue (label/relation connections) into the small shape
// the queue reasons about. A card's blockers are exactly the `inverseRelations`
// entries typed `blocks` (verified live 2026-09-18); `relations` entries typed
// `blocks` are the cards THIS card blocks, not blockers of it, and the live API
// has neither a `blocked_by` relation type nor a `blockedBy` field.
export function normalizeIssue(raw) {
  const labelNodes = raw?.labels?.nodes ?? raw?.labels ?? [];
  const labels = labelNodes.map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean);
  const blockers = (raw?.inverseRelations?.nodes ?? [])
    .filter((relation) => isBlocksRelation(relation.type))
    .map(toBlocker);
  return {
    id: raw?.id,
    identifier: raw?.identifier,
    title: raw?.title,
    sortOrder: raw?.sortOrder,
    state: raw?.state ?? null,
    labels,
    blockers,
  };
}

export function resolveLinearApiKey({ env = process.env, readSecretImpl = readSecret } = {}) {
  if (env.LINEAR_API_KEY) return env.LINEAR_API_KEY;
  return readSecretImpl('linear');
}

export function createLinearClient({ apiKey, linearGraphQLImpl = linearGraphQL, fetchImpl = fetch } = {}) {
  const callOpts = { apiKey, fetchImpl };
  return {
    async findState({ teamName = DEFAULT_TEAM_NAME, stateName = DEFAULT_STATE_NAME } = {}) {
      const data = await linearGraphQLImpl(TEAM_STATES_QUERY, { teamName }, callOpts);
      const team = data?.teams?.nodes?.[0];
      if (!team) return null;
      return (team.states?.nodes ?? []).find((state) => state.name === stateName) ?? null;
    },

    async listIssuesInState(stateId) {
      const data = await linearGraphQLImpl(READY_ISSUES_QUERY, { stateId }, callOpts);
      const connection = data?.issues;
      // 100 cards in one column is already pathological for a width-1 queue;
      // fail loudly rather than silently ignore the overflow.
      if (connection?.pageInfo?.hasNextPage) {
        throw new Error('ready-queue: more than 100 issues are in Ready -- paginate before trusting this list');
      }
      return (connection?.nodes ?? []).map(normalizeIssue);
    },

    async comment({ issueId, body }) {
      const data = await linearGraphQLImpl(COMMENT_CREATE_MUTATION, { issueId, body }, callOpts);
      if (!data?.commentCreate?.success) {
        throw new Error(`ready-queue: Linear commentCreate did not report success for ${issueId}`);
      }
      return data.commentCreate.comment;
    },

    // Look up the requested label names on the team. Returns
    // `{ found: { name: id }, missing: [name] }` -- a name that is not on the
    // team yet is reported, never thrown, so the caller can skip it.
    async findLabels({ teamName = DEFAULT_TEAM_NAME, names = [] } = {}) {
      const byName = new Map();
      let after = null;
      // A cursor that does not advance, or a connection that never ends, is an
      // error rather than a silent partial read -- the same discipline
      // board-setup.mjs's paginate() uses.
      for (let page = 0; page < 100; page += 1) {
        const data = await linearGraphQLImpl(TEAM_LABELS_QUERY, { teamName, after }, callOpts);
        const team = data?.teams?.nodes?.[0];
        const connection = team?.labels;
        for (const label of connection?.nodes ?? []) byName.set(label.name, label.id);
        if (!connection?.pageInfo?.hasNextPage) break;
        const next = connection.pageInfo.endCursor;
        if (next == null || next === after) {
          throw new Error(`ready-queue: Linear reported another page of ${teamName} labels but returned no usable cursor`);
        }
        after = next;
        if (page === 99) throw new Error(`ready-queue: reading ${teamName}'s labels did not terminate after 100 pages`);
      }
      const found = {};
      const missing = [];
      for (const name of names) {
        if (byName.has(name)) found[name] = byName.get(name);
        else missing.push(name);
      }
      return { found, missing };
    },

    async addLabels({ issueId, labelIds }) {
      if (!labelIds || labelIds.length === 0) return null;
      const data = await linearGraphQLImpl(ISSUE_ADD_LABELS_MUTATION, { issueId, labelIds }, callOpts);
      if (data?.issueUpdate?.success === false) {
        throw new Error(`ready-queue: Linear issueUpdate did not add labels to ${issueId}`);
      }
      return data?.issueUpdate?.issue ?? null;
    },

    async setIssueState({ issueId, stateId }) {
      const data = await linearGraphQLImpl(ISSUE_SET_STATE_MUTATION, { issueId, stateId }, callOpts);
      if (data?.issueUpdate?.success === false) {
        throw new Error(`ready-queue: Linear issueUpdate did not move ${issueId} to state ${stateId}`);
      }
      return data?.issueUpdate?.issue ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// One check cycle
// ---------------------------------------------------------------------------

function normalizeState(state) {
  return {
    ready: state?.ready ?? {},
    commented: state?.commented ?? {},
    started: startedRecords(state),
  };
}

function readyFingerprints(issues) {
  const map = {};
  for (const issue of issues) map[issue.id] = issueFingerprint(issue);
  return map;
}

// D3: add whatever model/effort labels the card is missing, defaulted to the
// seat-table primary model and Medium. A label that is not on the team yet is
// skipped and logged, never an error -- the model/effort labels are created by
// a later coordinator step, so the queue must work before they exist. Returns
// the label names actually added (for the start fingerprint); any Linear
// failure is logged and the start still proceeds.
export async function addMissingSeatLabels(issue, {
  linear,
  teamName = DEFAULT_TEAM_NAME,
  logErrorImpl = console.error,
} = {}) {
  const missing = missingSeatLabels(issue?.labels);
  if (missing.length === 0) return [];

  let found = {};
  let absent = [];
  try {
    ({ found, missing: absent } = await linear.findLabels({ teamName, names: missing }));
  } catch (error) {
    logErrorImpl(`ready-queue: could not look up the default seat labels on team ${teamName}: ${error.message}`);
    return [];
  }
  if (absent.length > 0) {
    logErrorImpl(`ready-queue: default seat label(s) not on team ${teamName}, skipping: ${absent.join(', ')}`);
  }

  const names = Object.keys(found);
  if (names.length === 0) return [];
  try {
    await linear.addLabels({ issueId: issue.id, labelIds: names.map((name) => found[name]) });
  } catch (error) {
    logErrorImpl(`ready-queue: could not add the default seat labels to ${issue.identifier}: ${error.message}`);
    return [];
  }
  return names;
}

export async function readyQueueCheck(options = {}) {
  const {
    linear: providedLinear,
    linearGraphQLImpl = linearGraphQL,
    apiKey,
    readSecretImpl = readSecret,
    teamName = DEFAULT_TEAM_NAME,
    stateName = DEFAULT_STATE_NAME,
    runListImpl = runList,
    taskListImpl = taskList,
    isRunFinishedImpl = isRunFinished,
    terminalCreateImpl = terminalCreate,
    statePath = DEFAULT_STATE_PATH,
    readStateImpl = readState,
    writeStateImpl = writeState,
    now = () => Date.now(),
    validateModelChoiceImpl = defaultValidateModelChoice,
    checkForToddGuardImpl = checkForToddGuard,
    logErrorImpl = console.error,
    intervalMinutes = DEFAULT_INTERVAL_MINUTES,
  } = options;

  const linear = providedLinear ?? createLinearClient({
    apiKey: apiKey ?? resolveLinearApiKey({ readSecretImpl }),
    linearGraphQLImpl,
  });

  // (a) Resolve the board's Ready state. It does not exist yet on this board
  // (creating it is a later, Todd-approved step), so absent means a quiet
  // no-op -- never an error.
  const readyState = await linear.findState({ teamName, stateName });
  if (!readyState) return { status: 'no-ready-state', teamName, stateName, intervalMinutes };

  // (b) Width 1: any active run, for any issue, means do nothing else. Not even
  // the state file is rewritten, so a card that entered during a busy period
  // still gets its full one-check wait afterwards.
  const busy = await isSlotBusy({ runListImpl, isRunFinishedImpl, taskListImpl, now });
  if (busy) return { status: 'slot-busy', intervalMinutes };

  // (c) The Ready cards in board order. JUL-97 step 2, item 6b: the queue
  // walks them and starts the FIRST card that can actually run, instead of
  // stopping at the top one. A card that cannot run is passed over, never
  // moved and never relabelled -- it keeps its place in Ready and, when it is
  // ineligible, still gets exactly one comment per distinct fingerprint.
  const issues = await linear.listIssuesInState(readyState.id);
  const previous = normalizeState(await readStateImpl({ statePath }));
  const ordered = sortCardsByBoardOrder(issues);
  const currentReady = readyFingerprints(issues);

  if (ordered.length === 0) {
    // Persist the now-empty set so a card that left Ready since the last check
    // is forgotten -- if it later returns it must earn a fresh full check.
    await writeStateImpl({
      ...previous,
      ready: currentReady,
      started: pruneStarted(previous.started, currentReady),
    }, { statePath });
    return { status: 'empty-ready', intervalMinutes };
  }

  // Everything the walk accumulates before a card is chosen: the comment
  // bookkeeping for the cards passed over, why each was passed over, and the
  // very first reason -- which is what the cycle reports when no card can run,
  // so a queue with one stuck card says exactly what today's queue says.
  const nextCommented = { ...previous.commented };
  const skipped = [];
  let chosen = null;
  let firstBlock = null;

  const passOver = (result) => {
    skipped.push({ issue: result.issue, status: result.status, reasons: result.reasons ?? null });
    firstBlock ??= result;
  };

  for (const issue of ordered) {
    const fingerprint = issueFingerprint(issue);

    // (d0) The restart-after-finish guard (JUL-79 step 5, D4 belt 2). A card
    // the queue already started is never started again while its fingerprint
    // is unchanged -- but ONLY as the fallback for belt 1 having failed. Belt
    // 2 exists to catch the case where the state move below did not happen and
    // the card therefore stayed in Ready with its run finished; when the state
    // move succeeded the card left Ready, so it reappearing in Ready is a
    // fresh, deliberate re-queue and must be admitted normally. A card that
    // genuinely changed earns a new fingerprint and is allowed through.
    // The record is looked up by THIS card's id, so starting some other card
    // in an earlier cycle cannot have erased it.
    const lastStarted = previous.started[issue.id];
    if (
      lastStarted &&
      !lastStarted.stateMoved &&
      lastStarted.fingerprint === fingerprint
    ) {
      passOver({ status: 'cooldown', issue: issue.identifier });
      continue;
    }

    // (d) One-full-check rule: a card is a candidate only if the previous
    // check already saw it in Ready.
    if (!(issue.id in previous.ready)) {
      passOver({ status: 'first-sighting', issue: issue.identifier });
      continue;
    }

    // (e) Ineligible -> one comment per distinct fingerprint, then quiet, and
    // on to the next card.
    const { eligible, reasons } = evaluateEligibility(issue, { validateModelChoiceImpl });
    if (eligible) {
      chosen = issue;
      break;
    }
    const alreadyCommented = previous.commented[issue.id] === fingerprint;
    let commented = false;
    let refused = false;
    if (!alreadyCommented) {
      const body = ineligibleCommentBody(issue, reasons);
      // The same For-Todd guard every Linear post goes through. A refusal must
      // never crash the check cycle: log it (the timer's journal picks up
      // stderr) and skip just this one comment, then record the fingerprint so
      // the queue stays quiet rather than retrying a comment that will always
      // be refused while the card is unchanged.
      const guard = checkForToddGuardImpl(body);
      if (guard.ok) {
        await linear.comment({ issueId: issue.id, body });
        commented = true;
      } else {
        refused = true;
        logErrorImpl(`ready-queue: refused to post the explanation comment for ${issue.identifier} (For-Todd guard rule: ${guard.rule}): ${guard.reason}`);
      }
    }
    nextCommented[issue.id] = fingerprint;
    passOver({ status: 'ineligible', issue: issue.identifier, reasons, commented, refused });
  }

  if (!chosen) {
    // Nothing in Ready can run right now. Report the first card's reason --
    // the same status this cycle reported before the walk existed -- and list
    // every card passed over.
    await writeStateImpl({
      ...previous,
      ready: currentReady,
      commented: nextCommented,
      started: pruneStarted(previous.started, currentReady),
    }, { statePath });
    return { ...firstBlock, skipped, intervalMinutes };
  }

  // (f) Start it. Before anything is created, make the card show exactly what
  // will run: add the default model/effort labels it is missing (D3). A label
  // that is not on the board yet is skipped, never an error. The fingerprint
  // recorded below reflects the labels the card will actually carry, so the
  // cooldown still matches on the next check.
  const existingLabels = [...(chosen.labels ?? [])];
  const addedLabels = await addMissingSeatLabels(chosen, { linear, teamName, logErrorImpl });
  const startFingerprint = issueFingerprint({
    ...chosen,
    labels: [...existingLabels, ...addedLabels],
  });

  // julia-run self-configures its environment and refuses a double-start; a
  // plain Orca terminal is what gives it ORCA_TERMINAL_HANDLE.
  const created = await terminalCreateImpl({
    environment: ORCHESTRATOR_ENVIRONMENT,
    worktree: `path:${ORCHESTRATOR_CHECKOUT}`,
    command: `node ${ORCHESTRATOR_CHECKOUT}/scripts/julia-run.mjs ${chosen.identifier}`,
    title: `ready-queue-${chosen.identifier}`,
  });

  // (f2) D4 belt 1: move the started card out of Ready through the injected
  // Linear client. A failure here is logged but must never undo the start, and
  // the per-issue start record below (belt 2) still holds the cooldown.
  let stateMoved = false;
  try {
    const inProgress = await linear.findState({ teamName, stateName: IN_PROGRESS_STATE_NAME });
    if (inProgress) {
      await linear.setIssueState({ issueId: chosen.id, stateId: inProgress.id });
      stateMoved = true;
    } else {
      logErrorImpl(`ready-queue: no "${IN_PROGRESS_STATE_NAME}" state on team ${teamName}; could not move ${chosen.identifier} out of Ready`);
    }
  } catch (error) {
    logErrorImpl(`ready-queue: could not move ${chosen.identifier} out of Ready: ${error.message}`);
  }

  // Drop the started card from the recorded Ready set: if it is somehow still
  // in Ready on the next check, it must earn another full check before it can
  // start again (and julia-run will refuse while its run is active anyway).
  // The cards passed over keep their recorded fingerprints, so none of them is
  // commented on twice.
  const nextReady = { ...currentReady };
  delete nextReady[chosen.id];
  delete nextCommented[chosen.id];
  await writeStateImpl({
    ...previous,
    ready: nextReady,
    commented: nextCommented,
    // Merge, never replace: every other card's cooldown survives this start.
    started: {
      ...pruneStarted(previous.started, currentReady),
      [chosen.id]: {
        identifier: chosen.identifier,
        at: new Date(now()).toISOString(),
        fingerprint: startFingerprint,
        // Belt 2 only applies when belt 1 (the state move) failed: a card that
        // really left Ready cannot be legitimately re-queued by this guard.
        stateMoved,
      },
    },
  }, { statePath });

  return {
    status: 'started',
    issue: chosen.identifier,
    terminalHandle: created?.terminal?.handle,
    stateMoved,
    skipped,
    intervalMinutes,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const parsed = { check: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') parsed.check = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--interval-minutes') parsed.intervalMinutesFlag = argv[++i];
    else if (arg.startsWith('--interval-minutes=')) parsed.intervalMinutesFlag = arg.slice('--interval-minutes='.length);
    else if (arg === '--state-path') parsed.statePath = argv[++i];
    else if (arg.startsWith('--state-path=')) parsed.statePath = arg.slice('--state-path='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

export function resolveIntervalMinutes({ flag, env = process.env } = {}) {
  const raw = flag ?? env.READY_QUEUE_INTERVAL_MINUTES;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_INTERVAL_MINUTES;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--interval-minutes must be a positive number of minutes, got ${JSON.stringify(raw)}`);
  }
  return value;
}

const USAGE = `usage: node scripts/ready-queue.mjs --check [--interval-minutes N] [--state-path PATH]

Runs exactly ONE Ready-queue check cycle and exits; this script never sleeps.
The systemd timer (a later step) is what repeats it. Pass --interval-minutes
to match that timer's OnUnitActiveSec (default ${DEFAULT_INTERVAL_MINUTES}, or
READY_QUEUE_INTERVAL_MINUTES); the value is reported, never waited on.

  --check                 perform one check cycle (required)
  --interval-minutes N    expected timer interval in minutes (default ${DEFAULT_INTERVAL_MINUTES})
  --state-path PATH       state file (default ${DEFAULT_STATE_PATH})
`;

export function describeResult(result) {
  switch (result?.status) {
    case 'no-ready-state':
      return `no workflow state named "${result.stateName}" on team ${result.teamName} -- nothing to do`;
    case 'slot-busy':
      return 'a run is already in flight on orchestrator-local -- no action (width 1)';
    case 'empty-ready':
      return 'Ready is empty -- no action';
    case 'first-sighting':
      return `${result.issue} is newly in Ready -- waiting one full check before it can start`;
    case 'cooldown':
      return `${result.issue} was already started by this queue and has not changed since -- not starting it again`;
    case 'ineligible':
      if (result.refused) {
        return `${result.issue} is ineligible (${result.reasons.join('; ')}) -- refused to post the explanation comment (For-Todd guard); the refusal is logged and the queue stays quiet for this fingerprint`;
      }
      return `${result.issue} is ineligible (${result.reasons.join('; ')}) -- ${result.commented ? 'posted one comment' : 'already commented, staying quiet'}`;
    case 'started': {
      const passedOver = result.skipped ?? [];
      return passedOver.length === 0
        ? `started ${result.issue}`
        : `started ${result.issue} (passed over ${passedOver.map((entry) => `${entry.issue}: ${entry.status}`).join('; ')})`;
    }
    default:
      return `unknown ready-queue status: ${JSON.stringify(result)}`;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.check) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const intervalMinutes = resolveIntervalMinutes({ flag: options.intervalMinutesFlag });
  const result = await readyQueueCheck({
    ...(options.statePath ? { statePath: options.statePath } : {}),
    intervalMinutes,
  });
  console.log(describeResult(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
