import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStore, idleLimitMs, listRuns, runId, shownStatus, writeRun } from './store.mjs';

const folder = () => mkdtempSync(path.join(tmpdir(), 'machine-runs-'));

test('a run record is one file, written whole, with every stage in it', () => {
  const dir = folder();
  const store = createStore(dir, { idleLimit: 60_000 });
  let record = store.start({ card: 'JUL-330', now: new Date('2026-11-03T06:41:22.500Z') });

  assert.equal(record.id, '20261103T064122Z-JUL-330');
  assert.equal(record.card, 'JUL-330');
  assert.deepEqual(record.steps.map(step => step.id), ['build', 'remediation', 'landing']);
  assert.deepEqual(record.steps.map(step => step.status), ['pending', 'pending', 'pending']);
  assert.deepEqual(readdirSync(dir), ['20261103T064122Z-JUL-330.json']);

  record = store.begin(record, 'build', new Date('2026-11-03T06:41:30Z'));
  assert.equal(record.steps[0].status, 'running');
  assert.equal(record.steps[0].startedAt, '2026-11-03T06:41:30.000Z');

  record = store.end(record, 'build', { status: 'succeeded', pr: 431, detail: 'the builder opened pull request #431', now: new Date('2026-11-03T07:10:00Z') });
  assert.equal(record.pr, 431);
  assert.equal(record.steps[0].endedAt, '2026-11-03T07:10:00.000Z');

  const onDisk = JSON.parse(readFileSync(path.join(dir, `${record.id}.json`), 'utf8'));
  assert.deepEqual(onDisk, record);
});

test('the card identity is on the run and on every stage of it', () => {
  const store = createStore(folder(), { idleLimit: 60_000 });
  let record = store.start({ card: 'JUL-331' });
  record = store.begin(record, 'build');
  record = store.end(record, 'build', { status: 'succeeded', pr: 7 });
  record = store.begin(record, 'remediation');
  record = store.finish(record, 'failed', { detail: 'the review loop stopped the card' });

  assert.equal(record.card, 'JUL-331');
  assert.equal(record.status, 'failed');
  assert.equal(record.detail, 'the review loop stopped the card');
  const read = store.read(record.id);
  assert.equal(read.error, '');
  assert.deepEqual(read.record, record);
});

test('a run nobody has heard from for longer than its own idle limit is stalled', () => {
  const store = createStore(folder(), { idleLimit: 10 * 60_000 });
  const record = store.start({ card: 'JUL-332', now: new Date('2026-11-03T06:00:00Z') });
  const beat = Date.parse(record.heartbeatAt);

  assert.equal(shownStatus(record, { now: beat + 60_000 }), 'running');
  assert.equal(shownStatus(record, { now: beat + 11 * 60_000 }), 'stalled');
  assert.equal(shownStatus({ ...record, status: 'succeeded' }, { now: beat + 60 * 60_000 }), 'succeeded');
});

test('the heartbeat is what keeps a slow build from looking stalled', () => {
  const store = createStore(folder(), { idleLimit: 10 * 60_000 });
  const started = new Date('2026-11-03T06:00:00Z');
  let record = store.start({ card: 'JUL-330', now: started });
  record = store.beat(record, new Date('2026-11-03T06:45:00Z'));
  assert.equal(shownStatus(record, { now: Date.parse('2026-11-03T06:50:00Z') }), 'running');
});

test('the list opens on the newest run first and survives an empty or broken folder', () => {
  const dir = folder();
  const store = createStore(dir, { idleLimit: 60_000 });
  store.start({ card: 'JUL-1', now: new Date('2026-11-03T05:00:00Z') });
  store.start({ card: 'JUL-2', now: new Date('2026-11-03T06:00:00Z') });
  writeRun({ id: 'broken', card: 'JUL-3' }, dir);

  const listed = listRuns(dir);
  assert.equal(listed.listError, '');
  assert.deepEqual(listed.runs.map(run => run.card), ['JUL-2', 'JUL-1']);

  const missing = listRuns(path.join(dir, 'not-here'));
  assert.deepEqual(missing.runs, []);
  assert.equal(missing.listError, '');
});

test('the idle limit comes from the environment, and falls back when it is nonsense', () => {
  assert.equal(idleLimitMs({ MACHINE_IDLE_LIMIT_MIN: '5' }), 5 * 60_000);
  assert.equal(idleLimitMs({ MACHINE_IDLE_LIMIT_MIN: 'soon' }), 10 * 60_000);
  assert.equal(idleLimitMs({}), 10 * 60_000);
});

test('a run id is safe in a URL and on a file name', () => {
  assert.equal(runId({ card: 'JUL-330', now: new Date('2026-11-03T06:41:22Z') }), '20261103T064122Z-JUL-330');
  assert.match(runId({ card: 'JUL-330' }), /^[0-9TZ]+-JUL-330$/);
});
