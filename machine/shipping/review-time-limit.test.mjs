// A review that never answers used to hold the run open until a person
// noticed and killed it. These tests pin the clock that now ends it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { REVIEW_TIME_LIMIT_MS, runWithinTimeLimit } from './workflow.mjs';

const neverAnswers = () => new Promise(() => {});

test('a review that never answers is ended by the clock and says so', async () => {
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
  assert.equal(ended, 1, 'the hung review is stopped, not left running');
  assert.ok(Date.now() - started < 5000, 'the clock ended the review instead of waiting for it');
  assert.match(lines.join('\n'), /longer than/);
});

test('a review that answers is handed back and the clock does not hold the process', async () => {
  let ended = 0;

  const result = await runWithinTimeLimit(async () => 'VERDICT: PASS', {
    limitMs: 60_000,
    onLimit: async () => {
      ended += 1;
    },
    log: () => {},
  });

  assert.equal(result.timedOut, false);
  assert.equal(result.value, 'VERDICT: PASS');
  assert.equal(ended, 0, 'a review that answers is never treated as hung');
});

test('a review is given twenty minutes by default', () => {
  assert.equal(REVIEW_TIME_LIMIT_MS, 20 * 60_000);
});
