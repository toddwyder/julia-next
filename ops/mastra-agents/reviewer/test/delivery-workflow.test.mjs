import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

import { appendPermanentSummaryLine } from '../src/delivery-workflow.mjs';
import { createDeliveryWorkflowRuntime } from '../src/delivery-workflow-runtime.mjs';
import { createExistingDeliveryStepAdapters } from '../src/delivery-step-adapters.mjs';
import { handleReviewerCrash } from '../src/delivery-crash-recovery.mjs';
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
  const launchInputPath = join(directory, 'launch.json');
  await writeFile(approvedInputPath, `${JSON.stringify({
    identifier: 'JUL-196',
    authorization: { spending: { reviewer: { mode: 'paid', maxUsd: 1 } } },
  })}\n`);
  await writeFile(launchInputPath, `${JSON.stringify({ issueId: 'JUL-196' })}\n`);
  const adapters = createOfflineDeliveryAdapters({ directory, callsPath, verdicts });
  const options = { storagePath, runDirectory: directory, summaryPath, adapters };
  const input = { card: 'JUL-196', launchInputPath, runDirectory: directory };
  return { directory, callsPath, storagePath, summaryPath, approvedInputPath, launchInputPath, options, input };
}

async function events(path) {
  return (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function resultFile(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
  return { resultPath: path };
}

test('green build, checks and independent review write one waiting record, pause, and accept after a runtime restart', async t => {
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
    args: ['julia-delivery', 'jul196-accept'],
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
    'authorization:0', 'card-read:0', 'builder:1', 'checks:1', 'reviewer:1', 'waiting:1', 'acceptance:1',
  ]);
  const waiting = JSON.parse(await readFile(join(f.directory, 'waiting-offline-candidate-1.json'), 'utf8'));
  assert.deepEqual(waiting, {
    card: 'JUL-196', candidateCommit: 'offline-candidate-1',
    evidencePaths: [join(f.directory, 'builder-1.json'), join(f.directory, 'checks-1.json'), join(f.directory, 'review-1.json')],
    summary: 'Round 1 passed its checks and independent review and is waiting for Todd\'s technical acceptance.',
  });
  const summaries = (await readFile(f.summaryPath, 'utf8')).trim().split(/\r?\n/);
  assert.equal(summaries.length, 1);
  assert.match(summaries[0], /card=JUL-196 change=offline-candidate-1 round=1 verdict=ACCEPT/);
  assert.match(summaries[0], /reviewerModel=stand-in-reviewer reviewerEffort=none inputTokens=0 outputTokens=0 costEstimateUsd=0/);
  assert.match(summaries[0], /start=.* end=.*/);
});

test('a card missing agreed seams parks immediately without a builder or repair round', async t => {
  const f = await fixture(t);
  const reason = 'card has no agreed test seams';
  f.options.adapters.cardRead = async () => {
    await writeFile(f.approvedInputPath, `${JSON.stringify({ identifier: 'JUL-196', cardProblemReason: reason })}\n`);
    await appendFile(f.callsPath, `${JSON.stringify({ kind: 'card-read', round: 0 })}\n`);
    return { resultPath: f.approvedInputPath };
  };
  const runtime = await createDeliveryWorkflowRuntime(f.options);
  const result = await runtime.start({ runId: 'jul196-card-problem', input: f.input });
  await runtime.close();

  assert.equal(result.status, 'success');
  assert.equal(result.result.outcome, 'parked');
  assert.equal(result.result.round, 0);
  assert.equal(result.result.reason, reason);
  assert.deepEqual((await events(f.callsPath)).map(({ kind, round }) => `${kind}:${round}`), [
    'authorization:0', 'card-read:0', 'park:0',
  ]);
  const summaries = (await readFile(f.summaryPath, 'utf8')).trim().split(/\r?\n/);
  assert.equal(summaries.length, 1);
  assert.match(summaries[0], /^card=JUL-196 change=unknown round=0 stop=PARK reason="card has no agreed test seams"/);
});

test('a failed worker CLI update parks before any worker launches', async t => {
  const f = await fixture(t);
  f.options.adapters.toolUpdates = () => resultFile(join(f.directory, 'tool-updates.json'), {
    status: 'FAIL', reason: 'codex update failed: network unavailable',
    tools: [{ tool: 'codex', status: 'FAIL', beforeVersion: 'old' }],
  });
  const runtime = await createDeliveryWorkflowRuntime(f.options);
  const result = await runtime.start({ runId: 'jul196-update-failure', input: f.input });
  await runtime.close();

  assert.equal(result.status, 'success');
  assert.equal(result.result.outcome, 'parked');
  assert.equal(result.result.round, 0);
  assert.match(result.result.reason, /codex update failed/);
  assert.deepEqual((await events(f.callsPath)).map(({ kind }) => kind), ['authorization', 'card-read', 'park']);
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
    'authorization:0', 'card-read:0', 'builder:1', 'checks:1', 'reviewer:1', 'waiting:1', 'acceptance:1',
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

test('two failed reviews park without a waiting record or a third builder launch', async t => {
  const f = await fixture(t, ['FAIL', 'FAIL']);
  const runtime = await createDeliveryWorkflowRuntime(f.options);
  const result = await runtime.start({ runId: 'jul196-park', input: f.input });
  assert.equal(result.status, 'success');
  assert.equal(result.result.outcome, 'parked');
  assert.equal(result.result.round, 2);
  await runtime.close();
  assert.deepEqual((await events(f.callsPath)).map(({ kind, round }) => `${kind}:${round}`), [
    'authorization:0', 'card-read:0', 'builder:1', 'checks:1', 'reviewer:1',
    'builder:2', 'checks:2', 'reviewer:2',
    'park:2',
  ]);
  const summary = await readFile(f.summaryPath, 'utf8');
  assert.match(summary, /round=2 stop=PARK reason="offline stand-in review"/);
});

test('a reviewer-launcher crash gets one recovery cycle, never becomes review FAIL, and launches no product builder', async t => {
  const f = await fixture(t);
  let reviewLaunches = 0;
  const crashPath = join(f.directory, 'crash-reviewer-1.json');
  f.options.adapters.reviewer = async ({ round }) => {
    reviewLaunches += 1;
    await f.options.adapters.record({ kind: 'reviewer', round, attempt: reviewLaunches });
    if (reviewLaunches === 1) {
      await writeFile(crashPath, `${JSON.stringify({
        kind: 'technical-failure', incidentId: 'reviewer-1-incident-1', step: 'reviewer-launch',
        reason: 'fault injection: reviewer launcher crashed before provider dispatch',
        candidateCommit: 'offline-candidate-1', providerAcceptance: 'not-accepted', costUsd: 0,
      })}\n`);
      const error = new Error('fault injection: reviewer launcher crashed');
      error.deliveryCrashPath = crashPath;
      throw error;
    }
    return resultFile(join(f.directory, 'review-1-recovered.json'), {
      verdict: 'PASS', reason: null, model: 'stand-in-reviewer', effort: 'none',
      inputTokens: 0, outputTokens: 0, costEstimateUsd: 0,
    });
  };
  f.options.adapters.recoverCrash = async ({ round, crashPath: receivedCrashPath }) => {
    await f.options.adapters.record({ kind: 'recovery', round });
    assert.equal(receivedCrashPath, crashPath);
    return resultFile(join(f.directory, 'recovery-reviewer-1.json'), {
      status: 'RESUME', incidentId: 'reviewer-1-incident-1', interruptedStep: 'reviewer-launch',
      crashPath, rootCause: 'reviewer stdin used fs.promises.readFile with numeric descriptor 0',
      recoveryCommit: '1'.repeat(40), fixer: { identity: 'codex-recovery', maker: 'OpenAI' },
      reviewer: { identity: 'claude-recovery-review', maker: 'Anthropic' },
      reviewBypassedFailedStep: true, reviewResult: 'PASS', verificationResult: 'PASS',
      resumePoint: 'reviewer-launch', candidateCommit: 'offline-candidate-1',
      spend: { authorizedUsd: 1, spentUsd: 0, maximumAdditionalUsd: 0 },
      originalPaidRequest: { acceptance: 'not-accepted', costUsd: 0 },
    });
  };

  const runtime = await createDeliveryWorkflowRuntime(f.options);
  const result = await runtime.start({ runId: 'jul196-reviewer-crash', input: f.input });
  await runtime.close();

  assert.equal(result.status, 'suspended');
  const recorded = await events(f.callsPath);
  assert.deepEqual(recorded.map(({ kind, round }) => `${kind}:${round}`), [
    'authorization:0', 'card-read:0', 'builder:1', 'checks:1',
    'reviewer:1', 'recovery:1', 'reviewer:1', 'waiting:1',
  ]);
  assert.equal(recorded.filter(({ kind }) => kind === 'builder').length, 1);
  assert.equal((await readFile(join(f.directory, 'review-1.json'), 'utf8').catch(() => null)), null);
  const metadata = JSON.parse(await readFile(join(f.directory, 'jul196-reviewer-crash-workflow-metrics.json'), 'utf8'));
  assert.equal(metadata.crashIncidents.length, 1);
  assert.equal(metadata.crashIncidents[0].recoveryResultPath, join(f.directory, 'recovery-reviewer-1.json'));
});

test('uncertain paid reviewer acceptance parks without recovery or another model call', async t => {
  const f = await fixture(t);
  const crashPath = join(f.directory, 'crash-reviewer-uncertain.json');
  f.options.adapters.reviewer = async ({ round }) => {
    await f.options.adapters.record({ kind: 'reviewer', round });
    await writeFile(crashPath, `${JSON.stringify({
      kind: 'technical-failure', incidentId: 'reviewer-uncertain', step: 'reviewer-launch', reason: 'connection lost',
      candidateCommit: 'offline-candidate-1', providerAcceptance: 'uncertain', costUsd: null,
    })}\n`);
    const error = new Error('connection lost after dispatch');
    error.deliveryCrashPath = crashPath;
    throw error;
  };
  f.options.adapters.recoverCrash = () => assert.fail('uncertain paid dispatch must park before a recovery call');

  const runtime = await createDeliveryWorkflowRuntime(f.options);
  const result = await runtime.start({ runId: 'jul196-uncertain-reviewer-crash', input: f.input });
  await runtime.close();

  assert.equal(result.status, 'success');
  assert.equal(result.result.outcome, 'parked');
  assert.match(result.result.reason, /acceptance or cost is uncertain/);
  assert.deepEqual((await events(f.callsPath)).map(({ kind, round }) => `${kind}:${round}`), [
    'authorization:0', 'card-read:0', 'builder:1', 'checks:1', 'reviewer:1', 'park:1',
  ]);
});

test('a replayed durable crash incident parks without a second recovery cycle', async t => {
  const f = await fixture(t);
  const crashPath = join(f.directory, 'crash-reviewer-1.json');
  const incident = { incidentId: 'durable-incident', crashPath, interruptedStep: 'reviewer-launch', round: 1, recoveryStartedAt: new Date().toISOString() };
  await writeFile(crashPath, `${JSON.stringify({
    kind: 'technical-failure', incidentId: incident.incidentId, step: incident.interruptedStep,
    candidateCommit: 'offline-candidate-1', providerAcceptance: 'not-accepted', costUsd: 0,
  })}\n`);
  const runMetadataPath = join(f.directory, 'replay-workflow-metrics.json');
  await writeFile(runMetadataPath, `${JSON.stringify({ crashIncidents: [incident] })}\n`);
  const error = new Error('replayed reviewer failure');
  error.deliveryCrashPath = crashPath;
  const handled = await handleReviewerCrash({
    error,
    inputData: { ...f.input, approvedInputPath: f.approvedInputPath, runMetadataPath, round: 1 },
    checksResult: { status: 'PASS', candidateCommit: 'offline-candidate-1' },
    adapters: { recoverCrash: () => assert.fail('replay must not start another recovery cycle') },
  });
  assert.match(handled.inputData.stopReason, /refusing a second recovery cycle/);
  assert.equal(JSON.parse(await readFile(runMetadataPath, 'utf8')).crashIncidents.length, 1);
});

test('recovery evidence cannot resume a step other than the crashed step', async t => {
  const f = await fixture(t);
  const crashPath = join(f.directory, 'crash-wrong-resume.json');
  const crash = { kind: 'technical-failure', incidentId: 'wrong-resume', step: 'reviewer-launch', candidateCommit: 'offline-candidate-1', providerAcceptance: 'not-accepted', costUsd: 0 };
  await writeFile(crashPath, `${JSON.stringify(crash)}\n`);
  const runMetadataPath = join(f.directory, 'wrong-resume-metrics.json');
  await writeFile(runMetadataPath, '{"crashIncidents":[]}\n');
  const error = new Error('reviewer crashed');
  error.deliveryCrashPath = crashPath;
  const handled = await handleReviewerCrash({
    error,
    inputData: { ...f.input, approvedInputPath: f.approvedInputPath, runMetadataPath, round: 1, checksResultPath: join(f.directory, 'checks.json') },
    checksResult: { status: 'PASS', candidateCommit: crash.candidateCommit },
    adapters: {
      recoverCrash: () => resultFile(join(f.directory, 'wrong-resume-recovery.json'), {
        status: 'RESUME', incidentId: crash.incidentId, interruptedStep: crash.step, crashPath,
        rootCause: 'fixture', recoveryCommit: 'c'.repeat(40), fixer: { identity: 'fixer', maker: 'OpenAI' },
        reviewer: { identity: 'reviewer', maker: 'Anthropic' }, reviewBypassedFailedStep: true,
        reviewResult: 'PASS', verificationResult: 'PASS', resumePoint: 'builder-launch', candidateCommit: crash.candidateCommit,
        spend: { authorizedUsd: 1, spentUsd: 0, maximumAdditionalUsd: 0 }, originalPaidRequest: { acceptance: 'not-accepted', costUsd: 0 },
      }),
      reviewer: () => assert.fail('wrong resume point must not resume'),
    },
  });
  assert.match(handled.inputData.stopReason, /wrong resume point/);
});

test('the intentional production reviewer gate parks at zero cost without crash recovery', async t => {
  const f = await fixture(t);
  const candidateCommit = 'b'.repeat(40);
  const reviewInput = {
    candidate: candidateCommit, digest: 'fixture-digest', files: ['fixture.mjs'], criteria: ['the fixture works'],
    sources: { 'file:fixture.mjs': 'deliberate deterministic candidate fixture', 'test-evidence': 'checked offline evidence' },
  };
  await writeFile(f.approvedInputPath, `${JSON.stringify({
    identifier: 'JUL-196', authorization: { spending: { reviewer: { mode: 'paid', maxUsd: 1 } } },
    builderRequest: { configuration: { harness: 'fixture' }, prompt: 'build' },
    reviewerRequest: {
      issueId: 'JUL-196', candidate: { base: 'a'.repeat(40), commit: candidateCommit }, reviewInput,
      configuration: { model: 'fixture-reviewer', maker: 'Reviewer Co', harness: 'omp', connection: { provider: 'commandcode' } },
    },
  })}\n`);
  let reviewerLaunches = 0;
  let builderLaunches = 0;
  let recoveries = 0;
  const launch = async (role, request) => {
    if (role === 'builder') {
      builderLaunches += 1;
      return { exitCode: 0, observed: { maker: 'Builder Co', model: 'fixture-builder' } };
    }
    reviewerLaunches += 1;
    await f.options.adapters.record({ kind: 'reviewer', round: request.round, attempt: reviewerLaunches });
    return {
      exitCode: 2,
      observed: null,
      text: 'paid execution is disabled until provider acceptance is implemented',
      technicalFailure: 'paid execution is disabled until provider acceptance is implemented',
      plannedGate: 'paid-reviewer-disabled',
      providerAcceptance: 'not-accepted',
      costEstimateUsd: 0,
    };
  };
  const existing = createExistingDeliveryStepAdapters({
    worktree: f.directory,
    launch,
    checks: async () => ({ status: 'PASS', change: candidateCommit, candidateCommit }),
    recoverCrash: async () => { recoveries += 1; throw new Error('intentional paid gate must not enter recovery'); },
    waitingRecord: f.options.adapters.waitingRecord,
  });
  f.options.adapters = { ...f.options.adapters, builder: existing.builder, checks: existing.checks, reviewer: existing.reviewer, recoverCrash: existing.recoverCrash };
  const runtime = await createDeliveryWorkflowRuntime(f.options);
  const result = await runtime.start({ runId: 'jul196-production-gate-recovery', input: f.input });
  await runtime.close();
  assert.equal(result.status, 'success');
  assert.equal(result.result.outcome, 'parked');
  assert.match(result.result.reason, /paid execution is disabled/);
  assert.equal(reviewerLaunches, 1);
  assert.equal(builderLaunches, 1);
  assert.equal(recoveries, 0);
});

test('accepting a changed candidate discards the answer, reruns checks and review, and pauses again', async t => {
  const f = await fixture(t);
  f.options.adapters.validateCandidate = async ({ round }) => {
    await f.options.adapters.record({ kind: 'validate', round });
    await writeFile(join(f.directory, 'candidate-version.txt'), '2');
    return { status: 'STALE', reason: 'candidate commit changed' };
  };
  const firstRuntime = await createDeliveryWorkflowRuntime(f.options);
  const paused = await firstRuntime.start({ runId: 'jul196-stale', input: f.input });
  assert.equal(paused.status, 'suspended');
  await firstRuntime.close();

  const restartedRuntime = await createDeliveryWorkflowRuntime(f.options);
  try {
    const rerun = await restartedRuntime.resume({ runId: 'jul196-stale', decision: 'accept' });
    assert.equal(rerun.status, 'suspended');
    assert.equal(rerun.outcome, 'awaiting-technical-acceptance');
  } finally {
    await restartedRuntime.close();
  }
  assert.deepEqual((await events(f.callsPath)).map(({ kind, round }) => `${kind}:${round}`), [
    'authorization:0', 'card-read:0', 'builder:1', 'checks:1', 'reviewer:1', 'waiting:1', 'validate:1',
    'checks:2', 'reviewer:2', 'waiting:2',
  ]);
});

test('workflow step handoffs expose paths and round metadata, never file contents', async t => {
  const f = await fixture(t);
  const seen = [];
  for (const key of ['authorization', 'cardRead', 'builder', 'checks', 'reviewer', 'waitingRecord']) {
    const original = f.options.adapters[key];
    f.options.adapters[key] = async input => { seen.push({ key, input }); return original(input); };
  }
  const runtime = await createDeliveryWorkflowRuntime(f.options);
  await runtime.start({ runId: 'jul196-paths', input: f.input });
  await runtime.close();
  for (const { input } of seen) {
    assert.equal(typeof input.runDirectory, 'string');
    if ('round' in input) assert.equal(Number.isInteger(input.round), true);
    assert.equal(JSON.stringify(input).includes('offline stand-in review'), false);
    assert.equal(Object.keys(input).every(key => ['round', 'cycle', 'runDirectory'].includes(key) || key.endsWith('Path')), true);
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
  await writeFile(f.approvedInputPath, `${JSON.stringify(approved)}\n`);
  const launch = async (role, request) => {
    roles.push({ role, request });
    if (role === 'builder') return { exitCode: 0, observed: { model: 'fixture-builder', maker: 'Builder Co' } };
    return { exitCode: 1, text: 'offline reviewer refusal', observed: { model: 'fixture-reviewer' } };
  };
  const adapters = createExistingDeliveryStepAdapters({
    worktree: f.directory,
    launch,
    checks: async () => ({ status: 'PASS', change: 'fixture-change' }),
    waitingRecord: f.options.adapters.waitingRecord,
  });
  const built = await adapters.builder({ approvedInputPath: f.approvedInputPath, runDirectory: f.directory, round: 1 });
  const checked = await adapters.checks({ runDirectory: f.directory, round: 1, builderResultPath: built.resultPath });
  let firstCrashPath;
  await assert.rejects(adapters.reviewer({
    approvedInputPath: f.approvedInputPath, runDirectory: f.directory, round: 1,
    builderResultPath: built.resultPath, checksResultPath: checked.resultPath,
  }), error => {
    assert.match(error.message, /reviewer launcher failed/);
    assert.equal(typeof error.deliveryCrashPath, 'string');
    firstCrashPath = error.deliveryCrashPath;
    return true;
  });
  assert.deepEqual(roles.map(({ role }) => role), ['builder', 'reviewer']);
  assert.equal(roles[1].request.mastraReviewOnly, true);
  assert.equal(roles[1].request.builderResultPath, built.resultPath);
  assert.equal(roles[1].request.checksResultPath, checked.resultPath);
  assert.equal(await readFile(join(f.directory, 'review-1.json'), 'utf8').catch(() => null), null);
  await assert.rejects(adapters.reviewer({
    approvedInputPath: f.approvedInputPath, runDirectory: f.directory, round: 1,
    builderResultPath: built.resultPath, checksResultPath: checked.resultPath,
  }), error => error.deliveryCrashPath === firstCrashPath);
  await assert.rejects(adapters.reviewer({
    approvedInputPath: f.approvedInputPath, runDirectory: f.directory, round: 1,
    builderResultPath: built.resultPath, checksResultPath: checked.resultPath,
    recoveryResultPath: join(f.directory, 'recovery-reviewer-1.json'),
  }), /reviewer launcher failed/);
  assert.match(roles[3].request.outputPath, /reviewer-worker-1-recovered\.json$/);
});

test('production adapter repair consumes prior findings and reviews the checks current candidate', async t => {
  const f = await fixture(t);
  const priorReviewPath = join(f.directory, 'review-1.json');
  const currentReviewInputPath = join(f.directory, 'review-input-2.json');
  const currentCandidatePath = join(f.directory, 'candidate-2.json');
  await writeFile(priorReviewPath, `${JSON.stringify({ verdict: 'FAIL', findings: ['repair this'] })}\n`);
  await writeFile(currentReviewInputPath, `${JSON.stringify({ candidate: 'candidate-2', files: [], criteria: [] })}\n`);
  await writeFile(currentCandidatePath, `${JSON.stringify({ base: 'c'.repeat(40), commit: 'd'.repeat(40) })}\n`);
  await writeFile(f.approvedInputPath, `${JSON.stringify({
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
    waitingRecord: f.options.adapters.waitingRecord,
  });
  const built = await adapters.builder({
    approvedInputPath: f.approvedInputPath, runDirectory: f.directory, round: 2, priorReviewPath,
  });
  const checked = await adapters.checks({ runDirectory: f.directory, round: 2, builderResultPath: built.resultPath });
  await assert.rejects(adapters.reviewer({
    approvedInputPath: f.approvedInputPath, runDirectory: f.directory, round: 2,
    builderResultPath: built.resultPath, checksResultPath: checked.resultPath,
  }), /reviewer launcher failed/);
  assert.match(launched[0].request.prompt, /review-1\.json/);
  assert.doesNotMatch(launched[0].request.prompt, /repair this/);
  assert.equal(launched[1].request.reviewInput.candidate, 'candidate-2');
  assert.equal(launched[1].request.candidate.commit, 'd'.repeat(40));
});

test('production adapter refuses a reviewer from the observed builder maker', async t => {
  const f = await fixture(t);
  await writeFile(f.approvedInputPath, `${JSON.stringify({
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
    checks: async () => ({}), waitingRecord: f.options.adapters.waitingRecord,
  });
  await assert.rejects(() => adapters.reviewer({
    approvedInputPath: f.approvedInputPath, runDirectory: f.directory, round: 1,
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
  await writeFile(f.approvedInputPath, `${JSON.stringify({
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
    checks: async () => ({}), waitingRecord: f.options.adapters.waitingRecord,
  });
  const { resultPath } = await adapters.reviewer({
    approvedInputPath: f.approvedInputPath, runDirectory: f.directory, round: 1,
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
