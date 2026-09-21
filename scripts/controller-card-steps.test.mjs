// controller-card-steps.test.mjs -- JUL-98 step 3, item 8: the card shows its
// steps and ticks as it goes, written BY THE PROGRAM.
//
// Todd added this on 21 September: "all cards tick as they go". The checkbox
// count is his only view of progress, and an agent that is asked to remember to
// tick will eventually forget. So the step plan, the state of each line and
// every tick are produced by these functions, which are pure text in and text
// out: no Linear call, no clock, no memory.
//
// Crash-resume is deliberately NOT here. That is JUL-99, which builds on this.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPS_HEADING,
  STEP_STATES,
  renderStepsBlock,
  upsertStepsBlock,
  updateStep,
  tickAcceptanceBox,
  stepReportComment,
} from '../graph/controller/card-steps.mjs';

const PLAN = [
  { key: 'step-1', title: 'Fix the stale runbook lines' },
  { key: 'step-2', title: 'Fix the wrong settings' },
];

const DESCRIPTION = [
  '## What to build',
  '',
  'Some real work.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] The stale runbook guidance is gone.',
  '- [ ] The settings match what actually runs.',
  '',
  '## UAT plan',
  '',
  '1. I read the runbook.',
  '',
].join('\n');

test('a fresh plan is one plain-English line per step, none of them ticked', () => {
  const block = renderStepsBlock(PLAN);
  const lines = block.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^- \[ \] \*\*Fix the stale runbook lines\*\*/);
  assert.match(lines[0], /not started/);
  assert.ok(!block.includes('[X]'), 'nothing is ticked before it has happened');
});

test('a step in flight shows its state and its start time; a landed step shows both times and is ticked', () => {
  let steps = updateStep(PLAN, 'step-1', { state: 'building', startedAt: '2026-09-21T14:03:00Z' });
  let block = renderStepsBlock(steps);
  assert.match(block, /- \[ \] \*\*Fix the stale runbook lines\*\* -- building, 14:03Z-/);

  steps = updateStep(steps, 'step-1', { state: 'in review' });
  assert.match(renderStepsBlock(steps), /in review, 14:03Z-/);
  assert.ok(!renderStepsBlock(steps).includes('[X]'), 'a step in review has not landed');

  steps = updateStep(steps, 'step-1', { state: 'merged', endedAt: '2026-09-21T14:31:00Z' });
  block = renderStepsBlock(steps);
  assert.match(block, /- \[X\] \*\*Fix the stale runbook lines\*\* -- merged, 14:03Z-14:31Z/);
  assert.match(block, /- \[ \] \*\*Fix the wrong settings\*\* -- not started/, 'the other step is untouched');
});

test('the tick happens the moment the step lands -- it is not a separate thing to remember', () => {
  const steps = updateStep(PLAN, 'step-2', { state: 'merged', startedAt: '2026-09-21T15:00:00Z', endedAt: '2026-09-21T15:20:00Z' });
  assert.equal(steps[1].done, true, 'merged and ticked are the same act');
  assert.equal(steps[0].done, false);
});

test('a state the board does not have is refused rather than written onto the card', () => {
  assert.ok(STEP_STATES.includes('building') && STEP_STATES.includes('in review') && STEP_STATES.includes('merged'));
  assert.throws(() => updateStep(PLAN, 'step-1', { state: 'nearly done' }), /nearly done/);
  assert.throws(() => updateStep(PLAN, 'step-9', { state: 'building' }), /step-9/);
});

test('the block is written into the card description under a Steps heading, above the acceptance criteria', () => {
  const updated = upsertStepsBlock(DESCRIPTION, PLAN);
  assert.ok(updated.includes(STEPS_HEADING));
  assert.ok(updated.indexOf(STEPS_HEADING) < updated.indexOf('## Acceptance criteria'), 'Steps goes above the criteria');
  assert.ok(updated.includes('## What to build'), 'the rest of the card is untouched');
  assert.ok(updated.includes('## UAT plan'), 'and so is the UAT plan');
  assert.ok(updated.includes('1. I read the runbook.'));
});

test('writing the block again replaces it -- a card never grows a second Steps section', () => {
  const once = upsertStepsBlock(DESCRIPTION, PLAN);
  const moved = updateStep(PLAN, 'step-1', { state: 'building', startedAt: '2026-09-21T14:03:00Z' });
  const twice = upsertStepsBlock(once, moved);

  assert.equal(twice.split(STEPS_HEADING).length - 1, 1, 'exactly one Steps heading');
  assert.match(twice, /building, 14:03Z/);
  assert.ok(!twice.includes('Fix the stale runbook lines** -- not started'), 'the old line is gone, not left beside the new one');
});

test('a card with no Acceptance criteria section still gets its Steps block, at the end', () => {
  const plain = '## What to build\n\nSomething.\n';
  const updated = upsertStepsBlock(plain, PLAN);
  assert.ok(updated.startsWith('## What to build'));
  assert.ok(updated.includes(STEPS_HEADING));
});

// --- acceptance boxes -------------------------------------------------------

test('an acceptance box is ticked the moment its evidence exists, and the evidence goes on the line', () => {
  const result = tickAcceptanceBox(DESCRIPTION, {
    match: 'The settings match what actually runs',
    evidence: 'PR #77 (`abc1234`)',
  });

  assert.equal(result.ticked, true);
  assert.match(result.description, /- \[X\] The settings match what actually runs\. -- PR #77 \(`abc1234`\)/);
  assert.match(result.description, /- \[ \] The stale runbook guidance is gone\./, 'only the box with evidence is ticked');
});

test('a box cannot be ticked without evidence: that is the whole rule', () => {
  assert.throws(
    () => tickAcceptanceBox(DESCRIPTION, { match: 'The settings match what actually runs' }),
    /evidence/,
  );
});

test('a box that does not exist is refused, never silently ignored', () => {
  const result = tickAcceptanceBox(DESCRIPTION, { match: 'Something nobody wrote', evidence: 'x' });
  assert.equal(result.ticked, false);
  assert.match(result.reason, /Something nobody wrote/);
  assert.equal(result.description, DESCRIPTION, 'the card is returned unchanged');
});

test('a box that is already ticked is left alone, and says so', () => {
  const once = tickAcceptanceBox(DESCRIPTION, { match: 'The settings match', evidence: 'PR #77' });
  const twice = tickAcceptanceBox(once.description, { match: 'The settings match', evidence: 'PR #78' });
  assert.equal(twice.ticked, false);
  assert.match(twice.reason, /already ticked/);
  assert.ok(!twice.description.includes('PR #78'), 'the first evidence stands');
});

// --- the one comment a column move posts, with the step's evidence on it -----
//
// Item 9: every column move is ONE comment, written by the controller. Items 4
// and 5 say what must be on it for a step: the test run's times and counts, and
// one cost line per worker beside them.

test('the column-move comment carries the test run and every seat\'s cost line, and is one comment', () => {
  const body = stepReportComment({
    card: { identifier: 'JUL-92' },
    step: { key: 'step-1', title: 'Fix the stale runbook lines' },
    from: 'Implementation',
    move: { ok: true, to: 'Code review', skipped: [], skipReason: '' },
    at: '2026-09-21T14:31:00Z',
    testRunLine: '**Tests** (run once by the controller): 14:00:00Z-14:00:03Z, 3.1s -- 521 pass, 0 fail, 1 skipped of 522.',
    costText: [
      '- **Builder** -- claude-opus-5 -- 369,994 tokens -- peak context 62,524 -- 0.71 min -- $0.1057 -- no cap, no failover',
      '- **Reviewer** -- deepseek-v4-pro -- 121,247 tokens -- peak context 2,530 -- 10 min -- $0.0151 -- no cap, no failover',
    ],
  });

  assert.match(body, /Implementation -> Code review/);
  assert.match(body, /Moved by the controller/);
  assert.match(body, /Fix the stale runbook lines/);
  assert.match(body, /521 pass/);
  assert.match(body, /\*\*Builder\*\*/);
  assert.match(body, /\*\*Reviewer\*\*/);
  assert.equal(body.split('Moved by the controller').length - 1, 1, 'one comment, one move');
});

test('a move with no cost line for a seat is refused before it is ever posted', () => {
  assert.throws(
    () => stepReportComment({
      card: { identifier: 'JUL-92' },
      step: { key: 'step-1', title: 'x' },
      from: 'Implementation',
      move: { ok: true, to: 'Code review', skipped: [], skipReason: '' },
      testRunLine: 'tests',
      costText: [],
    }),
    /cost line/,
  );
});
