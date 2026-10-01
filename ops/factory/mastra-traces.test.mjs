// mastra-traces.test.mjs -- issue #180: read trace costs and token breakdowns
// through Mastra's observability route and calculate what-you-pay pricing.
//
// The supported surface is the one the pinned `mastra` CLI wraps:
//   GET <factory>/julia/observability/traces (or /api/observability/traces)
//
// Tests verify:
//   - Token breakdown into fresh input, cached input, output, thinking tokens
//   - Price table what-you-pay application
//   - Named gaps for unpriced models and missing token counts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MASTRA_TRACE_ROUTE,
  MASTRA_INTERNAL_TRACE_ROUTE,
  normalizeTraceSpans,
  readTraceSpans,
} from './mastra-traces.mjs';

const FROM = '2026-09-21T00:00:00.000Z';
const TO = '2026-09-28T00:00:00.000Z';

const generationSpan = {
  traceId: 'trace-a',
  spanId: 'span-a',
  name: 'agent run',
  spanType: 'model_generation',
  entityType: 'agent',
  entityName: 'code-sdk',
  sessionId: 'session-140',
  threadId: 'thread-140',
  startedAt: '2026-09-22T09:00:00.000Z',
  endedAt: '2026-09-22T09:15:00.000Z',
  attributes: {
    model: 'deepseek/deepseek-v4-flash',
    usage: {
      inputTokens: 1000000,
      cachedInputTokens: 800000,
      outputTokens: 100000,
      reasoningTokens: 15000,
    },
    costContext: { provider: 'deepseek', model: 'deepseek-v4-flash', estimatedCost: 0.4, costUnit: 'usd' },
  },
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function fakeFetch(handler) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

test('the trace routes are defined for internal and api paths', () => {
  assert.equal(MASTRA_INTERNAL_TRACE_ROUTE, '/julia/observability/traces');
  assert.equal(MASTRA_TRACE_ROUTE, '/api/observability/traces');
});

test('readTraceSpans queries the internal route and falls back to /api if 404', async () => {
  const fake = fakeFetch((url) => {
    const u = new URL(url);
    if (u.pathname === '/julia/observability/traces') {
      return jsonResponse({ error: 'not found' }, 404);
    }
    return jsonResponse({ spans: [generationSpan], pagination: { page: 0, totalPages: 1, hasMore: false } });
  });

  const spans = await readTraceSpans({
    factoryUrl: 'https://factory.example',
    from: FROM,
    to: TO,
    fetchImpl: fake.fetch,
  });

  assert.equal(spans.length, 1);
  assert.equal(fake.calls.length, 2);
  assert.equal(new URL(fake.calls[0].url).pathname, '/julia/observability/traces');
  assert.equal(new URL(fake.calls[1].url).pathname, '/api/observability/traces');
});

test('readTraceSpans succeeds directly on the internal route', async () => {
  const fake = fakeFetch(() => jsonResponse({ spans: [generationSpan], pagination: { page: 0, totalPages: 1, hasMore: false } }));

  const spans = await readTraceSpans({
    factoryUrl: 'https://factory.example',
    from: FROM,
    to: TO,
    fetchImpl: fake.fetch,
  });

  assert.equal(spans.length, 1);
  assert.equal(fake.calls.length, 1);
  assert.equal(new URL(fake.calls[0].url).pathname, '/julia/observability/traces');
});

test('a generation span normalises with token breakdown and what-you-pay pricing from price table', () => {
  const [record] = normalizeTraceSpans([generationSpan], { cards: [{ number: 140, sessions: { 'session-140': {} } }] });

  assert.equal(record.id, 'span-a');
  assert.equal(record.traceId, 'trace-a');
  assert.equal(record.card, 140);
  assert.equal(record.sessionId, 'session-140');
  assert.equal(record.phase, 'build');
  assert.equal(record.startedAt, FROM_ISO(generationSpan.startedAt));
  assert.equal(record.endedAt, FROM_ISO(generationSpan.endedAt));
  assert.equal(record.model, 'deepseek/deepseek-v4-flash');
  assert.equal(record.tokens.total, 1100000);
  assert.equal(record.tokens.freshInput, 200000);
  assert.equal(record.tokens.cachedInput, 800000);
  assert.equal(record.tokens.output, 100000);
  assert.equal(record.tokens.thinking, 15000);
  // fresh: 200k * 0.27/1M = 0.054
  // cached: 800k * 0.07/1M = 0.056
  // output: 100k * 1.10/1M = 0.11
  // what-you-pay = 0.22
  assert.equal(Math.round(record.costUsd * 1000) / 1000, 0.22);
  assert.equal(Math.round(record.whatYouPayCost * 1000) / 1000, 0.22);

  assert.equal(record.outcome, 'passed');
  assert.equal(record.actor, 'Factory');
  assert.equal(record.gap, null);
});

test('a model span with no usage or token count records a named gap: no_token_count', () => {
  const noTokens = { ...generationSpan, attributes: { model: 'deepseek/deepseek-v4-flash' } };
  const [record] = normalizeTraceSpans([noTokens], { cards: [{ number: 140, sessions: { 'session-140': {} } }] });

  assert.equal(record.costBearing, true);
  assert.equal(record.costUsd, null);
  assert.equal(record.gap, 'no_token_count');
});

test('a model span with an unpriced model records a named gap: unpriced_model', () => {
  const unpriced = {
    ...generationSpan,
    attributes: {
      model: 'unknown/new-model',
      usage: { inputTokens: 1000, outputTokens: 500 },
    },
  };
  const [record] = normalizeTraceSpans([unpriced], { cards: [{ number: 140, sessions: { 'session-140': {} } }] });

  assert.equal(record.costBearing, true);
  assert.equal(record.costUsd, null);
  assert.equal(record.gap, 'unpriced_model');
  assert.equal(record.model, 'unknown/new-model');
  assert.equal(record.freshInputTokens, 1000);
});

test('a failed attempt is marked failed, and its cost still counts', () => {
  const failed = { ...generationSpan, spanId: 'span-f', error: { message: 'boom' }, status: 'error' };
  const [record] = normalizeTraceSpans([failed], { cards: [{ number: 140, sessions: { 'session-140': {} } }] });

  assert.equal(record.outcome, 'failed-attempt');
  assert.equal(Math.round(record.costUsd * 1000) / 1000, 0.22);
});

test('a span whose session matches no card is reported as uncorrelated, never guessed onto a card', () => {
  const [record] = normalizeTraceSpans([generationSpan], { cards: [{ number: 141, sessions: { 'session-other': {} } }] });

  assert.equal(record.card, null);
  assert.equal(record.correlated, false);
  assert.equal(Math.round(record.costUsd * 1000) / 1000, 0.22);
});

test('a non-model span with no costContext is not cost-bearing', () => {
  const tool = { ...generationSpan, spanType: 'tool_call', attributes: { tool: 'grep' } };
  const [record] = normalizeTraceSpans([tool]);

  assert.equal(record.costBearing, false);
  assert.equal(record.costUsd, null);
  assert.equal(record.gap, null);
});

function FROM_ISO(value) {
  return new Date(Date.parse(value)).toISOString();
}
