import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authorizationReason, productionLauncher, workerPrompt } from './julia-delivery-runner.mjs';
import { safeWorkerEnvironment } from './julia-minimal-runner-checks.mjs';
import { createMastraDeliveryAdapters, runDurableExternalUpdate } from './julia-mastra-delivery.mjs';
import { createExistingDeliveryStepAdapters } from '../ops/mastra-agents/reviewer/src/delivery-step-adapters.mjs';

test('authorization and canonical builder prompt retain the approved production boundaries', () => {
  const configuration = { builder: { harness: 'codex' }, reviewer: { harness: 'commandcode' } };
  const authorization = { issueId: 'JUL-196', explicitStart: true, authorizedBy: 'Todd', linearActorId: 'linear-actor-1', spending: { builder: { mode: 'subscription', maxUsd: 0 }, reviewer: { mode: 'paid', maxUsd: 1 } } };
  assert.equal(authorizationReason(authorization, 'JUL-196', configuration), null);
  assert.match(authorizationReason({ ...authorization, explicitStart: false }, 'JUL-196', configuration), /explicit start/);
  assert.match(authorizationReason({ ...authorization, linearActorId: '' }, 'JUL-196', configuration), /Linear actor/);
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

test('external card updates retain their result and refuse ambiguous duplicate notices', async t => {
  const root = await mkdtemp(join(tmpdir(), 'delivery-external-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requestPath = join(root, 'request.json');
  const resultPath = join(root, 'result.json');
  let calls = 0;
  const input = {
    requestPath, resultPath, request: { operation: 'start-card', card: 'JUL-196' },
    operation: async () => { calls += 1; return { id: 'linear-comment-1', account: 'restricted-julia-service' }; },
  };
  const first = await runDurableExternalUpdate(input);
  const second = await runDurableExternalUpdate(input);
  assert.equal(calls, 1);
  assert.deepEqual(second.response, first.response);
  assert.deepEqual(JSON.parse(await readFile(resultPath, 'utf8')).response, { id: 'linear-comment-1', account: 'restricted-julia-service' });

  const ambiguousRequest = join(root, 'ambiguous-request.json');
  await writeFile(ambiguousRequest, '{}\n');
  await assert.rejects(runDurableExternalUpdate({
    requestPath: ambiguousRequest, resultPath: join(root, 'missing-result.json'),
    request: { operation: 'park-card', card: 'JUL-196' }, operation: async () => { calls += 1; },
  }), /refusing a duplicate/);
  assert.equal(calls, 1);
});

test('production card intake refuses the wrong Linear actor before a start update', async t => {
  const root = await mkdtemp(join(tmpdir(), 'delivery-linear-actor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const launchInputPath = join(root, 'launch.json');
  await writeFile(launchInputPath, `${JSON.stringify({
    issueId: 'JUL-196', runPath: join(root, 'run.json'), configuration: {},
    authorization: { linearActorId: 'authorized-actor' },
  })}\n`);
  let starts = 0;
  const adapters = createMastraDeliveryAdapters({
    readCard: async () => ({ id: 'issue-uuid', identifier: 'JUL-196', description: '## Acceptance criteria\n- approved', linearActor: { id: 'wrong-actor', name: 'Wrong account' } }),
    startCard: async () => { starts += 1; },
    launch: async () => ({ exitCode: 0 }), test: async () => ({ status: 0, output: '' }),
  });
  await assert.rejects(adapters.cardRead({ launchInputPath, runDirectory: root }), /Linear actor does not match/);
  assert.equal(starts, 0);
});

test('production card intake records a missing seam problem before workspace setup or start update', async t => {
  const root = await mkdtemp(join(tmpdir(), 'delivery-card-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const launchInputPath = join(root, 'launch.json');
  await writeFile(launchInputPath, `${JSON.stringify({
    issueId: 'JUL-196', runPath: join(root, 'run.json'), configuration: {},
    authorization: { linearActorId: 'authorized-actor' },
  })}\n`);
  let starts = 0;
  const adapters = createMastraDeliveryAdapters({
    repoRoot: join(root, 'source-that-must-not-be-opened'),
    readCard: async () => ({
      id: 'issue-uuid', identifier: 'JUL-196', description: '## Acceptance criteria\n- [ ] approved',
      linearActor: { id: 'authorized-actor', name: 'Authorized account' },
    }),
    startCard: async () => { starts += 1; },
  });
  const result = await adapters.cardRead({ launchInputPath, runDirectory: root });
  const approved = JSON.parse(await readFile(result.resultPath, 'utf8'));
  assert.equal(approved.cardProblemReason, 'card has no agreed test seams');
  assert.equal(approved.workspace, undefined);
  assert.equal(starts, 0);
});

test('production card intake records missing acceptance criteria before workspace setup or start update', async t => {
  const root = await mkdtemp(join(tmpdir(), 'delivery-card-acceptance-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const launchInputPath = join(root, 'launch.json');
  await writeFile(launchInputPath, `${JSON.stringify({
    issueId: 'JUL-196', runPath: join(root, 'run.json'), configuration: {},
    authorization: { linearActorId: 'authorized-actor' },
  })}\n`);
  let starts = 0;
  const adapters = createMastraDeliveryAdapters({
    repoRoot: join(root, 'source-that-must-not-be-opened'),
    readCard: async () => ({
      id: 'issue-uuid', identifier: 'JUL-196', description: '## Seams\n* `scripts/example.test.mjs`',
      linearActor: { id: 'authorized-actor', name: 'Authorized account' },
    }),
    startCard: async () => { starts += 1; },
  });
  const result = await adapters.cardRead({ launchInputPath, runDirectory: root });
  const approved = JSON.parse(await readFile(result.resultPath, 'utf8'));
  assert.equal(approved.cardProblemReason, 'card has no approved acceptance criteria');
  assert.equal(approved.workspace, undefined);
  assert.equal(starts, 0);
});

test('production park journal binds the verified Linear actor and known issue UUID', async t => {
  const root = await mkdtemp(join(tmpdir(), 'delivery-linear-trace-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const approvedInputPath = join(root, 'approved.json');
  const reviewResultPath = join(root, 'review.json');
  const actor = { id: 'authorized-actor', name: 'Julia service' };
  await writeFile(approvedInputPath, `${JSON.stringify({ issueId: 'JUL-196', card: { id: 'issue-uuid', linearActor: actor }, workspace: { path: root } })}\n`);
  await writeFile(reviewResultPath, `${JSON.stringify({ verdict: 'FAIL', reason: 'blocking defect' })}\n`);
  let receivedCard;
  const adapters = createMastraDeliveryAdapters({
    parkCard: async card => { receivedCard = card; return { id: 'comment-1', url: 'https://linear.app/comment-1' }; },
    launch: async () => ({ exitCode: 0 }), test: async () => ({ status: 0, output: '' }),
  });
  await adapters.park({ approvedInputPath, reviewResultPath, runDirectory: root });
  assert.equal(receivedCard.id, 'issue-uuid');
  const journal = JSON.parse(await readFile(join(root, 'linear-park-request.json'), 'utf8'));
  assert.deepEqual(journal.actor, actor);
  assert.equal(journal.card, 'JUL-196');
});
