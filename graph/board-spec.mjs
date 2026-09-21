// board-spec.mjs -- JUL-97 step 1: the pure description of the Julia-next
// board the setup program (scripts/board-setup.mjs) makes real. No I/O and no
// Linear here: every name, group, description and filter the board should have
// is data, and the small functions below derive the model/effort label names
// from the SAME MODEL_SPECS the launch path already uses. That is what makes
// "the label the board shows" and "the model the seat runs" impossible to
// drift apart.
//
// The setup program reads this file, plans against the live board, and applies
// the plan. Keeping the spec pure means the plan can be tested with no network
// at all.

import { MODEL_SPECS, defaultModelSuffix, GRAPH_AGENTS } from '../scripts/seat-labels.mjs';
import { EFFORT_LEVELS, DEFAULT_EFFORT } from '../scripts/effort.mjs';
import { SEAT_TABLE } from './seat-table.mjs';

// The team this whole board belongs to. The id is the stable machine handle;
// the name is what humans and the filters say.
export const TEAM_NAME = 'Julia-next';
export const TEAM_ID = '31138162-65a4-4dd3-bcc8-6b6ac0709bca';

// The nine columns, in board order. `position` is assigned from the array
// index by the setup program (0 for the first), never stored here, so the
// order is the array and cannot get out of step with it. `color` is a fixed,
// sensible HEX per column: Linear's WorkflowStateCreateInput requires a color,
// and keeping it next to the name means every created state gets the same
// stable color on every run, from the one place the rest of the board shape
// lives. The type is fixed too -- WorkflowStateUpdateInput has no type field,
// so a created-or-renamed state whose live type differs is a blocking mismatch
// the setup reports rather than pretends to repair.
export const WORKFLOW_STATES = Object.freeze([
  Object.freeze({ name: 'Backlog', type: 'backlog', color: '#bec2c8' }),
  Object.freeze({ name: 'Ready', type: 'unstarted', color: '#e2e2e2' }),
  Object.freeze({ name: 'Implementation', type: 'started', color: '#f2c94c' }),
  Object.freeze({ name: 'Code review', type: 'started', color: '#f2994a' }),
  Object.freeze({ name: 'Remediation', type: 'started', color: '#eb5757' }),
  Object.freeze({ name: 'Staging/smoke test', type: 'started', color: '#bb87fc' }),
  // JUL-97 step 2: the evidence reviewer's own column, between the smoke test
  // and Todd's acceptance. Its Linear TYPE is `started` like every other
  // in-flight column -- only its POSITION in this list says it comes before
  // UAT, which is what makes the ordering below the one source of that fact.
  Object.freeze({ name: 'Evidence review', type: 'started', color: '#26b5ce' }),
  Object.freeze({ name: 'UAT', type: 'started', color: '#4ea7fc' }),
  Object.freeze({ name: 'Complete', type: 'completed', color: '#5e6ad2' }),
]);

// The column names in board order, as a plain list. Exported so a caller that
// needs to reason about "this column comes before that one" derives the answer
// from the same ordering the board is built from, instead of hardcoding a
// second copy that a later inserted column would silently invalidate.
export const WORKFLOW_STATE_NAMES = Object.freeze(WORKFLOW_STATES.map((state) => state.name));

// Where a state name sits in the board order, or -1 for a name that is not one
// of the spec's columns (Canceled and Duplicate, for instance). Matching is by
// exact name, the same way every other part of this spec matches.
export function workflowColumnIndex(stateName) {
  return WORKFLOW_STATE_NAMES.indexOf(String(stateName ?? ''));
}

// The name of the team template every new card starts from, and the ONE place
// it is spelled. scripts/board-setup.mjs creates the template with this name;
// every other code path, document and skill that creates a Linear card must
// name the same template, because Linear applies a team's default template
// only to a card a person creates in the app -- a card created through the API
// gets nothing unless the template is named (proven live 2026-09-20 with two
// throwaway cards: without the template, zero labels; with it, all twelve).
export const TEMPLATE_NAME = 'Julia-next agent defaults';

// Existing states are RENAMED, never deleted-and-recreated: a card points at a
// state id, so replacing the state would drop every card sitting in it. The
// setup program looks for the OLD name first and renames it. Canceled and
// Duplicate have no entry here and are left exactly as they are.
export const STATE_RENAMES = Object.freeze({
  Todo: 'Ready',
  'In Progress': 'Implementation',
  'In Review': 'Code review',
  Done: 'Complete',
});

// The label names Linear refuses to create. The API reserves them and rejects
// issueLabelCreate with a 400 INPUT_ERROR ("reserved label name"), compared
// case-insensitively. Keep the set here, in one place, so a future discovery of
// another reserved name is a one-line change.
export const RESERVED_LABEL_NAMES = Object.freeze(['status']);

// True when `name` is one of Linear's reserved label names. Case-insensitive,
// because the real API compared it that way: it refused "Status" while naming
// the reserved name "status".
export function isReservedLabelName(name) {
  const wanted = String(name ?? '').toLowerCase();
  return RESERVED_LABEL_NAMES.some((reserved) => reserved.toLowerCase() === wanted);
}

// The three statuses a card can be parked in, each with the one-line reason
// shown on the label itself. Every description is a sentence a reader can act
// on: what the status means, not who set it.
export const STATUS_LABELS = Object.freeze({
  // "Card status", NOT "Status": Linear reserves the label name "status"
  // (compared case-insensitively) and refused issueLabelCreate on the real
  // board on 2026-09-20 with userPresentableMessage
  // "The label name \"status\" is reserved." Do not rename this back.
  group: 'Card status',
  labels: Object.freeze([
    Object.freeze({
      name: 'waiting-on-todd',
      description: 'Assigned to Todd: an account action, a money decision, or a product decision or acceptance',
    }),
    Object.freeze({
      name: 'blocked',
      description: 'Cannot proceed until a named dependency is resolved',
    }),
    Object.freeze({
      name: 'stalled',
      description: 'Two review rounds spent without agreement; parked with the reasons on the card',
    }),
  ]),
});

// The six agents the graph runs, each with the label-group names it owns, are
// defined in scripts/seat-labels.mjs -- the single source of truth for the six
// agents, their label prefixes and their twelve group names (JUL-97 step 2,
// item 3). They are re-exported here because the board setup and this spec's
// own helpers read them as part of the board shape. The import direction is
// deliberate: this file already imports MODEL_SPECS from seat-labels.mjs, so
// defining them here and importing them back would be a circular import.
export { GRAPH_AGENTS };

// Label groups the graph no longer uses. They are RETIRED (not deleted):
// Linear's issueLabelRetire keeps the label visible on the cards that already
// carry it and only stops new applications. The setup program only touches
// them if the live board actually has them and they are not already retired.
export const RETIRED_LABEL_GROUPS = Object.freeze([
  'Orchestrator model',
  'Orchestrator effort',
]);

// The shared view every human and agent opens: the team's work, minus the two
// coordinate-only labels. Decision cards are answers, not work; Parent cards
// are the containers a work card hangs from. Showing either in the work view
// buries the real queue.
export const WORK_VIEW = Object.freeze({
  name: 'Work',
  description: 'Julia-next work only: no Decision label, no Parent label.',
  team: TEAM_NAME,
  excludedLabels: Object.freeze(['Decision', 'Parent']),
});

function graphAgent(agentKey) {
  const agent = GRAPH_AGENTS.find((candidate) => candidate.key === agentKey);
  if (!agent) {
    throw new Error(`board-spec: unknown graph agent '${agentKey}' -- must be one of ${GRAPH_AGENTS.map((a) => a.key).join(', ')}`);
  }
  return agent;
}

// Every model label the agent's group should hold, derived from MODEL_SPECS so
// a vendor model added there appears here automatically. Kept as a function
// (not a constant) so it can never be mutated by a caller.
export function modelLabelsFor(agentKey) {
  const { code } = graphAgent(agentKey);
  return Object.keys(MODEL_SPECS).map((suffix) => `${code}-${suffix}`);
}

// Every effort label the agent's group should hold: Low, Medium, High.
export function effortLabelsFor(agentKey) {
  const { code } = graphAgent(agentKey);
  return EFFORT_LEVELS.map((level) => `${code}-effort-${level}`);
}

// The two labels a new card gets from the team template: the agent's
// seat-table primary model (through defaultModelSuffix) and Medium
// effort. Returned as an array so the template builder can pass it straight
// through, and the order (model, effort) is stable for tests.
export function defaultLabelsFor(agentKey) {
  const { code } = graphAgent(agentKey);
  const entry = SEAT_TABLE[agentKey]?.primary;
  if (!entry) {
    throw new Error(`board-spec: graph agent '${agentKey}' has no seat-table primary entry`);
  }
  const suffix = defaultModelSuffix(agentKey, entry);
  if (!suffix) {
    throw new Error(`board-spec: seat-table entry '${entry}' has no default model suffix`);
  }
  return [`${code}-${suffix}`, `${code}-effort-${DEFAULT_EFFORT}`];
}

// The Linear IssueFilter both the saved view and the evidence count use. It
// says exactly what the view's name says: this team, and no label named
// Decision or Parent. Linear's IssueLabelCollectionFilter has no `none`; the
// supported exclusion is `every: { name: { nin: [...] } }`, which is true when
// EVERY label on the card is outside the excluded set. An unlabeled card has
// no labels to falsify that, so `every` is vacuously true and the card IS
// work -- exactly the intended meaning. A card carrying Decision or Parent (or
// both) fails the `every` and is excluded.
export function workViewIssueFilter(teamId = TEAM_ID) {
  return {
    team: { id: { eq: teamId } },
    labels: { every: { name: { nin: [...WORK_VIEW.excludedLabels] } } },
  };
}

// A local, pure predicate with the same meaning, for callers that already have
// a card's label names (for example a test, or a future board audit). Kept in
// one place so the saved view and the predicate cannot disagree.
export function matchesWorkView(labelNames = []) {
  const present = new Set(labelNames);
  return !WORK_VIEW.excludedLabels.some((label) => present.has(label));
}
