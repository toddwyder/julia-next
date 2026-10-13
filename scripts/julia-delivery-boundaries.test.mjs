import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authorizationReason, productionLauncher, workerPrompt } from './julia-delivery-runner.mjs';
import { safeWorkerEnvironment } from './julia-minimal-runner-checks.mjs';
import { createMastraDeliveryAdapters } from './julia-mastra-delivery.mjs';
import { createExistingDeliveryStepAdapters } from '../ops/mastra-agents/reviewer/src/delivery-step-adapters.mjs';

test('authorization and canonical builder prompt retain the approved production boundaries', () => {
  const configuration = { builder: { harness: 'codex' }, reviewer: { harness: 'commandcode' } };
  const authorization = { issueId: 'JUL-196', explicitStart: true, authorizedBy: 'Todd', spending: { builder: { mode: 'subscription', maxUsd: 0 }, reviewer: { mode: 'paid', maxUsd: 1 } } };
  assert.equal(authorizationReason(authorization, 'JUL-196', configuration), null);
  assert.match(authorizationReason({ ...authorization, explicitStart: false }, 'JUL-196', configuration), /explicit start/);
  const prompt = workerPrompt('builder', { identifier: 'JUL-196' }, configuration, 'run.json', 'approved.json');
  assert.match(prompt, /\.claude\/skills\/implement\/SKILL\.md/);
  assert.match(prompt, /do not reread Linear/);
  assert.match(prompt, /approved\.json/);
});

test('candidate processes receive operating-system plumbing but no controller secrets', async () => {
  const environment = { PATH: 'safe-path', SystemRoot: 'safe-root', LINEAR_API_KEY: 'linear-secret', OP_SERVICE_ACCOUNT_TOKEN: 'vault-secret', RANDOM_SECRET: 'secret' };
  assert.deepEqual(safeWorkerEnvironment(environment), { PATH: 'safe-path', SystemRoot: 'safe-root' });
  let launchedEnvironment;
  let recordedPid;
  const run = async (_command, _args, options, limits) => {
    launchedEnvironment = options.env;
    const sink = { on() {}, end() {} };
    limits.started({ pid: 42, stdout: sink, stderr: sink, stdin: sink, kill() {} });
    await new Promise(resolve => setImmediate(resolve));
    return { code: 0, signal: null, stopped: false };
  };
  const launch = productionLauncher('C:\\candidate', { run, environment, findExecutable: () => 'codex', sessionRoot: 'C:\\missing' });
  await launch('builder', {
    configuration: { harness: 'codex', model: 'stand-in', maker: 'OpenAI' }, prompt: 'offline',
    started: async ({ pid }) => { recordedPid = pid; },
  });
  assert.equal(recordedPid, 42);
  assert.equal(launchedEnvironment.PATH, 'safe-path');
  assert.equal(launchedEnvironment.LINEAR_API_KEY, undefined);
  assert.equal(launchedEnvironment.OP_SERVICE_ACCOUNT_TOKEN, undefined);
  assert.equal(launchedEnvironment.RANDOM_SECRET, undefined);
});

test('an ambiguous in-flight worker is journaled and never launched twice', async t => {
  const root = await mkdtemp(join(tmpdir(), 'delivery-launch-journal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const approvedInputPath = join(root, 'approved.json');
  await writeFile(approvedInputPath, `${JSON.stringify({ builderRequest: { configuration: { harness: 'stand-in' }, prompt: 'build' } })}\n`);
  let launches = 0;
  const adapters = createExistingDeliveryStepAdapters({
    worktree: root,
    launch: async (_role, request) => {
      launches += 1;
      await request.started({ pid: 73 });
      throw new Error('simulated controller crash after launch');
    },
    checks: async () => ({}), waitingRecord: async () => ({}),
  });
  const input = { approvedInputPath, runDirectory: root, round: 1, cycle: 1 };
  await assert.rejects(adapters.builder(input), /simulated controller crash/);
  await assert.rejects(adapters.builder(input), /ambiguous after restart/);
  assert.equal(launches, 1);
});

test('acceptance replay reuses the exact-commit record', async t => {
  const root = await mkdtemp(join(tmpdir(), 'delivery-acceptance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const approvedInputPath = join(root, 'approved.json');
  const checksResultPath = join(root, 'checks.json');
  await writeFile(approvedInputPath, `${JSON.stringify({ issueId: 'JUL-196', workspace: { path: root } })}\n`);
  await writeFile(checksResultPath, `${JSON.stringify({ candidateCommit: 'abc123' })}\n`);
  const adapters = createMastraDeliveryAdapters({ launch: async () => ({ exitCode: 0 }), test: async () => ({ status: 0, output: '' }) });
  const input = { approvedInputPath, checksResultPath, runDirectory: root };
  const first = await adapters.recordAcceptance(input);
  const firstText = await readFile(first.resultPath, 'utf8');
  const second = await adapters.recordAcceptance(input);
  assert.equal(second.resultPath, first.resultPath);
  assert.equal(await readFile(second.resultPath, 'utf8'), firstText);
  assert.deepEqual(JSON.parse(firstText), { card: 'JUL-196', candidateCommit: 'abc123', accepted: true, acceptedAt: JSON.parse(firstText).acceptedAt });
});

test('production waiting record is immutable and exactly once for a reviewed commit', async t => {
  const root = await mkdtemp(join(tmpdir(), 'delivery-waiting-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const approvedInputPath = join(root, 'approved.json');
  const checksResultPath = join(root, 'checks.json');
  const builderResultPath = join(root, 'builder.json');
  const reviewResultPath = join(root, 'review.json');
  await writeFile(approvedInputPath, `${JSON.stringify({ issueId: 'JUL-196', workspace: { path: root } })}\n`);
  await writeFile(checksResultPath, `${JSON.stringify({ candidateCommit: 'abc123', evidencePaths: ['proof.json'] })}\n`);
  await writeFile(builderResultPath, '{}\n');
  await writeFile(reviewResultPath, '{}\n');
  const adapters = createMastraDeliveryAdapters({ launch: async () => ({ exitCode: 0 }), test: async () => ({ status: 0, output: '' }) });
  const input = { approvedInputPath, checksResultPath, builderResultPath, reviewResultPath, runDirectory: root };
  const first = await adapters.waitingRecord(input);
  const firstText = await readFile(first.resultPath, 'utf8');
  const second = await adapters.waitingRecord(input);
  assert.equal(second.resultPath, first.resultPath);
  assert.equal(await readFile(second.resultPath, 'utf8'), firstText);
  const record = JSON.parse(firstText);
  assert.equal(record.card, 'JUL-196');
  assert.equal(record.candidateCommit, 'abc123');
  assert.deepEqual(record.evidencePaths, [builderResultPath, checksResultPath, reviewResultPath, 'proof.json']);
});
