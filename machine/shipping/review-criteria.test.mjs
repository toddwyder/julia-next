// A review that stops early keeps the verdicts it reached, and the next review
// covers only the criteria still open. These tests pin the task the reviewer is
// handed, at the card's own numbering, and what a later round may judge.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reviewTask } from './workflow.mjs';
import { openCriteria } from '../remediation/reviews.mjs';

const card = { identifier: 'JUL-359', title: 'A review stops', description: 'Outcome text' };
const base = { pr: 487, sha: 'ef96aea', checkout: '/checkout', card };

test('the first review is handed every criterion at the card number', () => {
  const task = reviewTask({ ...base, criteria: ['the first thing', 'the second thing'], open: [1, 2] });
  assert.match(task, /^1\. the first thing$/m);
  assert.match(task, /^2\. the second thing$/m);
  assert.match(task, /Judge exactly these 2 criteria, and use the number shown beside each one:/);
  assert.match(task, /^CRITERION 1: PASS \| FAIL/m);
});

test('a later review is handed only the criteria still open, at their card numbers', () => {
  const task = reviewTask({ ...base, criteria: ['the first thing', 'the second thing', 'the third thing'], open: [2, 3] });
  assert.doesNotMatch(task, /^1\. the first thing$/m, 'a criterion already judged is not asked again');
  assert.match(task, /^2\. the second thing$/m);
  assert.match(task, /^3\. the third thing$/m);
  assert.match(task, /Judge exactly these 2 criteria/);
  assert.match(task, /^CRITERION 2: PASS \| FAIL/m, 'the answer keeps the card numbering, not a fresh 1');
});

test('the task refuses a blocking wait and names the bounded check instead', () => {
  const task = reviewTask({ ...base, criteria: ['one'], open: [1] });
  assert.match(task, /A blocking wait on a running process is refused/);
  assert.match(task, /bounded check such as `for i in 1 2 3 4 5 6 7 8 9 10; do curl/);
});

test('a second review covers only the criteria the first did not judge', () => {
  const record = {
    criteria: ['one', 'two', 'three'],
    reviews: [{ round: 1, verdict: null, judged: [1] }],
  };
  assert.deepEqual(openCriteria(record), [2, 3]);
});

test('criteria judged across two rounds are both counted as closed', () => {
  const record = {
    criteria: ['one', 'two', 'three', 'four'],
    reviews: [
      { round: 1, judged: [1, 2] },
      { round: 2, judged: [3] },
    ],
  };
  assert.deepEqual(openCriteria(record), [4]);
});

test('a review that judged nothing leaves every criterion open', () => {
  const record = { criteria: ['one', 'two'], reviews: [{ round: 1, judged: [] }] };
  assert.deepEqual(openCriteria(record), [1, 2]);
});

test('the round being started is not counted as having judged anything yet', () => {
  const record = {
    criteria: ['one', 'two'],
    reviews: [{ round: 1, judged: [1] }],
  };
  // reviewRound calls this for round 2 while the record still holds one round.
  assert.deepEqual(openCriteria(record), [2]);
});
