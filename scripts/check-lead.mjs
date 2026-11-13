import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { costFromMetrics, loadCatalog, readCorrections } from '../dashboard/lib/model-prices.js';
import { leadModelId, leadModelPath } from '../machine/flow/models.mjs';
import { checkStudioStart } from './check-studio-start.mjs';

const REPLY = 'LEAD_SUBSCRIPTION_OK';
const delay = ms => new Promise(done => setTimeout(done, ms));

async function json(port, path) {
  const response = await fetch(`http://localhost:${port}/api${path}`, { signal: AbortSignal.timeout(10000) });
  assert(response.ok, `Studio ${path} returned HTTP ${response.status}.`);
  return response.json();
}

function hasExactText(value, text) {
  if (typeof value === 'string') return value === text;
  if (Array.isArray(value)) return value.some(item => hasExactText(item, text));
  if (value && typeof value === 'object') return Object.values(value).some(item => hasExactText(item, text));
  return false;
}

async function inspect(port, root, configuredModel) {
  const skill = readFileSync(resolve(root, '.agents/skills/poteto-mode/SKILL.md'), 'utf8');
  const agents = await json(port, '/agents');
  const entry = Object.entries(agents).find(([, agent]) => agent.name === 'Lead');
  assert(entry, 'Studio must list an agent named Lead.');
  const [key, agent] = entry;
  assert.equal(agent.instructions, skill, 'Studio Lead instructions must equal the complete poteto-mode file.');
  const model = configuredModel.slice('openai/'.length);
  assert.equal(agent.modelId?.split('/').at(-1), model, 'Studio must name the model from the independent Lead setting.');
  const runId = randomUUID();
  const response = await fetch(`http://localhost:${port}/api/agents/${encodeURIComponent(key)}/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: `This is a harmless connectivity check, not a build task. Do not use tools or start a card. Reply with exactly ${REPLY} and nothing else.`,
      runId,
      maxSteps: 1,
      toolChoice: 'none',
      activeTools: [],
    }),
    signal: AbortSignal.timeout(120000),
  });
  assert(response.ok, `The Studio Lead stream returned HTTP ${response.status}.`);
  const wire = await response.text();
  const events = wire.split('\n').filter(line => line.startsWith('data:')).map(line => {
    const body = line.slice(5).trim();
    return body === '[DONE]' ? null : JSON.parse(body);
  }).filter(Boolean);
  assert(!events.some(event => event.type === 'error'), 'The Studio Lead stream returned a provider error.');
  assert(!events.some(event => event.type === 'tool-call'), 'The connectivity check must not call a tool.');
  const reply = events.filter(event => event.type === 'text-delta').map(event => event.payload?.text ?? event.textDelta ?? '').join('').trim();
  assert.equal(reply, REPLY, 'The Lead must answer the fixed connectivity prompt.');

  let trace;
  const deadline = Date.now() + 30000;
  do {
    const listed = await json(port, '/observability/traces');
    for (const item of listed.spans ?? listed.traces ?? []) {
      const candidate = await json(port, `/observability/traces/${item.traceId}`);
      if (candidate.spans?.some(span => span.attributes?.runId === runId || span.runId === runId) || hasExactText(candidate, runId)) {
        trace = candidate;
        break;
      }
    }
    if (trace?.spans?.some(span => span.spanType === 'model_inference' && span.endedAt)) break;
    await delay(1000);
  } while (Date.now() < deadline);
  assert(trace, 'The Studio trace must persist this Lead run.');
  assert(hasExactText(trace, skill), 'The Studio trace must contain the complete poteto-mode instructions.');
  const calls = trace.spans.filter(span => span.spanType === 'model_inference');
  assert(calls.length > 0, 'The Studio trace must contain a model inference.');
  assert(calls.some(span => hasExactText(span, model)), 'The Studio trace must name the selected Lead model.');
  const metrics = await json(port, '/observability/metrics').catch(() => ({ metrics: [] }));
  const rows = metrics.metrics ?? [];
  const totals = rows.filter(row => row.name === 'mastra_model_total_input_tokens' || row.name === 'mastra_model_total_output_tokens');
  const cost = costFromMetrics(rows, {
    catalog: (() => { try { return loadCatalog(); } catch { return null; } })(),
    corrections: (() => { try { return readCorrections(); } catch { return {}; } })(),
  });
  return {
    agent: agent.name,
    configuredModel,
    instructionsSha256: createHash('sha256').update(skill).digest('hex'),
    reply,
    runId,
    traceId: trace.spans[0].traceId,
    modelCalls: calls.length,
    usage: calls.map(span => span.attributes?.usage ?? null),
    usd: cost.usd,
    costNote: cost.usd === null
      ? cost.unpriced.length
        ? `Unknown: the price list has no price for ${cost.unpriced.join(', ')}.`
        : 'Unknown: Studio returned no priced metric for this run.'
      : 'Priced from the same list the model picker uses.',
    metrics: totals.map(({ name, value, estimatedCost, costUnit, model }) => ({ name, value, estimatedCost, costUnit, model })),
    checks: { agentList: 'PASS', fullInstructions: 'PASS', subscriptionModelAndTrace: 'PASS' },
    shippingRerun: 'pending separate Shipping step',
  };
}

export async function checkLead({ root = process.cwd() } = {}) {
  assert(process.env.NODE_ENV !== 'test' && !process.env.VITEST, 'Run the subscription check outside test mode.');
  const env = { ...process.env, NODE_ENV: 'development' };
  delete env.FLOW_REPO;
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_BASE_URL;
  const settingPath = leadModelPath();
  assert(existsSync(settingPath), `The Lead model setting ${settingPath} is missing. Run node scripts/install-lead-model.mjs before this check.`);
  const settingText = readFileSync(settingPath, 'utf8');
  const configuredModel = leadModelId(settingPath);
  const result = await checkStudioStart({ root, env, onReady: ({ port }) => inspect(port, root, configuredModel) });
  assert.deepEqual(result.failures, [], 'The existing Studio workflow run form must remain valid.');
  assert.equal(readFileSync(settingPath, 'utf8'), settingText, 'The real Lead setting must stay unchanged during the check.');
  return {
    ...result.checked,
    modelSetting: { path: settingPath, value: configuredModel, sha256: createHash('sha256').update(settingText).digest('hex') },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkLead();
    const output = JSON.stringify(result, null, 2) + '\n';
    if (process.argv[2]) writeFileSync(resolve(process.argv[2]), output);
    console.log(output);
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'The Lead acceptance check failed before it could produce a verified result.');
    process.exitCode = 1;
  }
}
