// mastra-traces.test.mjs -- issue #180: read trace costs and token breakdowns
// through Mastra's observability route and calculate what-you-pay pricing.
//
// The supported surface is the one the pinned `mastra` CLI wraps:
//   GET <factory>/api/observability/traces
//
// Tests verify:
//   - Token breakdown into fresh input, cached input, output, thinking tokens
//   - Price table what-you-pay application
//   - Named gaps for unpriced models and missing token counts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MASTRA_TRACE_ROUTE,
  normalizeTraceSpans,
  readTraceSpans,
} from './mastra-traces.mjs';

const FROM = '2026-09-28T00:00:00.000Z';
const TO = '2026-10-05T00:00:00.000Z';

const generationSpan = {
  traceId: 'trace-a',
  spanId: 'span-a',
  name: 'agent run',
  spanType: 'model_generation',
  entityType: 'agent',
  entityName: 'code-sdk',
  sessionId: 'session-140',
  threadId: 'thread-140',
  startedAt: '2026-09-29T09:00:00.000Z',
  endedAt: '2026-09-29T09:15:00.000Z',
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

test('authenticated light timelines hydrate model calls and retain parent identity without full trace payloads', async () => {
  const root = { traceId: 'trace-a', spanId: 'root', spanType: 'agent_run', startedAt: generationSpan.startedAt, metadata: { threadId: 'session-140' } };
  const fake = fakeFetch((url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer test-reader');
    const u = new URL(url);
    if (u.pathname === '/api/observability/traces/light') {
      assert.equal(u.searchParams.get('page'), '0');
      assert.equal(u.searchParams.get('perPage'), '20');
      return jsonResponse({ spans: [root], pagination: { page: 0, hasMore: false } });
    }
    if (u.pathname === '/api/observability/traces/trace-a/light') return jsonResponse({ spans: [root, { ...generationSpan, attributes: undefined }] });
    if (u.pathname.endsWith('/spans/span-a')) return jsonResponse({ span: generationSpan });
    throw new Error(`Unexpected route ${u.pathname}`);
  });
  const spans = await readTraceSpans({ factoryUrl: 'https://factory.example', token: 'test-reader', from: FROM, to: TO, fetchImpl: fake.fetch });
  assert.equal(spans.filter(span => span.spanType === 'model_generation').length, 1);
  assert.equal(spans.find(span => span.spanId === 'span-a').attributes.usage.inputTokens, 1000000);
});

test('trace authentication failures are visible and never fall back to an unauthenticated route', async () => {
  const fake = fakeFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
  await assert.rejects(readTraceSpans({ factoryUrl: 'https://factory.example', token: 'wrong', from: FROM, to: TO, fetchImpl: fake.fetch }), /HTTP 401/);
  assert.equal(fake.calls.length, 1);
});

test('transport and malformed JSON failures identify the read operation without exposing credentials', async () => {
  const options = { factoryUrl: 'https://factory.example', token: 'secret-reader', from: FROM, to: TO };
  await assert.rejects(readTraceSpans({ ...options, fetchImpl: async () => { throw new TypeError('secret-reader'); } }), error =>
    /Mastra trace read \/api\/observability\/traces\/light transport failed/.test(error.message) && !error.message.includes('secret-reader'));
  await assert.rejects(readTraceSpans({ ...options, fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('secret-reader'); } }) }),
    /Mastra trace read \/api\/observability\/traces\/light returned invalid JSON/);
});

test('partial trace pagination fails closed', async () => {
  const fake = fakeFetch(() => jsonResponse({ spans: [], pagination: { page: 0, hasMore: true } }));
  await assert.rejects(readTraceSpans({ factoryUrl: 'https://factory.example', token: 'test-reader', from: FROM, to: TO, fetchImpl: fake.fetch }), /incomplete/);
});

test('a generation span normalises with token breakdown and what-you-pay pricing from price table', () => {
  const [record] = normalizeTraceSpans([generationSpan], { cards: [{ number: 140, sessions: { 'session-140': {} } }] });

  assert.equal(record.id, 'span-a');
  assert.equal(record.traceId, 'trace-a');
  assert.equal(record.card, 140);
  assert.equal(record.sessionId, 'session-140');
  assert.equal(record.phase, null);
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
  // what-you-pay = 0.185
  assert.equal(Math.round(record.costUsd * 1000) / 1000, 0.185);
  assert.equal(Math.round(record.whatYouPayCost * 1000) / 1000, 0.185);

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
  assert.equal(Math.round(record.costUsd * 1000) / 1000, 0.185);
});

test('a span whose session matches no card is reported as uncorrelated, never guessed onto a card', () => {
  const [record] = normalizeTraceSpans([generationSpan], { cards: [{ number: 141, sessions: { 'session-other': {} } }] });

  assert.equal(record.card, null);
  assert.equal(record.correlated, false);
  assert.equal(Math.round(record.costUsd * 1000) / 1000, 0.185);
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

test('live Factory PR references match top-level thread identity and recorded phase effort', () => {
  const span = { ...generationSpan, sessionId: undefined, threadId: 'live-thread' };
  const [record] = normalizeTraceSpans([span], { cards: [{ number: 'PR-133', sessions: { review: { threadId: 'live-thread' } },
    phaseSnapshots: [{ threadId: 'live-thread', at: '2026-09-29T08:59:00Z', stage: 'review', effort: 'high', model: 'deepseek/deepseek-v4-flash' }] }] });
  assert.equal(record.card, 'PR-133');
  assert.equal(record.effort, 'high');
});

test('recorded phase snapshot takes precedence over a root phase label', () => {
  const span = { ...generationSpan, sessionId: undefined, threadId: 'live-thread', factoryPhase: 'review' };
  const [record] = normalizeTraceSpans([span], { cards: [{ number: 'PR-184',
    sessions: { work: { threadId: 'live-thread' } },
    phaseSnapshots: [{ threadId: 'live-thread', at: '2026-09-29T08:59:00Z', phase: 'build', effort: 'high' }] }] });
  assert.equal(record.phase, 'build');
});

test('bundled estimates cannot replace missing counts and aggregate model spans are never billed twice', () => {
  const parent = { ...generationSpan, spanId: 'generation' };
  const child = { ...generationSpan, spanId: 'step', parentSpanId: 'generation', spanType: 'model_step' };
  const missing = { ...generationSpan, spanId: 'missing', attributes: { model: 'deepseek/deepseek-v4-flash', costContext: { estimatedCost: 10 } } };
  const records = normalizeTraceSpans([parent, child, missing]);
  assert.equal(records[1].costBearing, false);
  assert.equal(records[2].costUsd, null);
  assert.equal(records[2].gap, 'no_token_count');
});

test('a generation root with an inference child bills the hydrated leaf once', async () => {
  const root = { ...generationSpan, spanId: 'root', attributes: undefined, metadata: { threadId: 'session-140' } };
  const leaf = { ...generationSpan, spanId: 'leaf', parentSpanId: 'root', spanType: 'model_inference' };
  const fake = fakeFetch(url => {
    if (new URL(url).pathname === '/api/observability/traces/light') return jsonResponse({ spans: [root], pagination: { page: 0, hasMore: false } });
    if (url.endsWith('/trace-a/light')) return jsonResponse({ spans: [root, { ...leaf, attributes: undefined }] });
    if (url.endsWith('/spans/leaf')) return jsonResponse({ span: leaf });
    throw new Error('Unexpected request');
  });
  const spans = await readTraceSpans({ factoryUrl: 'https://factory.example', token: 'reader', from: FROM, to: TO, fetchImpl: fake.fetch });
  const records = normalizeTraceSpans(spans, { cards: [{ number: 140, sessions: { 'session-140': {} } }] });
  assert.equal(records.filter(x => x.costBearing).length, 1);
  assert.equal(records.find(x => x.costBearing).id, 'leaf');
  assert.ok(records.find(x => x.costBearing).costUsd > 0);
});
