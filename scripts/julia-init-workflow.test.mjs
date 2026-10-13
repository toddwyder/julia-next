import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const entry = resolve('scripts/julia-init.mjs');
const authorize = {
  issueId: 'JUL-196', explicitStart: true, authorizedBy: 'offline workflow test', linearActorId: 'offline-linear-actor',
  spending: { builder: { mode: 'fixture', maxUsd: 0 }, reviewer: { mode: 'fixture', maxUsd: 0 } },
};

async function fixture(t, verdicts = 'PASS') {
  const root = await mkdtemp(join(tmpdir(), 'julia-init-workflow-'));
  const runs = join(root, 'runs');
  await mkdir(runs);
  const authorizationPath = join(root, 'authorization.json');
  await writeFile(authorizationPath, `${JSON.stringify(authorize)}\n`);
  t.after(() => rm(root, { recursive: true, force: true }));
  const invoke = decisionPath => {
    const environment = {
      ...process.env, JULIA_DELIVERY_OFFLINE_FIXTURE: '1', JULIA_DELIVERY_OFFLINE_VERDICTS: verdicts,
      JULIA_START_AUTHORIZATION: authorizationPath, JULIA_RUN_DIRECTORY: runs,
      ...(decisionPath ? { JULIA_TECHNICAL_ACCEPTANCE: decisionPath } : {}),
    };
    const result = spawnSync(process.execPath, [entry, '$init JUL-196'], { cwd: root, env: environment, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { root, runs, runDirectory: join(runs, 'JUL-196-run'), invoke };
}

const events = async fixtureValue => (await readFile(join(fixtureValue.runDirectory, 'calls.jsonl'), 'utf8'))
  .trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));

async function decision(fixtureValue, value, reason) {
  const path = join(fixtureValue.root, `${value}.json`);
  await writeFile(path, `${JSON.stringify({ decision: value, ...(reason ? { reason } : {}) })}\n`);
  return path;
}

test('real $init process pauses, restarts without duplicate work, and accepts', async t => {
  const f = await fixture(t);
  assert.equal(f.invoke().delivery.status, 'suspended');
  assert.equal(f.invoke().delivery.status, 'suspended');
  const accepted = f.invoke(await decision(f, 'accept'));
  assert.equal(accepted.delivery.result.outcome, 'accepted');
  const recorded = await events(f);
  assert.deepEqual(recorded.map(event => event.kind), ['authorization', 'card-read', 'builder', 'checks', 'reviewer', 'waiting', 'acceptance']);
  assert.equal(recorded.at(-1).candidateCommit, 'offline-candidate-1');
  const acceptance = JSON.parse(await readFile(join(f.runDirectory, 'acceptance-offline-candidate-1.json'), 'utf8'));
  assert.equal(acceptance.candidateCommit, 'offline-candidate-1');
  const waiting = JSON.parse(await readFile(join(f.runDirectory, 'waiting-offline-candidate-1.json'), 'utf8'));
  assert.equal(waiting.candidateCommit, acceptance.candidateCommit);
  assert.equal((await readFile(join(f.runs, 'delivery-summary.log'), 'utf8')).trim().match(/change=offline-candidate-1/g)?.length, 1);
});

test('real $init rejection stops with Todd reason and runs nothing later', async t => {
  const f = await fixture(t);
  f.invoke();
  const rejected = f.invoke(await decision(f, 'reject', 'needs product correction'));
  assert.equal(rejected.delivery.result.outcome, 'rejected');
  assert.equal(rejected.delivery.result.reason, 'needs product correction');
  assert.equal((await events(f)).at(-1).kind, 'waiting');
});

test('real $init parks after two failed reviews without a waiting record or third builder', async t => {
  const f = await fixture(t, 'FAIL,FAIL');
  const parked = f.invoke();
  assert.equal(parked.delivery.result.outcome, 'parked');
  assert.deepEqual((await events(f)).map(event => event.kind), [
    'authorization', 'card-read', 'builder', 'checks', 'reviewer', 'builder', 'checks', 'reviewer', 'park',
  ]);
});

test('real $init discards acceptance for a changed candidate and reviews it again', async t => {
  const f = await fixture(t);
  f.invoke();
  await writeFile(join(f.runDirectory, 'candidate-changed'), 'changed');
  const pausedAgain = f.invoke(await decision(f, 'accept'));
  assert.equal(pausedAgain.delivery.status, 'suspended');
  assert.deepEqual((await events(f)).map(event => event.kind), [
    'authorization', 'card-read', 'builder', 'checks', 'reviewer', 'waiting', 'checks', 'reviewer', 'waiting',
  ]);
});

test('a stale candidate consumes round two and a failed re-review parks without another builder or reviewer', async t => {
  const f = await fixture(t, 'PASS,FAIL');
  f.invoke();
  await writeFile(join(f.runDirectory, 'candidate-changed'), 'changed');
  const parked = f.invoke(await decision(f, 'accept'));
  assert.equal(parked.delivery.result.outcome, 'parked');
  assert.equal(parked.delivery.result.round, 2);
  assert.deepEqual((await events(f)).map(event => event.kind), [
    'authorization', 'card-read', 'builder', 'checks', 'reviewer', 'waiting', 'checks', 'reviewer', 'park',
  ]);
});

test('a second stale acceptance parks at the two-review cap without a third review', async t => {
  const f = await fixture(t);
  f.invoke();
  await writeFile(join(f.runDirectory, 'candidate-changed'), 'changed');
  assert.equal(f.invoke(await decision(f, 'accept')).delivery.status, 'suspended');
  await writeFile(join(f.runDirectory, 'candidate-changed'), 'changed-again');
  const parked = f.invoke(await decision(f, 'accept'));
  assert.equal(parked.delivery.result.outcome, 'parked');
  assert.equal(parked.delivery.result.round, 2);
  assert.deepEqual((await events(f)).map(event => event.kind), [
    'authorization', 'card-read', 'builder', 'checks', 'reviewer', 'waiting',
    'checks', 'reviewer', 'waiting', 'park',
  ]);
});
