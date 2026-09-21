// columns.mjs -- JUL-98 step 2, item 4: the board's nine columns and the moves
// between them.
//
// The columns are NOT listed here. They are graph/board-spec.mjs's
// WORKFLOW_STATES, which scripts/board-setup.mjs built the live board from
// (JUL-97, Complete 2026-09-21 11:31Z). Keeping one list means a column
// inserted on the board cannot leave the controller walking a different route
// from the one the board has, and `workflowColumnIndex` is the same ordering
// scripts/ready-queue.mjs already uses to decide when a blocker is cleared.
//
// The rules this file enforces, from the card's Sep 20 amendment:
//   * the nine columns are crossed IN ORDER;
//   * a card whose work has nothing a person could look at skips
//     `Staging/smoke test` and `Evidence review`, and the one comment for that
//     move says why;
//   * a card that DOES have something to look at cannot skip them -- asking is
//     refused, not quietly honoured;
//   * `Code review` is never skipped by anything;
//   * `Remediation` is entered only when a review actually found something
//     (what happens inside it is ticket 4, not this step);
//   * the controller stops at `UAT`. Acceptance is Todd's and is not built yet.
//
// Pure: it decides, it does not move anything and it posts nothing.

import { WORKFLOW_STATE_NAMES, workflowColumnIndex } from '../board-spec.mjs';

export const CONTROLLER_COLUMNS = WORKFLOW_STATE_NAMES;

// The two columns whose work Journey 0 owns, and the only two a card may skip.
export const SKIPPABLE_COLUMNS = Object.freeze(['Staging/smoke test', 'Evidence review']);

// Stated as its own constant because "no card ever skips Code review" is a rule
// in its own right, not a consequence of the walk.
export const NEVER_SKIPPED_COLUMN = 'Code review';

export const FIRST_WORKED_COLUMN = 'Implementation';
export const LAST_COLUMN = CONTROLLER_COLUMNS[CONTROLLER_COLUMNS.length - 1];

// Where the controller's authority ends.
export const CONTROLLER_LAST_COLUMN = 'UAT';

const REMEDIATION = 'Remediation';

const NOTHING_TO_LOOK_AT =
  'this card\'s work has nothing a person could look at, so there is nothing to smoke-test and no evidence to review';
const NO_FINDINGS = 'the review found nothing to fix';

// A sanity check on the one list, run at import: nine columns, in the order the
// amendment names, with Code review before Remediation and both evidence
// columns present. A board spec that drifted would fail here rather than send a
// card down a route that does not exist.
for (const required of [NEVER_SKIPPED_COLUMN, CONTROLLER_LAST_COLUMN, REMEDIATION, ...SKIPPABLE_COLUMNS]) {
  if (workflowColumnIndex(required) < 0) {
    throw new Error(`controller/columns: the board spec has no "${required}" column (columns: ${CONTROLLER_COLUMNS.join(', ')})`);
  }
}

// Does the card enter this column at all?
function entersColumn(column, { hasReviewableOutput, needsRemediation }) {
  if (column === REMEDIATION) return needsRemediation === true;
  if (SKIPPABLE_COLUMNS.includes(column)) return hasReviewableOutput !== false;
  return true;
}

function skipReasonFor(skipped) {
  const reasons = [];
  if (skipped.some((column) => SKIPPABLE_COLUMNS.includes(column))) reasons.push(NOTHING_TO_LOOK_AT);
  if (skipped.includes(REMEDIATION)) reasons.push(NO_FINDINGS);
  return reasons.join('; ');
}

// The next column for a card sitting in `current`.
//
// `hasReviewableOutput` -- is there something a person could look at? Default
// true: a card is assumed to have something to show unless the controller has
// established otherwise, so the two evidence columns are never skipped by
// omission.
// `needsRemediation` -- did the review find something? Default false.
// `skipStagingAndEvidence` -- an explicit request to skip the two. Present so
// the refusal is real: a caller that asks for a skip on a card with something
// to look at gets `{ ok: false }` and no destination.
//
// Returns `{ ok: true, to, skipped, skipReason }` or `{ ok: false, reason }`.
export function nextColumnFor(current, {
  hasReviewableOutput = true,
  needsRemediation = false,
  skipStagingAndEvidence = false,
} = {}) {
  const index = workflowColumnIndex(current);
  if (index < 0) {
    return { ok: false, reason: `"${current}" is not one of the board's nine columns (${CONTROLLER_COLUMNS.join(', ')})` };
  }
  if (current === CONTROLLER_LAST_COLUMN) {
    return {
      ok: false,
      reason: `${CONTROLLER_LAST_COLUMN} is where the controller stops: moving a card to ${LAST_COLUMN} is Todd's acceptance, which the controller never does`,
    };
  }
  if (index >= CONTROLLER_COLUMNS.length - 1) {
    return { ok: false, reason: `"${current}" is the last column on the board; there is nowhere further to move` };
  }
  if (skipStagingAndEvidence && hasReviewableOutput !== false) {
    return {
      ok: false,
      reason: `refusing to skip ${SKIPPABLE_COLUMNS.join(' and ')}: this card has something a person could look at, so it must cross both`,
    };
  }

  // Remediation sits BEFORE the evidence columns on the board, so a card that
  // needs remediation goes back to Code review from there rather than forward:
  // nothing reaches UAT without a review of the work that actually landed.
  if (current === REMEDIATION) {
    return { ok: true, to: NEVER_SKIPPED_COLUMN, skipped: [], skipReason: '' };
  }

  const skipped = [];
  for (let i = index + 1; i < CONTROLLER_COLUMNS.length; i += 1) {
    const column = CONTROLLER_COLUMNS[i];
    // The controller never moves a card into the final column.
    if (column === LAST_COLUMN) break;
    if (entersColumn(column, { hasReviewableOutput, needsRemediation })) {
      return { ok: true, to: column, skipped, skipReason: skipReasonFor(skipped) };
    }
    skipped.push(column);
  }
  return { ok: false, reason: `no column after "${current}" can be entered` };
}

// The whole route a card takes from `from` to UAT, as a list of moves. Used by
// the tests to pin the two routes, and by the controller to say up front which
// columns a card will cross.
export function walkColumns(from, options = {}) {
  const steps = [];
  let current = from;
  for (let guard = 0; guard < CONTROLLER_COLUMNS.length; guard += 1) {
    const move = nextColumnFor(current, options);
    if (!move.ok) break;
    steps.push({ from: current, ...move });
    current = move.to;
  }
  return steps;
}

// The ONE comment a column move posts. Every move gets exactly one of these,
// written by the controller, and it is the only place a skip is explained.
export function columnMoveComment({ identifier, from, move, at, detail }) {
  if (!move?.ok) throw new Error(`columnMoveComment: refused move for ${identifier} (${move?.reason ?? 'no reason given'})`);
  const stamp = at ? ` (${at})` : '';
  const lines = [
    `**${identifier}: ${from} -> ${move.to}.** Moved by the controller${stamp}.`,
  ];
  if (detail) lines.push('', detail);
  if (move.skipped.length > 0) {
    lines.push('', `Skipped: ${move.skipped.join(', ')} -- ${move.skipReason}.`);
  }
  return lines.join('\n');
}
