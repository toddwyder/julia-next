import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { elapsedLabel, isStalled, listRuns, readRun, shownStatus, stamp, usageCells } from './machine-runs.js';

const folder = () => mkdtempSync(path.join(tmpdir(), 'dashboard-machine-runs-'));

function record(overrides = {}) {
  return {
    id: '20261103T064122Z-JUL-330',
    card: 'JUL-330',
    pr: 431,
    status: 'running',
    idleLimitMs: 600_000,
    startedAt: '2026-11-03T06:41:22.000Z',
    updatedAt: '2026-11-03T06:45:00.000Z',
    heartbeatAt: '2026-11-03T06:45:00.000Z',
    endedAt: null,
    steps: [{ id: 'build', status: 'running', startedAt: '2026-11-03T06:41:22.000Z', endedAt: null, detail: null }],
    ...overrides,
  };
}

test('a run the machine is still writing is read back with its stages', async () => {
  const dir = folder();
  const saved = record();
  writeFileSync(path.join(dir, `${saved.id}.json`), JSON.stringify(saved));
  const read = await readRun(saved.id, dir);
  assert.deepEqual(read, saved);
  assert.equal(await readRun('20260101T000000Z-JUL-1', dir), null);
});

test('a running run that has gone quiet past its own limit shows as stalled', () => {
  const live = record();
  assert.equal(isStalled(live, Date.parse('2026-11-03T06:50:00Z')), false);
  assert.equal(shownStatus(live, Date.parse('2026-11-03T06:50:00Z')), 'running');
  assert.equal(shownStatus(live, Date.parse('2026-11-03T06:56:00Z')), 'stalled');
  assert.equal(shownStatus(record({ status: 'failed' }), Date.parse('2027-01-01T00:00:00Z')), 'failed');
  assert.equal(shownStatus(record({ status: 'succeeded' }), Date.parse('2027-01-01T00:00:00Z')), 'succeeded');
});

test('the list is newest first, and an empty or missing store is not an error', async () => {
  const dir = folder();
  writeFileSync(path.join(dir, '20261103T050000Z-JUL-1.json'), JSON.stringify(record({ id: '20261103T050000Z-JUL-1', card: 'JUL-1', startedAt: '2026-11-03T05:00:00.000Z' })));
  writeFileSync(path.join(dir, '20261103T060000Z-JUL-2.json'), JSON.stringify(record({ id: '20261103T060000Z-JUL-2', card: 'JUL-2', startedAt: '2026-11-03T06:00:00.000Z' })));
  writeFileSync(path.join(dir, 'notes.txt'), 'not a run');

  const listed = await listRuns(dir);
  assert.equal(listed.listError, null);
  assert.deepEqual(listed.runs.map(run => run.card), ['JUL-2', 'JUL-1']);

  const missing = await listRuns(path.join(dir, 'not-here'));
  assert.deepEqual(missing.runs, []);
  assert.equal(missing.listError, null);
});

test('a record without a card is skipped rather than shown blank', async () => {
  const dir = folder();
  writeFileSync(path.join(dir, '20261103T060000Z-JUL-2.json'), JSON.stringify({ id: '20261103T060000Z-JUL-2' }));
  writeFileSync(path.join(dir, '20261103T060001Z-JUL-3.json'), '{ half a record');
  const listed = await listRuns(dir);
  assert.deepEqual(listed.runs, []);
});

test('times are shown in UTC and say so', () => {
  assert.equal(stamp('2026-11-03T06:41:22.000Z'), '3 Nov 2026, 06:41:22 UTC');
  assert.equal(stamp(null), 'unknown');
  assert.equal(stamp('whenever'), 'unknown');
});

test('a stage shows how long it took and what it spent', () => {
  assert.deepEqual(
    usageCells({ elapsedMs: 8 * 60_000 + 4_000, usage: { inputTokens: 132_095, outputTokens: 675, costUsd: 0.42, models: ['some/paid-model'] } }),
    { elapsed: '8m 4s', tokens: '132095 in / 675 out', cost: '$0.42', warning: '' }
  );
  assert.equal(elapsedLabel(900), '900ms');
  assert.equal(elapsedLabel(9_000), '9s');
  assert.equal(elapsedLabel(60_000), '1m');
  assert.equal(elapsedLabel(null), '');
});

test('a free model is named as free rather than priced at zero', () => {
  assert.equal(usageCells({ usage: { inputTokens: 1, outputTokens: 2, costUsd: 0, models: ['reflection/beam:free'] } }).cost, 'free model');
  assert.equal(usageCells({ usage: { costUsd: 0, models: ['reflection/beam'] } }).cost, 'cost unknown');
  assert.equal(usageCells({ usage: { costUsd: 0, models: ['reflection/beam:free', 'some/paid-model'] } }).cost, 'cost unknown');
});

test('a stage that ran but left no model rows says so instead of showing a zero', () => {
  assert.equal(usageCells({ elapsedMs: 5_000, usage: { empty: true, files: ['a.duckdb'] } }).warning, 'no model rows in this stage’s trace file');
  assert.equal(usageCells({ usage: { empty: true, files: [] } }).warning, 'no trace file: this stage recorded nothing');
  assert.deepEqual(usageCells({ elapsedMs: 5_000 }), { elapsed: '5s', tokens: '', cost: '', warning: '' });
});
