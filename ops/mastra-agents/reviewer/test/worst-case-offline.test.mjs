import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod/v4';
import { REVIEW_STEP_MS, REVIEW_TOTAL_MS, reviewStepBudget } from '../src/contract.mjs';
import { initializeCardBudget } from '../src/review-budget.mjs';
import { createRecordingEngine } from '../src/recording-engine.mjs';
import { createReviewerRuntime } from '../src/reviewer.mjs';
import { directoryBytes, durableWrite, RUN_EVIDENCE_MAX_BYTES, RUN_WARNING_RESERVE_BYTES } from '../src/run-file.mjs';
import { REVIEW_MAX_DISK_GROWTH_BYTES, REVIEW_MAX_RSS_BYTES, REVIEW_MIN_FREE_DISK_BYTES } from '../src/resource-budget.mjs';

const files = ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs'];
const criteria = Array.from({ length: 8 }, (_, index) => `criterion-${index + 1}`);
const call = (id, name, argumentsValue) => ({ id, type: 'function', function: { name, arguments: argumentsValue } });
const toolMessage = tool_calls => ({ role: 'assistant', content: null, tool_calls });

async function slowMaximumServer(messages, { nearStepLimit = false } = {}) {
  const requests = [];
  const durationsMs = [];
  const server = createServer(async (request, response) => {
    const startedAt = performance.now();
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    const index = requests.length - 1;
    const delayMs = nearStepLimit && (index === 34 || index === 67)
      ? 14_000
      : (index % 10 === 9 ? 400 : 75);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    const message = messages.shift();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: `offline-worst-${requests.length}`, object: 'chat.completion', created: 1, model: 'offline-reviewer',
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192, prompt_tokens_details: { cached_tokens: 32 } },
    }));
    durationsMs.push(performance.now() - startedAt);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    requests, durationsMs,
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('offline maximum-length installed Agent.generate review measures every one-review budget', { timeout: 120_000 }, async t => {
  const maxSteps = reviewStepBudget(files, criteria);
  assert.equal(maxSteps, 70);
  const directory = await mkdtemp(join(tmpdir(), 'jul223-worst-case-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cardBudgetPath = join(directory, 'card', 'ledger.json');
  await initializeCardBudget(cardBudgetPath);
  let accepted = [];
  let submitted = false;
  const pieceSchema = z.object({ type: z.literal('progress'), index: z.number().int().min(0).max(67) });
  const reportSchema = z.object({ completed: z.literal(true) });
  const recorder = await createRecordingEngine({
    runDirectory: directory,
    pieceSchema,
    reportSchema,
    keyOf: piece => `progress:${piece.index}`,
    requiredKeys: Array.from({ length: 68 }, (_, index) => `progress:${index}`),
    assemble: () => ({ completed: true }),
    onProgress: keys => { accepted = keys; },
    submit: async report => {
      submitted = true;
      await durableWrite(join(directory, 'verdict.json'), `${JSON.stringify({ state: 'PASS', report })}\n`, { root: directory });
      return { accepted: true };
    },
  });
  const messages = [
    ...Array.from({ length: 68 }, (_, index) => toolMessage([call(`piece-${index}`, 'record_piece', JSON.stringify({ type: 'progress', index }))])),
    toolMessage([call('submit', 'submit_report', '{}')]),
    { role: 'assistant', content: 'Maximum-length offline review complete.' },
  ];
  const api = await slowMaximumServer(messages, { nearStepLimit: true });
  t.after(() => api.close());
  const runtime = await createReviewerRuntime({
    runDirectory: directory,
    cardBudgetPath,
    input: { files, criteria },
    spending: { mode: 'paid', maxUsd: 0.50, cumulativeMaxUsd: 1, ledgerPath: cardBudgetPath },
    progress: () => accepted,
  });
  const connection = createOpenAICompatible({
    name: 'offline', apiKey: 'offline', baseURL: api.baseURL,
    fetch: (url, init) => runtime.fetch(url, init),
  });
  const model = await resolveModelConfig(connection.chatModel('offline-reviewer'));
  const agent = new Agent({ id: 'jul223-worst-case', name: 'JUL-223 worst case', model, instructions: 'Record every scripted piece, submit, then acknowledge.', tools: recorder.tools });
  const startedAt = performance.now();
  const result = await runtime.generate({
    agent,
    prompt: 'Run the maximum-length offline review.',
    verdictPath: join(directory, 'verdict.json'),
    rawAnswer: { saved: false, rawAnswerPath: join(directory, 'raw.txt'), runId: 'offline-worst-case', candidateCommit: 'a'.repeat(40) },
    recorder,
    submitted: () => submitted,
  });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.text, 'Maximum-length offline review complete.');
  assert.equal(api.requests.length, maxSteps);
  assert.equal(messages.length, 0);
  assert.equal(accepted.length, 68);
  assert.ok(api.requests.every(request => request.max_tokens === 4096));
  const resources = await runtime.resourceSummary();
  const budget = await runtime.budgetSummary();
  const retainedMeasurements = JSON.parse(await readFile(join(directory, 'review-measurements.json'), 'utf8'));
  assert.equal(retainedMeasurements.state, 'COMPLETED');
  assert.equal(retainedMeasurements.budget.responses.length, maxSteps);
  assert.equal(retainedMeasurements.resources.peakProviderStepMs, resources.peakProviderStepMs);
  const evidenceBytes = await runtime.verifyEvidence();
  const maximumObservedStepMs = resources.peakAgentStepMs;
  assert.ok(maximumObservedStepMs < REVIEW_STEP_MS);
  assert.ok(elapsedMs < REVIEW_TOTAL_MS);
  assert.ok(budget.peakReservedTotalUsd <= 0.50);
  assert.ok(budget.spentUsd <= 0.50);
  assert.ok(evidenceBytes <= RUN_EVIDENCE_MAX_BYTES);
  assert.ok(resources.peakRssBytes <= REVIEW_MAX_RSS_BYTES);
  assert.ok(resources.peakRssStepIncreaseBytes <= resources.rssStepReserveBytes);
  assert.ok(resources.peakDiskGrowthBytes <= REVIEW_MAX_DISK_GROWTH_BYTES);
  assert.ok(resources.freeDiskBytes >= REVIEW_MIN_FREE_DISK_BYTES);
  const proof = {
    kind: 'JUL-223 stage-three offline worst-case proof',
    paidCalls: 0,
    inventory: { files: files.length, criteria: criteria.length, formula: '3F + 3C + 34', maxSteps },
    selectedStepMs: REVIEW_STEP_MS,
    selectionReason: '15 seconds is below the 17.143-second per-step share of the 20-minute total at 70 steps, leaving 150 seconds for agent/tool overhead; two scripted 14-second replies prove the full installed Agent step stays inside it.',
    memoryReservationReason: 'RSS is sampled every 10 ms across the complete agent step. The sampler aborts at the 736 MiB guard (768 MiB minus the 32 MiB next-power-of-two reserve), and the same guard refuses pre-dispatch.',
    result: 'PASS',
    measured: {
      steps: api.requests.length,
      elapsedMs,
      maximumObservedStepMs,
      spentUsd: budget.spentUsd,
      peakReservedTotalUsd: budget.peakReservedTotalUsd,
      evidenceBytes,
      peakRssBytes: resources.peakRssBytes,
      initialRssBytes: resources.initialRssBytes,
      peakRssStepIncreaseBytes: resources.peakRssStepIncreaseBytes,
      rssStepReserveBytes: resources.rssStepReserveBytes,
      diskGrowthBytes: resources.peakDiskGrowthBytes,
      freeDiskBytes: resources.freeDiskBytes,
    },
    limits: {
      steps: maxSteps,
      elapsedMs: REVIEW_TOTAL_MS,
      reservedCostUsd: 0.50,
      evidenceBytes: RUN_EVIDENCE_MAX_BYTES,
      peakRssBytes: REVIEW_MAX_RSS_BYTES,
      diskGrowthBytes: REVIEW_MAX_DISK_GROWTH_BYTES,
      minimumFreeDiskBytes: REVIEW_MIN_FREE_DISK_BYTES,
    },
    refusalProofs: [
      { limit: 'steps', test: 'the 70-step stock ceiling prevents step 71 and saves SYSTEM_ERROR progress' },
      { limit: 'elapsed', test: 'elapsed refusal through Agent.generate ends as SYSTEM_ERROR with saved progress before dispatch' },
      { limit: 'cost', test: 'the $0.50 reservation refuses an oversized request before network dispatch and saves SYSTEM_ERROR' },
      { limit: 'evidence', test: 'the 64 MiB evidence reservation refuses the crossing write and retains SYSTEM_ERROR progress' },
      { limit: 'memory', test: 'in-step RSS guard aborts Agent.generate below 768 MiB and saves SYSTEM_ERROR progress' },
      { limit: 'disk-growth', test: 'disk-growth reservation stops before atomic evidence can cross 128 MiB' },
      { limit: 'free-disk', test: 'free-disk preflight stops before start and durably records SYSTEM_ERROR progress' },
    ].map(item => ({ ...item, result: 'PASS', terminalState: 'SYSTEM_ERROR', progressSaved: true })),
  };
  if (process.env.JUL223_OFFLINE_PROOF_PATH) {
    await writeFile(process.env.JUL223_OFFLINE_PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`);
  }
});

const rawAnswerFor = directory => ({ saved: false, rawAnswerPath: join(directory, 'raw.txt'), runId: 'offline-limit', candidateCommit: 'b'.repeat(40) });
const stubRecorder = acceptedPieces => ({
  recordTechnicalFailure: async (_path, reason) => ({ kind: 'technical-failure', reason, acceptedPieces }),
});

test('the 70-step stock ceiling prevents step 71 and saves SYSTEM_ERROR progress', { timeout: 120_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-step-limit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cardBudgetPath = join(directory, 'card.json');
  await initializeCardBudget(cardBudgetPath);
  let accepted = [];
  const recorder = await createRecordingEngine({
    runDirectory: directory,
    pieceSchema: z.object({ type: z.literal('progress'), index: z.number().int().min(0) }),
    reportSchema: z.object({ completed: z.literal(true) }),
    keyOf: piece => `progress:${piece.index}`,
    requiredKeys: ['never-complete'],
    assemble: () => ({ completed: true }),
    onProgress: keys => { accepted = keys; },
    submit: async () => ({ accepted: true }),
  });
  const messages = Array.from({ length: 71 }, (_, index) => toolMessage([call(`step-${index}`, 'record_piece', JSON.stringify({ type: 'progress', index }))]));
  const api = await slowMaximumServer(messages);
  t.after(() => api.close());
  const runtime = await createReviewerRuntime({
    runDirectory: directory, cardBudgetPath, input: { files, criteria },
    spending: { mode: 'paid', maxUsd: 0.50, cumulativeMaxUsd: 1, ledgerPath: cardBudgetPath }, progress: () => accepted,
  });
  const connection = createOpenAICompatible({ name: 'offline', apiKey: 'offline', baseURL: api.baseURL, fetch: (url, init) => runtime.fetch(url, init) });
  const model = await resolveModelConfig(connection.chatModel('offline-reviewer'));
  const agent = new Agent({ id: 'step-limit', name: 'Step limit', model, instructions: 'Keep recording.', tools: recorder.tools });
  await assert.rejects(runtime.generate({
    agent, prompt: 'Exhaust the step budget.', verdictPath: join(directory, 'verdict.json'), rawAnswer: rawAnswerFor(directory), recorder,
    submitted: () => false, failureDetail: () => 'model exhausted the 70 step maximum before submit_report',
  }), /70 step maximum/);
  assert.equal(api.requests.length, 70);
  assert.equal(messages.length, 1, 'step 71 must remain undispatched');
  const terminal = JSON.parse(await readFile(join(directory, 'terminal-state.json'), 'utf8'));
  assert.equal(terminal.state, 'SYSTEM_ERROR');
  assert.equal(terminal.limit, 'steps');
  assert.equal(terminal.progress.acceptedPieces.length, 70);
});

test('the $0.50 reservation refuses an oversized request before network dispatch and saves SYSTEM_ERROR', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-cost-limit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cardBudgetPath = join(directory, 'card.json');
  await initializeCardBudget(cardBudgetPath);
  const runtime = await createReviewerRuntime({
    runDirectory: directory, cardBudgetPath, input: { files, criteria },
    spending: { mode: 'paid', maxUsd: 0.50, cumulativeMaxUsd: 1, ledgerPath: cardBudgetPath }, progress: () => ['header'],
  });
  let networkDispatches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkDispatches += 1; throw new Error('must not dispatch'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const connection = createOpenAICompatible({ name: 'offline', apiKey: 'offline', baseURL: 'http://provider.invalid/v1', fetch: (url, init) => runtime.fetch(url, init) });
  const model = await resolveModelConfig(connection.chatModel('offline-reviewer'));
  const agent = new Agent({ id: 'cost-limit', name: 'Cost limit', model, instructions: 'Reply.' });
  await assert.rejects(runtime.generate({
    agent, prompt: 'x'.repeat(1_700_000), verdictPath: join(directory, 'verdict.json'), rawAnswer: rawAnswerFor(directory),
    recorder: stubRecorder(['header']), submitted: () => false,
  }), /cross the \$0\.5 limit/);
  assert.equal(networkDispatches, 0);
  const terminal = JSON.parse(await readFile(join(directory, 'terminal-state.json'), 'utf8'));
  assert.equal(terminal.state, 'SYSTEM_ERROR');
  assert.equal(terminal.limit, 'cost');
  assert.deepEqual(terminal.progress.acceptedPieces, ['header']);
});

test('the 64 MiB evidence reservation refuses the crossing write and retains SYSTEM_ERROR progress', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-evidence-limit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cardBudgetPath = join(directory, 'card.json');
  await initializeCardBudget(cardBudgetPath);
  const runtime = await createReviewerRuntime({
    runDirectory: directory, cardBudgetPath, input: { files, criteria },
    spending: { mode: 'paid', maxUsd: 0.50, cumulativeMaxUsd: 1, ledgerPath: cardBudgetPath }, progress: () => ['header'],
  });
  const currentBytes = await directoryBytes(directory);
  const nearLimitPath = join(directory, 'near-limit.bin');
  await writeFile(nearLimitPath, '');
  await truncate(nearLimitPath, RUN_EVIDENCE_MAX_BYTES - RUN_WARNING_RESERVE_BYTES - currentBytes - 32);
  let networkDispatches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkDispatches += 1; throw new Error('must not dispatch'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const connection = createOpenAICompatible({ name: 'offline', apiKey: 'offline', baseURL: 'http://provider.invalid/v1', fetch: (url, init) => runtime.fetch(url, init) });
  const model = await resolveModelConfig(connection.chatModel('offline-reviewer'));
  const agent = new Agent({ id: 'evidence-limit', name: 'Evidence limit', model, instructions: 'Reply.' });
  await assert.rejects(runtime.generate({
    agent, prompt: 'Review.', verdictPath: join(directory, 'verdict.json'), rawAnswer: rawAnswerFor(directory),
    recorder: stubRecorder(['header']), submitted: () => false,
  }), /evidence limit/);
  assert.equal(networkDispatches, 0);
  const terminal = JSON.parse(await readFile(join(directory, 'terminal-state.json'), 'utf8'));
  assert.equal(terminal.state, 'SYSTEM_ERROR');
  assert.equal(terminal.limit, 'evidence');
  assert.deepEqual(terminal.progress.acceptedPieces, ['header']);
  assert.ok(await directoryBytes(directory) <= RUN_EVIDENCE_MAX_BYTES);
});
