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

import { MODEL_SPECS, DEFAULT_MODEL_SUFFIX_BY_ENTRY } from '../scripts/seat-labels.mjs';
import { EFFORT_LEVELS, DEFAULT_EFFORT } from '../scripts/effort.mjs';
import { SEAT_TABLE } from './seat-table.mjs';

// The team this whole board belongs to. The id is the stable machine handle;
// the name is what humans and the filters say.
export const TEAM_NAME = 'Julia-next';
export const TEAM_ID = '31138162-65a4-4dd3-bcc8-6b6ac0709bca';

// The eight columns, in board order. `position` is assigned from the array
// index by the setup program (0 for the first), never stored here, so the
// order is the array and cannot get out of step with it.
export const WORKFLOW_STATES = Object.freeze([
  Object.freeze({ name: 'Backlog', type: 'backlog' }),
  Object.freeze({ name: 'Ready', type: 'unstarted' }),
  Object.freeze({ name: 'Implementation', type: 'started' }),
  Object.freeze({ name: 'Code review', type: 'started' }),
  Object.freeze({ name: 'Remediation', type: 'started' }),
  Object.freeze({ name: 'Staging/smoke test', type: 'started' }),
  Object.freeze({ name: 'UAT', type: 'started' }),
  Object.freeze({ name: 'Complete', type: 'completed' }),
]);

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

// The three statuses a card can be parked in, each with the one-line reason
// shown on the label itself. Every description is a sentence a reader can act
// on: what the status means, not who set it.
export const STATUS_LABELS = Object.freeze({
  group: 'Status',
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

// The six agents the graph runs, each with the label-group names it owns. The
// `code` is the label prefix: model labels are `<code>-<model suffix>` and
// effort labels are `<code>-effort-<level>`, exactly the convention
// scripts/seat-labels.mjs already uses. `key` is the SEAT_TABLE entry the
// default model is read from.
export const GRAPH_AGENTS = Object.freeze([
  Object.freeze({ key: 'feature-builder', code: 'builder', modelGroup: 'Feature builder model', effortGroup: 'Feature builder effort' }),
  Object.freeze({ key: 'defect-fixer', code: 'fixer', modelGroup: 'Defect fixer model', effortGroup: 'Defect fixer effort' }),
  Object.freeze({ key: 'refactor', code: 'refactor', modelGroup: 'Refactor model', effortGroup: 'Refactor effort' }),
  Object.freeze({ key: 'adversarial-reviewer', code: 'adversary', modelGroup: 'Adversarial reviewer model', effortGroup: 'Adversarial reviewer effort' }),
  Object.freeze({ key: 'evidence-reviewer', code: 'evidence', modelGroup: 'Evidence reviewer model', effortGroup: 'Evidence reviewer effort' }),
  Object.freeze({ key: 'consultant', code: 'consultant', modelGroup: 'Consultant model', effortGroup: 'Consultant effort' }),
]);

// Label groups the graph no longer uses. They are ARCHIVED (not deleted) so a
// card that still carries one keeps the label and its history; the setup
// program only touches them if the live board actually has them.
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
// seat-table primary model (through DEFAULT_MODEL_SUFFIX_BY_ENTRY) and Medium
// effort. Returned as an array so the template builder can pass it straight
// through, and the order (model, effort) is stable for tests.
export function defaultLabelsFor(agentKey) {
  const { code } = graphAgent(agentKey);
  const entry = SEAT_TABLE[agentKey]?.primary;
  if (!entry) {
    throw new Error(`board-spec: graph agent '${agentKey}' has no seat-table primary entry`);
  }
  const suffix = DEFAULT_MODEL_SUFFIX_BY_ENTRY[entry];
  if (!suffix) {
    throw new Error(`board-spec: seat-table entry '${entry}' has no default model suffix`);
  }
  return [`${code}-${suffix}`, `${code}-effort-${DEFAULT_EFFORT}`];
}

// The Linear IssueFilter both the saved view and the evidence count use. It
// says exactly what the view's name says: this team, and no label named
// Decision or Parent. `none` means "the card has no label from this set", which
// is the honest reading of "label is not X" (a card with many labels still
// passes when neither is present).
export function workViewIssueFilter(teamId = TEAM_ID) {
  return {
    team: { id: { eq: teamId } },
    labels: { none: { name: { in: [...WORK_VIEW.excludedLabels] } } },
  };
}

// A local, pure predicate with the same meaning, for callers that already have
// a card's label names (for example a test, or a future board audit). Kept in
// one place so the saved view and the predicate cannot disagree.
export function matchesWorkView(labelNames = []) {
  const present = new Set(labelNames);
  return !WORK_VIEW.excludedLabels.some((label) => present.has(label));
}
