// Deterministic spending/recovery boundary fixtures; no provider integration.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDelivery as deliver } from './julia-delivery-runner.mjs';

import { fixtureAdapters } from './fixtures/jul202-review.mjs';
const runDelivery = (input, adapters) => deliver(input, fixtureAdapters(adapters));

const configuration = {
  builder: { harness: 'codex', model: 'gpt-6.1-sol', maker: 'OpenAI' },
  reviewer: { harness: 'fixture', model: 'deterministic', maker: 'Fixture' },
};
const authorization = { issueId: 'JUL-196', explicitStart: true, authorizedBy: 'fixture operator', spending: { builder: { mode: 'fixture', maxUsd: 0 }, reviewer: { mode: 'fixture', maxUsd: 0 } } };
const card = { identifier: 'JUL-196', state: { name: 'Ready' }, description: '## Acceptance criteria\n- [ ] saved input' };
const A = 'a'.repeat(40), B = 'b'.repeat(40);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jul196-spending-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const launches = [], stops = []; let reads = 0;
  const run = { issueId: 'JUL-196', configuration, authorization, runPath: join(root, 'run.json') };
  const adapters = {
    lock: async () => ({ ok: true, release: async () => {} }),
    processes: { started: () => 'fixture-start', stop: async pid => { stops.push(pid); adapters.processes.started = () => null; } },
    readCard: async () => { reads++; return card; },
    candidate: async () => ({ commit: A, clean: true, checks: { pass: true } }),
    launch: async (role, request) => {
      launches.push(role);
      if (role === 'reviewer') { await request.started({ pid: 12345 }); throw new Error('ambiguous fixture call'); }
      return { exitCode: 0, observed: configuration.builder };
    },
  };
  return { run, adapters, launches, stops, reads: () => reads, state: async () => JSON.parse(await readFile(join(root, 'JUL-196-state.json'), 'utf8')) };
}

test('an interrupted ambiguous reviewer is settled once and never retried; terminal recovery reuses its unsafe result', async t => {
  const f = await fixture(t);
  await assert.rejects(runDelivery(f.run, f.adapters), /ambiguous fixture call/);
  const result = await runDelivery(f.run, f.adapters);
  assert.equal(result.unsafe, true);
  assert.match(result.reason, /review.*interrupted.*not.*retr/i);
  assert.deepEqual(f.launches, ['builder', 'reviewer']);
  assert.deepEqual(f.stops, [12345]);
  assert.equal(f.reads(), 1);
  const state = await f.state();
  assert.equal(state.repairsUsed, 0);
  assert.equal(state.actions.at(-1).status, 'uncertain');
  assert.deepEqual(await runDelivery(f.run, f.adapters), result);
  assert.deepEqual(f.launches, ['builder', 'reviewer']);
});

test('a repair with unchanged checked code cannot buy another review of the same candidate', async t => {
  const f = await fixture(t);
  f.adapters.launch = async (role, request) => {
    f.launches.push(role);
    return role === 'builder' ? { exitCode: 0, observed: configuration.builder } : { exitCode: 0, observed: configuration.reviewer, text: 'VERDICT: FAIL\nFinding: add regression' };
  };
  const result = await runDelivery(f.run, f.adapters);
  assert.equal(result.outcome, 'park');
  assert.match(result.reason, /unchanged.*review/i);
  assert.deepEqual(f.launches, ['builder', 'reviewer', 'builder']);
  const state = await f.state();
  assert.equal(state.repairsUsed, 1);
  assert.equal(state.findings.length, 1);
  assert.equal(state.findings[0].commit, A);
});

test('actionable findings allow one new fixture review only after changed checked code; saved review is reused', async t => {
  const f = await fixture(t);
  f.adapters.candidate = async ({ round }) => ({ commit: round ? B : A, clean: true, checks: { pass: true } });
  f.adapters.launch = async (role, request) => {
    f.launches.push(role);
    return role === 'builder' ? { exitCode: 0, observed: configuration.builder } : { exitCode: 0, observed: configuration.reviewer, text: request.round ? `VERDICT: PASS\nCOMMIT: ${B}` : 'VERDICT: FAIL\nFinding: add regression' };
  };
  const result = await runDelivery(f.run, f.adapters);
  assert.equal(result.outcome, 'pass');
  assert.equal(result.commit, B);
  assert.deepEqual(await runDelivery(f.run, f.adapters), result);
  assert.deepEqual(f.launches, ['builder', 'reviewer', 'builder', 'reviewer']);
  assert.equal((await f.state()).repairsUsed, 1);
});

test('authentication failures, malformed verdicts and unknown identity are saved and reused without reviewer retries', async t => {
  for (const review of [
    { exitCode: 1, text: 'fixture authentication failure', observed: configuration.reviewer },
    { exitCode: 0, text: 'fixture malformed response', observed: configuration.reviewer },
    { exitCode: 0, text: `VERDICT: PASS\nCOMMIT: ${A}`, observed: null },
  ]) {
    const f = await fixture(t);
    f.adapters.launch = async role => { f.launches.push(role); return role === 'builder' ? { exitCode: 0, observed: configuration.builder } : review; };
    const result = await runDelivery(f.run, f.adapters);
    assert.equal(result.outcome, 'park');
    assert.deepEqual(await runDelivery(f.run, f.adapters), result);
    assert.deepEqual(f.launches, ['builder', 'reviewer']);
    assert.equal((await f.state()).repairsUsed, 0);
  }
});

test('a new commit with identical checked changes cannot purchase another review', async t => {
  const f = await fixture(t);
  f.adapters.candidate = async ({ round }) => ({ commit: round ? B : A, diff: 'same checked source changes', clean: true, checks: { pass: true } });
  f.adapters.launch = async role => {
    f.launches.push(role);
    return role === 'builder' ? { exitCode: 0, observed: configuration.builder } : { exitCode: 0, observed: configuration.reviewer, text: 'VERDICT: FAIL\nFinding: add regression' };
  };
  const result = await runDelivery(f.run, f.adapters);
  assert.match(result.reason, /unchanged.*review/);
  assert.deepEqual(f.launches, ['builder', 'reviewer', 'builder']);
  assert.equal((await f.state()).repairsUsed, 1);
});
