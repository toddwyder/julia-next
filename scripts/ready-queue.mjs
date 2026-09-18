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

import { linearGraphQL } from './linear-cli.mjs';
import { readSecret } from '../ops/service-dropbox/read-secret.mjs';
import { runList, taskList, terminalCreate } from './orca-cli.mjs';
// Reuse julia-run's own definition of "the run is done": a run with an active
// Task is in progress, a zero-Task run counts as active inside a 15-minute
// grace window, and completed/failed/stopped/cancelled are terminal. Sharing
// the function (instead of re-deriving it here) keeps the width-1 gate and the
// double-start guard telling the same story; julia-run.mjs's public behavior
// is unchanged.
import { isRunFinished } from './julia-run.mjs';

export const DEFAULT_TEAM_NAME = 'Julia-next';
export const DEFAULT_STATE_NAME = 'Ready';
export const DEFAULT_INTERVAL_MINUTES = 5;
export const READY_FOR_AGENT_LABEL = 'ready-for-agent';
export const ORCHESTRATOR_ENVIRONMENT = 'orchestrator-local';
export const ORCHESTRATOR_CHECKOUT = '/srv/orchestrator-svc/julia-next';

// The state file holds only what the previous check saw -- newly-ready cards
// (so a card counts only after one full check) and, per card, the fingerprint
// of the last ineligible state the queue already commented on. `lastStarted`
// is the record that a start happened; keeping it separate from `ready` is
// what makes the script idempotent if it is ever run twice for one card.
export const DEFAULT_STATE_PATH = join(os.homedir(), '.local', 'state', 'julia-next', 'ready-queue.json');

// ---------------------------------------------------------------------------
// Pure decision helpers
// ---------------------------------------------------------------------------

function sortOrderOf(issue) {
  const value = Number(issue?.sortOrder);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

// "Top card in Ready" is board order: the lowest `Issue.sortOrder`, not the
// order Linear happened to return the connection in. Ties keep the incoming
// (board) order -- Array.prototype.sort is stable, so copies preserve it.
export function pickTopCard(issues) {
  if (!issues || issues.length === 0) return null;
  return [...issues].sort((a, b) => sortOrderOf(a) - sortOrderOf(b))[0];
}

export function isBlockerClosed(blocker) {
  const state = blocker?.state ?? {};
  const type = String(state.type ?? '').toLowerCase();
  // Prefer the stable machine type when Linear returns one; fall back to the
  // human name for a blocker shape that only carries a name.
  if (type) return type === 'completed' || type === 'canceled';
  const name = String(state.name ?? '').toLowerCase();
  return name === 'done' || name === 'canceled' || name === 'cancelled';
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

// The real label-group -> model selection is a later step. Until it exists the
// validator exists only as this seam: an injected function returning
// `{ ok: true }` (or `{ ok: false, reason }`), so the queue's contract is
// tested now and the real rules can land behind it without touching the
// check cycle.
export function defaultValidateModelChoice() {
  return { ok: true };
}

export function evaluateEligibility(issue, { validateModelChoiceImpl = defaultValidateModelChoice } = {}) {
  const reasons = [];

  const labels = new Set(issue?.labels ?? []);
  if (!labels.has(READY_FOR_AGENT_LABEL)) {
    reasons.push(`missing the ${READY_FOR_AGENT_LABEL} label`);
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
  return { ready: {}, commented: {}, lastStarted: null };
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
    lastStarted: parsed?.lastStarted ?? null,
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

// Live-verified (JUL-79 readiness review, 2026-09-18): board order is
// `Issue.sortOrder` (a populated float, e.g. -28624) and the only allowed
// `PaginationOrderBy` values are createdAt/updatedAt, so the top card is
// sorted client-side. The exact field shape of the two queries below
// (`Team.states`, and both relation directions) was NOT exercised against the
// live API from this step -- it is written from Linear's public schema and
// must be re-checked on the first real run. The client boundary
// (`findState`/`listIssuesInState`/`comment`) is what the tests pin, so a
// query-shape fix is local to this one function.
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
          nodes { type relatedIssue { id identifier state { name type } } }
        }
        inverseRelations {
          nodes { type relatedIssue { id identifier state { name type } } }
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

function isBlockedByRelation(type) {
  return /^blocked[_\s-]?by$/i.test(String(type ?? ''));
}

function isBlocksRelation(type) {
  return /^blocks$/i.test(String(type ?? ''));
}

function toBlocker(relation) {
  const related = relation?.relatedIssue ?? relation;
  return {
    id: related?.id,
    identifier: related?.identifier,
    state: related?.state ?? null,
  };
}

// Turn a raw Linear issue (label/relation connections) into the small shape
// the queue reasons about. A blocker reaches this issue either as a
// `blocked_by` relation or as the inverse side of a `blocks` relation; both
// are collected, so the parse does not depend on which side Linear stores.
export function normalizeIssue(raw) {
  const labelNodes = raw?.labels?.nodes ?? raw?.labels ?? [];
  const labels = labelNodes.map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean);
  const blockers = [
    ...(raw?.relations?.nodes ?? []).filter((r) => isBlockedByRelation(r.type)).map(toBlocker),
    ...(raw?.inverseRelations?.nodes ?? []).filter((r) => isBlocksRelation(r.type)).map(toBlocker),
    ...((raw?.blockedBy ?? []).map(toBlocker)),
  ];
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
  };
}

// ---------------------------------------------------------------------------
// One check cycle
// ---------------------------------------------------------------------------

function normalizeState(state) {
  return {
    ready: state?.ready ?? {},
    commented: state?.commented ?? {},
    lastStarted: state?.lastStarted ?? null,
  };
}

function readyFingerprints(issues) {
  const map = {};
  for (const issue of issues) map[issue.id] = issueFingerprint(issue);
  return map;
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

  // (c) Top card in Ready by board order.
  const issues = await linear.listIssuesInState(readyState.id);
  const previous = normalizeState(await readStateImpl({ statePath }));
  const top = pickTopCard(issues);
  const currentReady = readyFingerprints(issues);

  if (!top) {
    // Persist the now-empty set so a card that left Ready since the last check
    // is forgotten -- if it later returns it must earn a fresh full check.
    await writeStateImpl({ ...previous, ready: currentReady }, { statePath });
    return { status: 'empty-ready', intervalMinutes };
  }

  // (d) One-full-check rule: a card is a candidate only if the previous check
  // already saw it in Ready. On the first sighting, record the whole Ready set
  // and leave everything alone.
  if (!(top.id in previous.ready)) {
    await writeStateImpl({ ...previous, ready: currentReady }, { statePath });
    return { status: 'first-sighting', issue: top.identifier, intervalMinutes };
  }

  // (e) Only the top card is ever a candidate. Ineligible -> one comment per
  // distinct fingerprint, then quiet.
  const { eligible, reasons } = evaluateEligibility(top, { validateModelChoiceImpl });
  if (!eligible) {
    const fingerprint = issueFingerprint(top);
    const alreadyCommented = previous.commented[top.id] === fingerprint;
    if (!alreadyCommented) {
      await linear.comment({ issueId: top.id, body: ineligibleCommentBody(top, reasons) });
    }
    await writeStateImpl({
      ...previous,
      ready: currentReady,
      commented: { ...previous.commented, [top.id]: fingerprint },
    }, { statePath });
    return {
      status: 'ineligible',
      issue: top.identifier,
      reasons,
      commented: !alreadyCommented,
      intervalMinutes,
    };
  }

  // (f) Start it. julia-run self-configures its environment and refuses a
  // double-start; a plain Orca terminal is what gives it ORCA_TERMINAL_HANDLE.
  const created = await terminalCreateImpl({
    environment: ORCHESTRATOR_ENVIRONMENT,
    worktree: `path:${ORCHESTRATOR_CHECKOUT}`,
    command: `node ${ORCHESTRATOR_CHECKOUT}/scripts/julia-run.mjs ${top.identifier}`,
    title: `ready-queue-${top.identifier}`,
  });

  // Drop the started card from the recorded Ready set: if it is somehow still
  // in Ready on the next check, it must earn another full check before it can
  // start again (and julia-run will refuse while its run is active anyway).
  const nextReady = { ...currentReady };
  delete nextReady[top.id];
  const nextCommented = { ...previous.commented };
  delete nextCommented[top.id];
  await writeStateImpl({
    ...previous,
    ready: nextReady,
    commented: nextCommented,
    lastStarted: {
      issueId: top.id,
      identifier: top.identifier,
      at: new Date(now()).toISOString(),
      fingerprint: issueFingerprint(top),
    },
  }, { statePath });

  return {
    status: 'started',
    issue: top.identifier,
    terminalHandle: created?.terminal?.handle,
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
    case 'ineligible':
      return `${result.issue} is ineligible (${result.reasons.join('; ')}) -- ${result.commented ? 'posted one comment' : 'already commented, staying quiet'}`;
    case 'started':
      return `started ${result.issue}`;
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
