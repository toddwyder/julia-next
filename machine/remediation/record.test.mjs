// What a rerun reads. A crash between two reviews must not make the machine
// post the first determination twice, so the record on disk decides.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { alreadyFinished, readRecord, recordPath, sameCard, seedFrom, writeRecord } from './record.mjs';

const CARD = 'JUL-999';
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-record-'));

test('a run dir with no record reads as nothing, not as an error', () => {
  assert.equal(readRecord(path.join(runDir, 'absent')), null);
});

test('a record survives the round trip', () => {
  const record = { pr: 42, card: { identifier: CARD }, reviews: [{ round: 1, verdict: 'FAIL' }] };
  writeRecord(runDir, record);
  assert.ok(fs.existsSync(recordPath(runDir)));
  assert.deepEqual(readRecord(runDir), record);
});

test('a broken record reads as nothing rather than throwing', () => {
  const broken = path.join(runDir, 'broken');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(recordPath(broken), '{ not json');
  assert.equal(readRecord(broken), null);
});

test('a record belongs to one pull request and one card', () => {
  const saved = { pr: 42, card: { identifier: CARD } };
  assert.equal(sameCard(saved, { pr: 42, card: CARD }), true);
  assert.equal(sameCard(saved, { pr: 43, card: CARD }), false);
  assert.equal(sameCard(saved, { pr: 42, card: 'JUL-998' }), false);
  assert.equal(sameCard(null, { pr: 42, card: CARD }), false);
});

test('a rerun picks up the rounds that already posted, and the builder it woke', () => {
  const saved = {
    pr: 42,
    card: { identifier: CARD },
    reviews: [{ round: 1, verdict: 'FAIL', postedUrl: 'https://github.com/toddwyder/julia-next/pull/42#x' }],
    builder: { threadId: 'thread-of-the-builder', resumed: true },
  };
  assert.deepEqual(seedFrom(saved, { pr: 42, card: CARD }), { reviews: saved.reviews, builder: saved.builder });
  assert.deepEqual(seedFrom(saved, { pr: 42, card: 'JUL-998' }), { reviews: [], builder: null });
  assert.deepEqual(seedFrom(null, { pr: 42, card: CARD }), { reviews: [], builder: null });
});

test('a stopped loop is not started again by accident', () => {
  const stopped = { pr: 42, card: { identifier: CARD }, stop: { reason: 'two reviews failed' } };
  assert.equal(alreadyFinished(stopped, { pr: 42, card: CARD }), true);
  assert.equal(alreadyFinished({ pr: 42, card: { identifier: CARD } }, { pr: 42, card: CARD }), false);
  assert.equal(alreadyFinished(stopped, { pr: 42, card: 'JUL-998' }), false);
});
