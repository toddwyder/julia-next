import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createReviewerRuntime } from '../src/reviewer.mjs';
import { initializeCardBudget } from '../src/review-budget.mjs';
import { REVIEW_MAX_RSS_BYTES, REVIEW_RSS_STEP_RESERVE_BYTES } from '../src/resource-budget.mjs';

test('the offline runtime wires stock bounds, authorization, durable budget, and provider journal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cardBudgetPath = join(directory, 'JUL-223-review-spend.json');
  await initializeCardBudget(cardBudgetPath);
  const runtime = await createReviewerRuntime({
    runDirectory: directory,
    cardBudgetPath,
    input: { files: ['a.mjs'], criteria: ['criterion'] },
    spending: { mode: 'paid', maxUsd: 0.50, cumulativeMaxUsd: 1, ledgerPath: cardBudgetPath },
    startedAt: 1_000_000,
    now: () => 1_000_000,
  });
  assert.deepEqual(runtime.generationOptions, {
    maxSteps: 40,
    modelSettings: { maxRetries: 0, maxOutputTokens: 4096, timeout: { totalMs: 1_200_000, stepMs: 15_000 } },
  });

  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume */ }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'runtime-1', choices: [{ message: { content: 'reply' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await runtime.fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: JSON.stringify({ messages: [] }) });

  const budget = JSON.parse(await readFile(join(directory, 'review-budget.json'), 'utf8'));
  assert.deepEqual(budget.responses, ['runtime-1']);
  assert.equal(budget.pending, null);
  const events = JSON.parse(await readFile(join(directory, 'model-events.json'), 'utf8'));
  assert.deepEqual(events.map(event => event.kind), ['request', 'response', 'usage']);
  assert.ok(await runtime.verifyEvidence() > 0);
});

test('elapsed refusal through Agent.generate ends as SYSTEM_ERROR with saved progress before dispatch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-runtime-elapsed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cardBudgetPath = join(directory, 'card.json');
  await initializeCardBudget(cardBudgetPath);
  const startedAt = 1_000_000;
  const runtime = await createReviewerRuntime({
    runDirectory: directory,
    cardBudgetPath,
    input: { files: ['a.mjs'], criteria: ['criterion'] },
    spending: { mode: 'paid', maxUsd: 0.50, cumulativeMaxUsd: 1, ledgerPath: cardBudgetPath },
    startedAt,
    now: () => startedAt + 20 * 60 * 1000 - 15_000 + 1,
    progress: () => ['header'],
  });
  let dispatches = 0;
  const connection = createOpenAICompatible({
    name: 'offline', apiKey: 'offline', baseURL: 'http://127.0.0.1:9/v1',
    fetch: (...args) => { dispatches += 1; return runtime.fetch(...args); },
  });
  const model = await resolveModelConfig(connection.chatModel('offline-reviewer'));
  const agent = new Agent({ id: 'elapsed-proof', name: 'Elapsed proof', model, instructions: 'Reply.' });
  const rawAnswer = { saved: false, rawAnswerPath: join(directory, 'raw.txt'), runId: 'offline', candidateCommit: 'a'.repeat(40) };
  const recorder = { recordTechnicalFailure: async (_path, reason) => ({ kind: 'technical-failure', reason, acceptedPieces: ['header'] }) };
  await assert.rejects(runtime.generate({
    agent, prompt: 'Review.', verdictPath: join(directory, 'verdict.json'), rawAnswer, recorder, submitted: () => false,
  }), /20 minute limit/);
  assert.equal(dispatches, 1, 'the provider adapter is entered but the network fetch must not be');
  const terminal = JSON.parse(await readFile(join(directory, 'terminal-state.json'), 'utf8'));
  assert.equal(terminal.state, 'SYSTEM_ERROR');
  assert.equal(terminal.limit, 'elapsed');
  assert.deepEqual(terminal.progress.acceptedPieces, ['header']);
});

test('in-step RSS guard aborts Agent.generate below 768 MiB and saves SYSTEM_ERROR progress', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-runtime-memory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cardBudgetPath = join(directory, 'card.json');
  await initializeCardBudget(cardBudgetPath);
  let rssBytes = 100 * 1024 * 1024;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume */ }
    rssBytes = REVIEW_MAX_RSS_BYTES - REVIEW_RSS_STEP_RESERVE_BYTES + 1;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!response.destroyed) response.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const runtime = await createReviewerRuntime({
    runDirectory: directory,
    cardBudgetPath,
    input: { files: ['a.mjs'], criteria: ['criterion'] },
    spending: { mode: 'paid', maxUsd: 0.50, cumulativeMaxUsd: 1, ledgerPath: cardBudgetPath },
    progress: () => ['header', 'axis:standards'],
    resourceMeasurements: { measureRssBytes: () => rssBytes },
  });
  const connection = createOpenAICompatible({
    name: 'offline', apiKey: 'offline', baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    fetch: (...args) => runtime.fetch(...args),
  });
  const model = await resolveModelConfig(connection.chatModel('offline-reviewer'));
  const agent = new Agent({ id: 'memory-proof', name: 'Memory proof', model, instructions: 'Reply.' });
  const rawAnswer = { saved: false, rawAnswerPath: join(directory, 'raw.txt'), runId: 'offline', candidateCommit: 'b'.repeat(40) };
  const recorder = { recordTechnicalFailure: async (_path, reason) => ({ kind: 'technical-failure', reason, acceptedPieces: ['header', 'axis:standards'] }) };
  await assert.rejects(runtime.generate({
    agent, prompt: 'Review.', verdictPath: join(directory, 'verdict.json'), rawAnswer, recorder, submitted: () => false,
  }), /736 MiB guard/);
  const terminal = JSON.parse(await readFile(join(directory, 'terminal-state.json'), 'utf8'));
  assert.equal(terminal.state, 'SYSTEM_ERROR');
  assert.equal(terminal.limit, 'memory');
  assert.ok(terminal.measured.peakRssBytes < REVIEW_MAX_RSS_BYTES);
  assert.deepEqual(terminal.progress.acceptedPieces, ['header', 'axis:standards']);
});

test('the runtime refuses an authorization other than the approved per-review amount', async () => {
  await assert.rejects(
    createReviewerRuntime({ runDirectory: 'unused', input: { files: ['a'], criteria: ['c'] }, spending: { mode: 'paid', maxUsd: 1 } }),
    /approved \$0\.50 paid limit/,
  );
});
