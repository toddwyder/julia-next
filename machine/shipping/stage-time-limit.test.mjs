// A stage that answers with a document, such as the retro, still gets a wall
// clock: it has no verdict and no step boundary that marks it getting nowhere.
// A Shipping review no longer uses this clock, because each way a review can
// get nowhere has its own stop in `stops.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { IDLE_STOP_MS, limitNote, runWithinTimeLimit } from './stops.mjs';

const neverAnswers = () => new Promise(() => {});

test('a stage that never answers is ended by the clock and says so', async () => {
  const lines = [];
  let ended = 0;
  const started = Date.now();

  const result = await runWithinTimeLimit(neverAnswers, {
    limitMs: 60,
    onLimit: async () => {
      ended += 1;
    },
    log: line => lines.push(line),
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.value, undefined);
  assert.equal(ended, 1, 'the hung stage is stopped, not left running');
  assert.ok(Date.now() - started < 5000, 'the clock ended the stage instead of waiting for it');
  assert.match(lines.join('\n'), /longer than/);
});

test('a stage that answers is handed back and the clock does not hold the process', async () => {
  let ended = 0;

  const result = await runWithinTimeLimit(async () => 'RETRO', {
    limitMs: 60_000,
    onLimit: async () => {
      ended += 1;
    },
    log: () => {},
  });

  assert.equal(result.timedOut, false);
  assert.equal(result.value, 'RETRO');
  assert.equal(ended, 0, 'a stage that answers is never treated as hung');
});

test('the note the stop quotes counts minutes in plain words', () => {
  assert.equal(limitNote(60_000), 'longer than 1 minute');
  assert.equal(limitNote(20 * 60_000), 'longer than 20 minutes');
});

test('a Shipping review is stopped by its idle rule, not by a wall clock', () => {
  assert.equal(IDLE_STOP_MS, 7 * 60_000);
});
