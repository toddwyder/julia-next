import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkHealth, checkLinear, checkRuns, checkStateFolder, redact } from '../lib/health.js';
import { runsFolder } from '../lib/state.js';

const KEY = 'lin_api_do_not_echo_me_1234';
const okFetch = () => Promise.resolve(new Response(JSON.stringify({ data: { viewer: { id: 'viewer-1' } } }), { status: 200 }));

const temporaryState = () => {
  const root = mkdtempSync(join(tmpdir(), 'jul-276-health-'));
  return { root, env: { DASHBOARD_STATE_DIR: root }, clean: () => rmSync(root, { recursive: true, force: true }) };
};

test('health is ok when Linear answers, the state folder is writable and every run file parses', async () => {
  const state = temporaryState();
  try {
    mkdirSync(runsFolder(state.env), { recursive: true });
    writeFileSync(join(runsFolder(state.env), 'run-1.json'), JSON.stringify({ id: 'run-1', status: 'running', startedAt: '2026-10-29T09:00:00.000Z' }));
    const report = await checkHealth({ env: state.env, apiKey: KEY, fetchImpl: okFetch, now: () => '2026-10-29T10:00:00.000Z' });
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.failing, []);
    assert.deepEqual(report.checks.map(check => [check.name, check.ok]), [['linear', true], ['state', true], ['runs', true]]);
    assert.equal(report.checkedAt, '2026-10-29T10:00:00.000Z');
  } finally {
    state.clean();
  }
});

test('one corrupt run file fails the check and is named, while the other checks still answer', async () => {
  const state = temporaryState();
  try {
    mkdirSync(runsFolder(state.env), { recursive: true });
    writeFileSync(join(runsFolder(state.env), 'good.json'), JSON.stringify({ id: 'run-1', status: 'finished', startedAt: '2026-10-29T09:00:00.000Z' }));
    const broken = join(runsFolder(state.env), 'broken.json');
    writeFileSync(broken, '{"id": "run-2", "status": ');
    const report = await checkHealth({ env: state.env, apiKey: KEY, fetchImpl: okFetch });
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.failing, ['runs']);
    assert.deepEqual(report.files, [broken]);
    const runs = report.checks.find(check => check.name === 'runs');
    assert.match(runs.detail, /1 of 2 run files do not parse/);
  } finally {
    state.clean();
  }
});

test('a state folder that cannot be created fails the writability check by name', () => {
  const blocker = join(mkdtempSync(join(tmpdir(), 'jul-276-health-blocker-')), 'not-a-folder');
  writeFileSync(blocker, 'this is a file, so nothing can be created under it');
  try {
    const check = checkStateFolder({ DASHBOARD_STATE_DIR: join(blocker, 'state') });
    assert.equal(check.ok, false);
    assert.match(check.detail, /is not writable/);
  } finally {
    rmSync(dirname(blocker), { recursive: true, force: true });
  }
});

test('a missing Linear key and a refused request each fail by name without echoing the key', async () => {
  assert.equal((await checkLinear({ apiKey: '' })).detail, 'LINEAR_API_KEY is missing');
  const refuse = () => Promise.resolve(new Response(JSON.stringify({ errors: [{ message: `bad token ${KEY}` }] }), { status: 401 }));
  const check = await checkLinear({ apiKey: KEY, fetchImpl: refuse });
  assert.equal(check.ok, false);
  assert.match(check.detail, /HTTP 401/);
  assert.doesNotMatch(check.detail, new RegExp(KEY));
  assert.match(check.detail, /\[redacted\]/);
  assert.equal(redact(`x ${KEY} y`, KEY), 'x [redacted] y');
});

test('the checks report an unanswered Linear call as a connection failure, not a crash', async () => {
  const down = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
  const check = await checkLinear({ apiKey: KEY, fetchImpl: down });
  assert.equal(check.ok, false);
  assert.match(check.detail, /Linear connection failure/);
  const slow = () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
  assert.match((await checkLinear({ apiKey: KEY, fetchImpl: slow })).detail, /within 10 seconds/);
});

test('run files parse is a count, so an empty runs folder is ok', () => {
  const state = temporaryState();
  try {
    const check = checkRuns(state.env);
    assert.equal(check.ok, true);
    assert.equal(check.detail, '0 run files parse');
  } finally {
    state.clean();
  }
});
