import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod/v4';
import { createReviewerRuntime } from '../../src/reviewer.mjs';
import { initializeCardBudget } from '../../src/review-budget.mjs';
import { createRecordingEngine } from '../../src/recording-engine.mjs';
import { durableWrite } from '../../src/run-file.mjs';

const MODEL = 'deepseek/deepseek-v4.1-flash';
const BASE_URL = 'https://api.commandcode.ai/provider/v1';
const PROBE_TEXT = 'JUL-223 provider probe OK';
const pieceSchema = z.object({ type: z.literal('provider-probe'), text: z.literal(PROBE_TEXT) });
const reportSchema = z.object({ text: z.literal(PROBE_TEXT) });

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function runProbe({ baseURL, apiKey, runDirectory, cardBudgetPath }) {
  await initializeCardBudget(cardBudgetPath);
  const runtime = await createReviewerRuntime({
    runDirectory,
    cardBudgetPath,
    input: { files: ['provider-probe.mjs'], criteria: ['provider records and submits the probe result'] },
    spending: { mode: 'paid', maxUsd: 0.50, cumulativeMaxUsd: 1, ledgerPath: cardBudgetPath },
  });
  let submitted;
  const recorder = await createRecordingEngine({
    runDirectory,
    pieceSchema,
    reportSchema,
    keyOf: piece => piece.type,
    requiredKeys: ['provider-probe'],
    assemble: pieces => ({ text: pieces.get('provider-probe').text }),
    submit: async report => {
      submitted = report;
      await durableWrite(join(runDirectory, 'probe-verdict.json'), `${JSON.stringify(report)}\n`, { root: runDirectory });
      return { accepted: true };
    },
  });
  const connection = createOpenAICompatible({
    name: 'commandcode', apiKey, baseURL,
    fetch: (url, init) => runtime.fetch(url, { ...init, redirect: 'error' }),
  });
  const model = await resolveModelConfig(connection.chatModel(MODEL));
  const agent = new Agent({
    id: 'jul223-commandcode-provider-probe', name: 'JUL-223 CommandCode provider probe', model,
    instructions: `Call record_piece with {"type":"provider-probe","text":"${PROBE_TEXT}"}. After it is accepted, call submit_report with {}. Then reply exactly ${PROBE_TEXT}.`,
    tools: recorder.tools,
  });
  const result = await agent.generate('Record and submit the provider probe.', runtime.generationOptions);
  assert.deepEqual(submitted, { text: PROBE_TEXT });
  assert.equal(result.text.trim(), PROBE_TEXT);

  const budget = await readJson(join(runDirectory, 'review-budget.json'));
  const cardBudget = await readJson(cardBudgetPath);
  const journal = await readJson(join(runDirectory, 'model-events.json'));
  const requests = journal.filter(event => event.kind === 'request');
  const responses = journal.filter(event => event.kind === 'response');
  const usage = journal.filter(event => event.kind === 'usage');
  assert.ok(requests.length >= 2);
  assert.equal(responses.length, requests.length);
  assert.equal(usage.length, requests.length);
  assert.deepEqual(budget.responses, usage.map(event => event.responseId));
  assert.deepEqual(cardBudget.responses.slice(-usage.length), budget.responses);
  assert.equal(budget.pending, null);
  assert.equal(cardBudget.pending, null);
  assert.equal(budget.spentUsd, usage.reduce((total, event) => total + event.estimate.cost, 0));
  assert.ok(cardBudget.spentUsd >= budget.spentUsd);
  assert.ok(budget.spentUsd > 0 && budget.spentUsd < 0.50);
  assert.ok(responses.every((event, index) => JSON.parse(event.raw).id === usage[index].responseId));
  assert.ok(await runtime.verifyEvidence() > 0);
  return { budget, cardBudget, journal, providerResponses: responses.map(event => JSON.parse(event.raw)) };
}

const call = (id, name, argumentsValue) => ({ id, type: 'function', function: { name, arguments: argumentsValue } });

test('CommandCode recorder probe corrects a stand-in call, submits, and records cost evidence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-commandcode-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runDirectory = join(directory, 'run');
  const cardBudgetPath = join(directory, 'card', 'ledger.json');
  const requests = [];
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('bad-piece', 'record_piece', '{"type":"wrong"}')] },
    { role: 'assistant', content: null, tool_calls: [call('good-piece', 'record_piece', JSON.stringify({ type: 'provider-probe', text: PROBE_TEXT }))] },
    { role: 'assistant', content: null, tool_calls: [call('submit', 'submit_report', '{}')] },
    { role: 'assistant', content: PROBE_TEXT },
  ];
  const server = createServer(async (request, response) => {
    request.setEncoding('utf8');
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    const runBudget = await readJson(join(runDirectory, 'review-budget.json'));
    const cardBudget = await readJson(cardBudgetPath);
    assert.ok(runBudget.pending?.reservationId);
    assert.equal(cardBudget.pending?.reservationId, runBudget.pending.reservationId);
    const message = messages.shift();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: `stand-in-${requests.length}`, object: 'chat.completion', created: 1, model: MODEL,
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 17, completion_tokens: 6, total_tokens: 23, prompt_tokens_details: { cached_tokens: 0 } },
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const result = await runProbe({ baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'stand-in-key', runDirectory, cardBudgetPath });
  assert.equal(requests.length, 4);
  assert.match(requests[1].messages.find(message => message.tool_call_id === 'bad-piece').content, /validation failed/i);
  assert.ok(requests.every(request => request.max_tokens === 4096));
  assert.equal(result.providerResponses.length, 4);
});

test('CommandCode recorder probe refuses redirects without contacting their target', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-commandcode-redirect-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let targetRequests = 0;
  const target = createServer((_request, response) => { targetRequests += 1; response.end('unexpected'); });
  await new Promise((resolve, reject) => { target.once('error', reject); target.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => target.close(resolve)));
  let redirectRequests = 0;
  const redirect = createServer((_request, response) => {
    redirectRequests += 1;
    response.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/chat/completions` });
    response.end();
  });
  await new Promise((resolve, reject) => { redirect.once('error', reject); redirect.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => redirect.close(resolve)));

  await assert.rejects(runProbe({
    baseURL: `http://127.0.0.1:${redirect.address().port}/v1`, apiKey: 'stand-in-key',
    runDirectory: join(directory, 'run'), cardBudgetPath: join(directory, 'card', 'ledger.json'),
  }), /unresolved paid request/i);
  assert.equal(redirectRequests, 1);
  assert.equal(targetRequests, 0);
});

test('authorized CommandCode recorder probe runs once and retains its evidence', {
  skip: process.env.JUL223_COMMANDCODE_REAL_PROOF !== '1'
    ? 'operator opt-in required: JUL223_COMMANDCODE_REAL_PROOF=1; no provider call in ordinary suite'
    : false,
  timeout: 10 * 60 * 1000,
}, async () => {
  assert.ok(process.env.COMMANDCODE_API_KEY, 'COMMANDCODE_API_KEY must be supplied through the approved vault');
  assert.ok(process.env.JUL223_COMMANDCODE_PROBE_DIRECTORY, 'JUL223_COMMANDCODE_PROBE_DIRECTORY must name the retained run directory');
  const runDirectory = process.env.JUL223_COMMANDCODE_PROBE_DIRECTORY;
  const cardBudgetPath = process.env.JUL223_COMMANDCODE_CARD_LEDGER
    ?? join(homedir(), '.julia', 'runs', 'review-spend', 'JUL-223', 'ledger.json');
  const result = await runProbe({ baseURL: BASE_URL, apiKey: process.env.COMMANDCODE_API_KEY, runDirectory, cardBudgetPath });
  const usageEvents = result.journal.filter(event => event.kind === 'usage');
  console.log(JSON.stringify({
    providerResponseIds: usageEvents.map(event => event.responseId),
    usage: usageEvents.map(event => event.usage),
    estimatedCostUsd: result.budget.spentUsd,
    providerReportedCostUsd: result.providerResponses.reduce((total, response) => total + (response.usage?.cost ?? 0), 0),
    providerReportedCostAvailable: result.providerResponses.every(response => Number.isFinite(response.usage?.cost)),
    priceBands: [...new Set(usageEvents.map(event => event.estimate.priceBand))],
    reservationCleared: result.budget.pending === null && result.cardBudget.pending === null,
    journalKinds: result.journal.map(event => event.kind),
    runDirectory,
    cardBudgetPath,
  }));
});
