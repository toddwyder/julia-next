import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

import { appendPermanentSummaryLine, createDeliveryWorkflowRuntime } from '../src/delivery-workflow.mjs';
import { createExistingDeliveryStepAdapters } from '../src/delivery-step-adapters.mjs';
import { createOfflineDeliveryAdapters } from '../support/offline-delivery-adapters.mjs';
import { fixtureReport } from '../../../../scripts/fixtures/jul202-review.mjs';

const suiteDirectory = await mkdtemp(join(tmpdir(), 'jul196-workflow-suite-'));
after(() => rm(suiteDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

async function fixture(t, verdicts = ['PASS']) {
  const directory = join(suiteDirectory, crypto.randomUUID());
  await mkdir(directory);
  const callsPath = join(directory, 'calls.jsonl');
  const storagePath = join(directory, 'mastra.db');
  const summaryPath = join(directory, 'summary.log');
  const approvedInputPath = join(directory, 'JUL-196-approved.json');
  await writeFile(approvedInputPath, `${JSON.stringify({ identifier: 'JUL-196' })}\n`);
  const adapters = createOfflineDeliveryAdapters({ directory, callsPath, verdicts });
  const options = { storagePath, runDirectory: directory, summaryPath, adapters };
  const input = { card: 'JUL-196', approvedInputPath, runDirectory: directory };
  return { directory, callsPath, storagePath, summaryPath, options, input };
}

async function events(path) {
  return (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

test('green build, checks and independent review pause once and accept after a runtime restart', async t => {
  const f = await fixture(t);
  const firstRuntime = await createDeliveryWorkflowRuntime(f.options);
  const paused = await firstRuntime.start({ runId: 'jul196-accept', input: f.input });
  assert.equal(paused.status, 'suspended');
  assert.equal(paused.outcome, 'awaiting-technical-acceptance');
  assert.ok(paused.peakMemoryBytes > 0);
  assert.ok(paused.pauseStateBytes > 0);
  const database = createClient({ url: `file:${f.storagePath.replaceAll('\\', '/')}` });
  const stored = await database.execute({
    sql: 'SELECT length(snapshot) AS bytes FROM mastra_workflow_snapshot WHERE workflow_name = ? AND run_id = ?',
    args: ['julia-delivery-round-1', 'jul196-accept'],
  });
  database.close();
  assert.equal(paused.pauseStateBytes, Number(stored.rows[0].bytes));
  await firstRuntime.close();

  const restartedRuntime = await createDeliveryWorkflowRuntime(f.options);
  const accepted = await restartedRuntime.resume({ runId: 'jul196-accept', decision: 'accept' });
  assert.equal(accepted.status, 'success');
  assert.equal(accepted.result.outcome, 'accepted');
  await restartedRuntime.close();

  assert.deepEqual((await events(f.callsPath)).map(({ kind, round }) => `${kind}:${round}`), [
    'builder:1', 'checks:1', 'reviewer:1', 'notice:1',
  ]);
  const summaries = (await readFile(f.summaryPath, 'utf8')).trim().split(/\r?\n/);
  assert.equal(summaries.length, 1);
  assert.match(summaries[0], /card=JUL-196 change=offline-candidate-1 round=1 verdict=ACCEPT/);
  assert.match(summaries[0], /reviewerModel=stand-in-reviewer reviewerEffort=none inputTokens=0 outputTokens=0 costEstimateUsd=0/);
  assert.match(summaries[0], /start=.* end=.*/);
});

test('a separate process resumes the saved pause without duplicate launches or notices', async t => {
  const directory = join(suiteDirectory, crypto.randomUUID());
  await mkdir(directory);
  const child = fileURLToPath(new URL('../support/offline-delivery-workflow-child.mjs', import.meta.url));
  const invoke = mode => spawnSync(process.execPath, [child, mode, directory, 'jul196-process-restart'], {
    encoding: 'utf8', windowsHide: true,
  });
  const started = invoke('start');
  assert.equal(started.status, 0, started.stderr);
  assert.equal(JSON.parse(started.stdout).status, 'suspended');
  const resumed = invoke('accept');
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).result.outcome, 'accepted');
  assert.deepEqual((await events(join(directory, 'calls.jsonl'))).map(({ kind, round }) => `${kind}:${round}`), [
    'builder:1', 'checks:1', 'reviewer:1', 'notice:1',
  ]);
});

test('reject resumes the suspended run and stops with Todd\'s reason', async t => {
  const f = await fixture(t);
  const firstRuntime = await createDeliveryWorkflowRuntime(f.options);
  const paused = await firstRuntime.start({ runId: 'jul196-reject', input: f.input });
  assert.equal(paused.status, 'suspended');
  await firstRuntime.close();

  const restartedRuntime = await createDeliveryWorkflowRuntime(f.options);
  const rejected = await restartedRuntime.resume({ runId: 'jul196-reject', decision: 'reject', reason: 'checks need another look' });
  assert.equal(rejected.status, 'success');
  assert.deepEqual(rejected.result.outcome, 'rejected');
  assert.equal(rejected.result.reason, 'checks need another look');
  await restartedRuntime.close();
  const summary = await readFile(f.summaryPath, 'utf8');
  assert.match(summary, /stop=REJECT reason="checks need another look"/);
});

test('three failed reviews park without a notice or a fourth builder launch', async t => {
  const f = await fixture(t, ['FAIL', 'FAIL', 'FAIL']);
  const runtime = await createDeliveryWorkflowRuntime(f.options);
  const result = await runtime.start({ runId: 'jul196-park', input: f.input });
  assert.equal(result.status, 'success');
  assert.equal(result.result.outcome, 'parked');
  assert.equal(result.result.round, 3);
  await runtime.close();
  assert.deepEqual((await events(f.callsPath)).map(({ kind, round }) => `${kind}:${round}`), [
    'builder:1', 'checks:1', 'reviewer:1',
    'builder:2', 'checks:2', 'reviewer:2',
    'builder:3', 'checks:3', 'reviewer:3',
  ]);
  const summary = await readFile(f.summaryPath, 'utf8');
  assert.match(summary, /round=3 stop=PARK reason="offline stand-in review"/);
});

test('workflow step handoffs expose paths and round metadata, never file contents', async t => {
  const f = await fixture(t);
  const seen = [];
  for (const key of ['builder', 'checks', 'reviewer', 'notify']) {
    const original = f.options.adapters[key];
    f.options.adapters[key] = async input => { seen.push({ key, input }); return original(input); };
  }
  const runtime = await createDeliveryWorkflowRuntime(f.options);
  await runtime.start({ runId: 'jul196-paths', input: f.input });
  await runtime.close();
  for (const { input } of seen) {
    assert.equal(typeof input.runDirectory, 'string');
    assert.equal(Number.isInteger(input.round), true);
    assert.equal(JSON.stringify(input).includes('offline stand-in review'), false);
    assert.equal(Object.keys(input).every(key => key === 'round' || key.endsWith('Path') || key === 'runDirectory'), true);
  }
});

test('a failed existing boundary parks and still writes one complete permanent summary', async t => {
  const f = await fixture(t);
  f.options.adapters.builder = async () => { throw new Error('offline builder failure'); };
  const runtime = await createDeliveryWorkflowRuntime(f.options);
  const result = await runtime.start({ runId: 'jul196-boundary-failure', input: f.input });
  await runtime.close();
  assert.equal(result.status, 'success');
  assert.equal(result.result.outcome, 'parked');
  assert.equal(result.result.round, 1);
  const summaries = (await readFile(f.summaryPath, 'utf8')).trim().split(/\r?\n/);
  assert.equal(summaries.length, 1);
  assert.match(summaries[0], /card=JUL-196 change=unknown round=1 stop=PARK reason="builder failed: offline builder failure"/);
  assert.match(summaries[0], /reviewerModel=unknown reviewerEffort=unknown inputTokens=0 outputTokens=0 costEstimateUsd=0/);
});

test('production adapter glue invokes the existing launcher for builder and Mastra reviewer', async t => {
  const f = await fixture(t);
  const roles = [];
  const approved = {
    builderRequest: { configuration: { harness: 'fixture' }, prompt: 'saved builder request' },
    reviewerRequest: {
      issueId: 'JUL-196', candidate: { base: 'a'.repeat(40), commit: 'b'.repeat(40) },
      configuration: { model: 'fixture-reviewer', maker: 'Reviewer Co', thinking: 'none', connection: { provider: 'commandcode' } },
      reviewInput: { changedFiles: [], criteria: [] },
    },
  };
  await writeFile(f.input.approvedInputPath, `${JSON.stringify(approved)}\n`);
  const launch = async (role, request) => {
    roles.push({ role, request });
    if (role === 'builder') return { exitCode: 0, observed: { model: 'fixture-builder', maker: 'Builder Co' } };
    return { exitCode: 1, text: 'offline reviewer refusal', observed: { model: 'fixture-reviewer' } };
  };
  const adapters = createExistingDeliveryStepAdapters({
    worktree: f.directory,
    launch,
    checks: async () => ({ status: 'PASS', change: 'fixture-change' }),
    notify: f.options.adapters.notify,
  });
  const built = await adapters.builder({ approvedInputPath: f.input.approvedInputPath, runDirectory: f.directory, round: 1 });
  const checked = await adapters.checks({ runDirectory: f.directory, round: 1, builderResultPath: built.resultPath });
  await adapters.reviewer({
    approvedInputPath: f.input.approvedInputPath, runDirectory: f.directory, round: 1,
    builderResultPath: built.resultPath, checksResultPath: checked.resultPath,
  });
  assert.deepEqual(roles.map(({ role }) => role), ['builder', 'reviewer']);
  assert.equal(roles[1].request.mastraReviewOnly, true);
  assert.equal(roles[1].request.builderResultPath, built.resultPath);
  assert.equal(roles[1].request.checksResultPath, checked.resultPath);
});

test('production adapter repair consumes prior findings and reviews the checks current candidate', async t => {
  const f = await fixture(t);
  const priorReviewPath = join(f.directory, 'review-1.json');
  const currentReviewInputPath = join(f.directory, 'review-input-2.json');
  const currentCandidatePath = join(f.directory, 'candidate-2.json');
  await writeFile(priorReviewPath, `${JSON.stringify({ verdict: 'FAIL', findings: ['repair this'] })}\n`);
  await writeFile(currentReviewInputPath, `${JSON.stringify({ candidate: 'candidate-2', files: [], criteria: [] })}\n`);
  await writeFile(currentCandidatePath, `${JSON.stringify({ base: 'c'.repeat(40), commit: 'd'.repeat(40) })}\n`);
  await writeFile(f.input.approvedInputPath, `${JSON.stringify({
    builderRequest: { configuration: { harness: 'fixture' }, prompt: 'build' },
    reviewerRequest: {
      issueId: 'JUL-196', candidate: { base: 'a'.repeat(40), commit: 'b'.repeat(40) },
      configuration: { model: 'reviewer', maker: 'Reviewer Co', connection: { provider: 'commandcode' } },
      reviewInput: { candidate: 'stale' },
    },
  })}\n`);
  const launched = [];
  const adapters = createExistingDeliveryStepAdapters({
    worktree: f.directory,
    launch: async (role, request) => {
      launched.push({ role, request });
      return role === 'builder'
        ? { exitCode: 0, observed: { maker: 'Builder Co' } }
        : { exitCode: 1, text: 'offline refusal', observed: { maker: 'Reviewer Co' } };
    },
    checks: async () => ({
      status: 'PASS', change: 'candidate-2', reviewInputPath: currentReviewInputPath, candidatePath: currentCandidatePath,
    }),
    notify: f.options.adapters.notify,
  });
  const built = await adapters.builder({
    approvedInputPath: f.input.approvedInputPath, runDirectory: f.directory, round: 2, priorReviewPath,
  });
  const checked = await adapters.checks({ runDirectory: f.directory, round: 2, builderResultPath: built.resultPath });
  await adapters.reviewer({
    approvedInputPath: f.input.approvedInputPath, runDirectory: f.directory, round: 2,
    builderResultPath: built.resultPath, checksResultPath: checked.resultPath,
  });
  assert.match(launched[0].request.prompt, /review-1\.json/);
  assert.doesNotMatch(launched[0].request.prompt, /repair this/);
  assert.equal(launched[1].request.reviewInput.candidate, 'candidate-2');
  assert.equal(launched[1].request.candidate.commit, 'd'.repeat(40));
});

test('production adapter refuses a reviewer from the observed builder maker', async t => {
  const f = await fixture(t);
  await writeFile(f.input.approvedInputPath, `${JSON.stringify({
    reviewerRequest: {
      issueId: 'JUL-196', candidate: { base: 'a'.repeat(40), commit: 'b'.repeat(40) },
      configuration: { model: 'reviewer', maker: 'Same Co', connection: { provider: 'commandcode' } },
      reviewInput: { candidate: 'candidate-1' },
    },
  })}\n`);
  const builderResultPath = join(f.directory, 'builder-1.json');
  const checksResultPath = join(f.directory, 'checks-1.json');
  await writeFile(builderResultPath, `${JSON.stringify({ status: 'PASS', observed: { maker: 'same co' } })}\n`);
  await writeFile(checksResultPath, `${JSON.stringify({ status: 'PASS' })}\n`);
  const adapters = createExistingDeliveryStepAdapters({
    worktree: f.directory, launch: () => assert.fail('same-maker review must not launch'),
    checks: async () => ({}), notify: f.options.adapters.notify,
  });
  await assert.rejects(() => adapters.reviewer({
    approvedInputPath: f.input.approvedInputPath, runDirectory: f.directory, round: 1,
    builderResultPath, checksResultPath,
  }), /maker must differ/);
});

test('production adapter preserves a failed review report for the next repair', async t => {
  const f = await fixture(t);
  const reviewInput = {
    candidate: 'b'.repeat(40), digest: 'fixture-digest', files: ['fixture.mjs'], criteria: ['the fixture works'],
    sources: { 'file:fixture.mjs': 'deliberate deterministic candidate fixture', 'test-evidence': 'checked offline evidence' },
  };
  const text = fixtureReport(reviewInput, 'FAIL', 'repair this finding');
  const expectedReport = JSON.parse(text.split('\nREVIEW: ')[1]);
  await writeFile(f.input.approvedInputPath, `${JSON.stringify({
    reviewerRequest: {
      issueId: 'JUL-196', candidate: { base: 'a'.repeat(40), commit: reviewInput.candidate },
      configuration: { model: 'reviewer', maker: 'Reviewer Co', connection: { provider: 'commandcode' } },
      reviewInput,
    },
  })}\n`);
  const builderResultPath = join(f.directory, 'builder-real-1.json');
  const checksResultPath = join(f.directory, 'checks-real-1.json');
  await writeFile(builderResultPath, `${JSON.stringify({ status: 'PASS', observed: { maker: 'Builder Co' } })}\n`);
  await writeFile(checksResultPath, `${JSON.stringify({ status: 'PASS' })}\n`);
  const adapters = createExistingDeliveryStepAdapters({
    worktree: f.directory,
    launch: async () => ({
      exitCode: 0, text,
      observed: { maker: 'Reviewer Co', model: 'reviewer' },
      usage: { inputTokens: 21, outputTokens: 8 }, costEstimateUsd: 0.0042,
    }),
    checks: async () => ({}), notify: f.options.adapters.notify,
  });
  const { resultPath } = await adapters.reviewer({
    approvedInputPath: f.input.approvedInputPath, runDirectory: f.directory, round: 1,
    builderResultPath, checksResultPath,
  });
  const saved = JSON.parse(await readFile(resultPath, 'utf8'));
  assert.deepEqual(saved.report, expectedReport);
  assert.equal(saved.inputTokens, 21);
  assert.equal(saved.costEstimateUsd, 0.0042);
});

test('an unhandled workflow failure still ends with an ADR 0017 summary line', async t => {
  const f = await fixture(t);
  f.options.adapters.builder = async () => ({});
  const runtime = await createDeliveryWorkflowRuntime(f.options);
  const result = await runtime.start({ runId: 'jul196-system-error', input: f.input });
  await runtime.close();
  assert.equal(result.status, 'failed');
  const summaries = (await readFile(f.summaryPath, 'utf8')).trim().split(/\r?\n/);
  assert.equal(summaries.length, 1);
  assert.match(summaries[0], /^card=JUL-196 change=unknown round=1 stop=SYSTEM_ERROR reason=/);
  assert.match(summaries[0], /reviewerModel=unknown reviewerEffort=unknown inputTokens=unknown outputTokens=unknown costEstimateUsd=unknown start=.* end=.*/);
});

test('a recovered terminal write does not duplicate the run summary line', async () => {
  const summaryPath = join(suiteDirectory, 'idempotent-summary.log');
  assert.equal(await appendPermanentSummaryLine(summaryPath, 'same-run', 'card=JUL-196 verdict=ACCEPT'), true);
  assert.equal(await appendPermanentSummaryLine(summaryPath, 'same-run', 'card=JUL-196 verdict=ACCEPT'), false);
  assert.equal((await readFile(summaryPath, 'utf8')).trim().split(/\r?\n/).length, 1);
});
