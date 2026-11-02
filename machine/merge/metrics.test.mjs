import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { durationBetween, landingLines, landingPath, landingRecord, writeLanding } from './metrics.mjs';

test('a duration is whole minutes, written the way a person reads it', () => {
  assert.deepEqual(durationBetween('2026-10-30T10:00:00Z', '2026-10-30T10:42:00Z'), { minutes: 42, human: '42m' });
  assert.deepEqual(durationBetween('2026-10-30T10:00:00Z', '2026-10-30T12:05:00Z'), { minutes: 125, human: '2h 5m' });
  assert.deepEqual(durationBetween('2026-10-28T10:00:00Z', '2026-10-30T12:05:00Z'), { minutes: 3005, human: '2d 2h 5m' });
  assert.deepEqual(durationBetween('2026-10-30T10:00:00Z', '2026-10-30T10:00:30Z'), { minutes: 1, human: '1m' });
  assert.equal(durationBetween(null, '2026-10-30T10:00:00Z'), null);
  assert.equal(durationBetween('not a date', '2026-10-30T10:00:00Z'), null);
});

test('the landing record holds the two numbers the card asks for, and where they came from', () => {
  const record = landingRecord({
    card: 'JUL-310',
    pr: 420,
    mergeCommit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    startedAt: '2026-11-01T08:00:00Z',
    startedFrom: 'the pull request’s first commit',
    mergedAt: '2026-11-02T09:30:00Z',
    verdicts: ['FAIL', 'PASS'],
    model: 'commandcode/reflection/beam:free',
    workflowRunId: 'run-1',
  });
  assert.equal(record.duration.human, '1d 1h 30m');
  assert.deepEqual(record.reviews, { rounds: 2, verdicts: ['FAIL', 'PASS'] });
  assert.equal(record.startedFrom, 'the pull request’s first commit');
  assert.equal(record.card, 'JUL-310');
  assert.equal(record.pullRequest, 420);
  assert.match(record.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('the landing record is written beside the scorecard, not over it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-metrics-'));
  try {
    fs.mkdirSync(path.join(root, 'docs', 'scorecards'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'scorecards', 'JUL-310.md'), '- Cost: **$0.16**\n');
    const record = landingRecord({
      card: 'JUL-310',
      pr: 420,
      mergeCommit: 'abc1234',
      startedAt: '2026-11-01T08:00:00Z',
      startedFrom: 'the pull request’s first commit',
      mergedAt: '2026-11-02T09:30:00Z',
      verdicts: ['PASS'],
    });
    const file = writeLanding({ root, record });
    assert.equal(file, landingPath(root, 'JUL-310'));
    assert.equal(path.basename(file), 'JUL-310.landing.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).reviews.rounds, 1);
    assert.equal(fs.readFileSync(path.join(root, 'docs', 'scorecards', 'JUL-310.md'), 'utf8'), '- Cost: **$0.16**\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the same numbers are repeated where a person reads them', () => {
  const record = landingRecord({
    card: 'JUL-310',
    pr: 420,
    mergeCommit: 'abc1234',
    startedAt: '2026-11-01T08:00:00Z',
    startedFrom: 'the pull request’s first commit',
    mergedAt: '2026-11-02T09:30:00Z',
    verdicts: ['FAIL', 'PASS'],
  });
  const lines = landingLines(record).join('\n');
  assert.match(lines, /Took \*\*1d 1h 30m\*\*/);
  assert.match(lines, /2 Shipping rounds: FAIL → PASS/);
  assert.match(lines, /docs\/scorecards\/JUL-310\.landing\.json/);
});
