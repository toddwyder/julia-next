// card-steps.mjs -- JUL-98 step 3, item 8: the card shows its steps, and ticks
// as it goes. Written BY THE PROGRAM.
//
// Todd's rule, added 21 September: "all cards tick as they go". The checkbox
// count on a card is his only view of progress, and an agent asked to remember
// to tick will eventually forget -- which is why this is code and not a line in
// a skill. When a card starts, the controller writes its step plan under a
// `## Steps` heading in the card's description, one plain-English line per
// step. As each step moves, the line's state (building, in review, merged)
// changes with its start and end times, and the line is ticked THE MOMENT it
// lands -- ticking is not a separate act that could be skipped, it is what
// `merged` means. Acceptance boxes are ticked the same way, each with the
// evidence that earned it: a box cannot be ticked without one.
//
// Pure text in, text out. No Linear call, no clock, no state on disk. Crash
// resume and per-attempt detail are JUL-99, which builds on this file rather
// than re-creating it.

import { columnMoveComment } from './columns.mjs';

export const STEPS_HEADING = '## Steps';

// The states a step line may be in. `parked` is the two-rounds-then-stop
// outcome; what happens inside it is ticket 4.
export const STEP_STATES = Object.freeze(['not started', 'building', 'in review', 'merged', 'parked']);

// The one state that means the step landed, and therefore the one that ticks.
const LANDED = 'merged';

function stamp(iso) {
  if (!iso) return '';
  return `${String(iso).slice(11, 16)}Z`;
}

function times(step) {
  if (!step.startedAt && !step.endedAt) return '';
  return `, ${stamp(step.startedAt)}-${stamp(step.endedAt)}`;
}

export function renderStepLine(step) {
  const box = step.done ? '[X]' : '[ ]';
  const state = step.state ?? 'not started';
  const detail = step.detail ? ` ${step.detail}` : '';
  return `- ${box} **${step.title}** -- ${state}${times(step)}.${detail}`;
}

export function renderStepsBlock(steps) {
  return [
    STEPS_HEADING,
    '',
    ...steps.map(renderStepLine),
    '',
  ].join('\n');
}

// Move one step. Returns a NEW array: nothing here mutates the plan it is
// given, so a caller cannot half-apply a change.
export function updateStep(steps, key, patch = {}) {
  if (patch.state !== undefined && !STEP_STATES.includes(patch.state)) {
    throw new Error(`updateStep: ${JSON.stringify(patch.state)} is not a step state (${STEP_STATES.join(', ')})`);
  }
  const index = steps.findIndex((step) => step.key === key);
  if (index < 0) throw new Error(`updateStep: the plan has no step ${JSON.stringify(key)}`);

  const current = { state: 'not started', done: false, ...steps[index] };
  const next = { ...current, ...patch };
  // The tick and the landing are one act.
  next.done = next.state === LANDED;
  const out = [...steps];
  out[index] = next;
  // Every other step keeps its shape, with the defaults filled in so a
  // rendered block is consistent whether or not a step has moved yet.
  return out.map((step) => ({ state: 'not started', done: false, ...step }));
}

// Put the block into the card's description: replacing an existing `## Steps`
// section, or inserting one above `## Acceptance criteria` (and at the end when
// the card has no criteria section). A card never grows a second Steps heading.
export function upsertStepsBlock(description, steps) {
  const block = renderStepsBlock(steps);
  const text = String(description ?? '');
  const startIndex = text.indexOf(`${STEPS_HEADING}\n`);

  if (startIndex >= 0) {
    // Up to the next `## ` heading at the start of a line, or the end.
    const rest = text.slice(startIndex + STEPS_HEADING.length);
    const nextHeading = rest.search(/\n## /);
    const endIndex = nextHeading < 0 ? text.length : startIndex + STEPS_HEADING.length + nextHeading + 1;
    return `${text.slice(0, startIndex)}${block}\n${text.slice(endIndex)}`;
  }

  const criteria = text.indexOf('## Acceptance criteria');
  if (criteria >= 0) {
    return `${text.slice(0, criteria)}${block}\n${text.slice(criteria)}`;
  }
  return `${text.replace(/\s*$/, '')}\n\n${block}`;
}

// Tick one acceptance box, with the evidence that earned it.
//
// Returns `{ description, ticked, reason }`. The description comes back
// unchanged whenever nothing was ticked, so a caller can never post a card it
// thinks it changed and did not.
export function tickAcceptanceBox(description, { match, evidence } = {}) {
  if (!evidence) {
    // The rule, mechanically: the box is ticked the moment its evidence is
    // posted, so there is no way to tick one without any.
    throw new Error(`tickAcceptanceBox: no evidence given for ${JSON.stringify(match ?? null)} -- a box is ticked the moment its evidence exists, never before`);
  }
  const text = String(description ?? '');
  const lines = text.split('\n');

  const unticked = lines.findIndex((line) => /^\s*- \[ \] /.test(line) && line.includes(match));
  if (unticked >= 0) {
    lines[unticked] = `${lines[unticked].replace('- [ ] ', '- [X] ')} -- ${evidence}`;
    return { description: lines.join('\n'), ticked: true, reason: null };
  }

  const already = lines.some((line) => /^\s*- \[[Xx]\] /.test(line) && line.includes(match));
  return {
    description: text,
    ticked: false,
    reason: already
      ? `the box matching ${JSON.stringify(match)} is already ticked; its first evidence stands`
      : `no unticked acceptance box on this card matches ${JSON.stringify(match)}`,
  };
}

// The ONE comment a column move posts for a step (item 9), carrying what items
// 4 and 5 require to be on it: the test run's times and counts, and one cost
// line per worker beside them. The move line itself is ./columns.mjs's
// `columnMoveComment` -- imported, never re-worded, so the board's story and
// the code's cannot drift apart.
//
// A move with no cost line is refused HERE, before anything is posted: a blank
// cost line for any seat fails the step, and a card that has already been moved
// is the wrong place to discover it.
export function stepReportComment({ card, step, from, move, at, testRunLine, costText = [], extra = null }) {
  if (!costText.length) {
    throw new Error(`stepReportComment: no cost line for ${card?.identifier ?? 'this card'} ${step?.key ?? ''} -- a blank cost line for any seat fails the step, so the move is refused before it is posted`);
  }
  const detail = [
    `Step: **${step.title}**.`,
    ...(testRunLine ? ['', testRunLine] : []),
    '',
    '**Cost, per worker** (read before either worker was released):',
    ...costText,
    ...(extra ? ['', extra] : []),
  ].join('\n');
  return columnMoveComment({ identifier: card.identifier, from, move, at, detail });
}
