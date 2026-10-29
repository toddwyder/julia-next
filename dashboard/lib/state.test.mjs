// state.test.mjs -- the run-file contract PR-7 will write against (JUL-276 PR-2, decision D3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RUN_STATUSES, buildRecordFile, isActiveRun, parseRunFile, readJsonRecord, readRuns,
  runRecordProblem, runsFolder, stateFolder, watchdogRecordFile, writeJsonRecord,
} from '../lib/state.js';

const temporaryState = () => {
  const root = mkdtempSync(join(tmpdir(), 'jul-276-state-'));
  return { root, env: { DASHBOARD_STATE_DIR: root }, clean: () => rmSync(root, { recursive: true, force: true }) };
};

const good = { id: 'run-1', status: 'running', startedAt: '2026-10-29T09:00:00.000Z' };

test('the state folder and its records sit under DASHBOARD_STATE_DIR/state', () => {
  const env = { DASHBOARD_STATE_DIR: '/var/lib/julia-dashboard' };
  assert.equal(stateFolder(env), '/var/lib/julia-dashboard/state');
  assert.equal(runsFolder(env), '/var/lib/julia-dashboard/state/runs');
  assert.equal(buildRecordFile(env), '/var/lib/julia-dashboard/state/build.json');
  assert.equal(watchdogRecordFile(env), '/var/lib/julia-dashboard/state/watchdog.json');
});

test('a run record needs an id, one of the four statuses and a parseable startedAt', () => {
  assert.equal(runRecordProblem(good), '');
  for (const status of RUN_STATUSES) assert.equal(runRecordProblem({ ...good, status }), '');
  assert.match(runRecordProblem({ ...good, id: '' }), /no id/);
  assert.match(runRecordProblem({ ...good, status: 'paused' }), /has status "paused"/);
  assert.match(runRecordProblem({ ...good, startedAt: 'yesterday' }), /unreadable startedAt/);
  assert.match(runRecordProblem(['run']), /not a JSON object/);
});

test('a broken run file is named, never thrown', () => {
  const state = temporaryState();
  try {
    mkdirSync(runsFolder(state.env), { recursive: true });
    writeFileSync(join(runsFolder(state.env), 'broken.json'), '{"id": "run-2", ');
    const entry = parseRunFile(join(runsFolder(state.env), 'broken.json'));
    assert.equal(entry.run, null);
    assert.equal(entry.error, 'is not valid JSON');
  } finally {
    state.clean();
  }
});

test('readRuns is empty for a folder that does not exist and sorted when it does', () => {
  const state = temporaryState();
  try {
    assert.deepEqual(readRuns(state.env), { dir: runsFolder(state.env), entries: [], listError: '' });
    writeJsonRecord(join(runsFolder(state.env), 'b.json'), { ...good, id: 'run-b', status: 'finished' });
    writeJsonRecord(join(runsFolder(state.env), 'a.json'), good);
    const { entries } = readRuns(state.env);
    assert.deepEqual(entries.map(entry => entry.run.id), ['run-1', 'run-b']);
    assert.deepEqual(entries.map(isActiveRun), [true, false]);
  } finally {
    state.clean();
  }
});

test('only starting and running count as active', () => {
  for (const status of ['starting', 'running']) assert.equal(isActiveRun({ file: 'x', error: '', run: { ...good, status } }), true);
  for (const status of ['finished', 'failed']) assert.equal(isActiveRun({ file: 'x', error: '', run: { ...good, status } }), false);
  assert.equal(isActiveRun({ file: 'x', error: 'is not valid JSON', run: null }), false);
});

test('a record written is a record read, and a missing record is not an error', () => {
  const state = temporaryState();
  try {
    const file = buildRecordFile(state.env);
    assert.deepEqual(readJsonRecord(file), { value: null, error: '' });
    writeJsonRecord(file, { commit: 'a'.repeat(40) });
    assert.deepEqual(readJsonRecord(file).value, { commit: 'a'.repeat(40) });
    writeFileSync(file, 'not json');
    assert.equal(readJsonRecord(file).error, 'is not valid JSON');
  } finally {
    state.clean();
  }
});
