import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
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
