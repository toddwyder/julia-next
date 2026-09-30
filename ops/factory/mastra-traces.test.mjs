// mastra-traces.test.mjs -- issue #140, blocker 3: read trace costs through
// Mastra's own observability API, not by querying the DuckDB file.
//
// The supported surface is the one the pinned `mastra` CLI wraps:
//
//   mastra api trace list --url <factory>   -> GET <factory>/api/observability/traces
//   mastra api trace query '<json>'         -> POST <factory>/api/observability/traces/query
//
// (mastra@1.31.3 dist/index.js, "api trace" command; the same routes are named
// in the installed `@mastra/core` observability route schema.) The tests drive
// a fake `fetch`, so nothing leaves this process. A response with no recognisable
// span list fails closed instead of reporting zero cost.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MASTRA_TRACE_ROUTE,
  normalizeTraceSpans,
  readTraceSpans,
} from './mastra-traces.mjs';

const FROM = '2026-09-21T00:00:00.000Z';
const TO = '2026-09-28T00:00:00.000Z';

// One MODEL_GENERATION span as the observability store returns it: the cost is
// `attributes.costContext.estimatedCost`, the correlation context carries the
// session, and `error`/`status` say whether the attempt failed.
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

test('the trace route is the one the pinned mastra CLI wraps', () => {
  assert.equal(MASTRA_TRACE_ROUTE, '/api/observability/traces');
});

test('readTraceSpans asks the supported route and reads the spans list', async () => {
  const fake = fakeFetch(() => jsonResponse({ spans: [generationSpan], pagination: { page: 0, totalPages: 1 } }));

  const spans = await readTraceSpans({
    factoryUrl: 'https://factory.example',
    from: FROM,
    to: TO,
    fetchImpl: fake.fetch,
  });

  assert.equal(spans.length, 1);
  assert.equal(fake.calls.length, 1);
  const url = new URL(fake.calls[0].url);
  assert.equal(url.pathname, '/api/observability/traces');
  // The route's `startedAt` filter is a range object, serialized the way the
  // pinned mastra CLI serializes objects: JSON in the query string.
  assert.deepEqual(JSON.parse(url.searchParams.get('startedAt')), {
    start: FROM,
    end: TO,
    startExclusive: false,
    endExclusive: true,
  });
  assert.deepEqual(JSON.parse(url.searchParams.get('pagination')), { page: 0, perPage: 100 });
  assert.equal(fake.calls[0].init.method, 'GET');
});

test('a page with no spans but a next page is followed', async () => {
  const pages = [
    { spans: [generationSpan], pagination: { page: 0, total: 2, hasMore: true } },
    { spans: [{ ...generationSpan, spanId: 'span-b', traceId: 'trace-b' }], pagination: { page: 1, total: 2, hasMore: false } },
  ];
  const fake = fakeFetch((url) => {
    const page = JSON.parse(new URL(url).searchParams.get('pagination')).page;
    return jsonResponse(pages[page]);
  });

  const spans = await readTraceSpans({ factoryUrl: 'https://factory.example', from: FROM, to: TO, fetchImpl: fake.fetch });

  assert.deepEqual(spans.map((s) => s.spanId), ['span-a', 'span-b']);
  assert.equal(fake.calls.length, 2);
});

test('a response without a spans list fails closed rather than reporting zero cost', async () => {
  const fake = fakeFetch(() => jsonResponse({ data: [] }));

  await assert.rejects(
    () => readTraceSpans({ factoryUrl: 'https://factory.example', from: FROM, to: TO, fetchImpl: fake.fetch }),
    /trace list|spans|not the supported shape/i,
  );
});

test('an HTTP error fails closed', async () => {
  const fake = fakeFetch(() => jsonResponse({ error: 'nope' }, 500));

  await assert.rejects(
    () => readTraceSpans({ factoryUrl: 'https://factory.example', from: FROM, to: TO, fetchImpl: fake.fetch }),
    /HTTP 500/,
  );
});

test('a generation span normalises to its cost, session, window, outcome and phase', () => {
  const [record] = normalizeTraceSpans([generationSpan], { cards: [{ number: 140, sessions: { 'session-140': {} } }] });

  assert.equal(record.id, 'span-a');
  assert.equal(record.traceId, 'trace-a');
  assert.equal(record.card, 140);
  assert.equal(record.sessionId, 'session-140');
  assert.equal(record.phase, 'build');
  assert.equal(record.startedAt, FROM_ISO(generationSpan.startedAt));
  assert.equal(record.endedAt, FROM_ISO(generationSpan.endedAt));
  assert.equal(record.costUsd, 0.4);
  assert.equal(record.outcome, 'passed');
  assert.equal(record.actor, 'Factory');
});

test('a failed attempt is marked failed, and its cost still counts', () => {
  const failed = { ...generationSpan, spanId: 'span-f', error: { message: 'boom' }, status: 'error' };
  const [record] = normalizeTraceSpans([failed], { cards: [{ number: 140, sessions: { 'session-140': {} } }] });

  assert.equal(record.outcome, 'failed-attempt');
  assert.equal(record.costUsd, 0.4);
});

test('a span whose session matches no card is reported as uncorrelated, never guessed onto a card', () => {
  const [record] = normalizeTraceSpans([generationSpan], { cards: [{ number: 141, sessions: { 'session-other': {} } }] });

  assert.equal(record.card, null);
  assert.equal(record.correlated, false);
  assert.equal(record.costUsd, 0.4);
});

test('a span with no cost is reported as unknown, not as zero', () => {
  const noCost = { ...generationSpan, attributes: { model: 'x' } };
  const [record] = normalizeTraceSpans([noCost], { cards: [{ number: 140, sessions: { 'session-140': {} } }] });

  assert.equal(record.costUsd, null);
});

test('a model span is marked cost-bearing even when Mastra recorded no cost', () => {
  // The note must fail closed on this: it is a billed span whose cost read
  // failed, so treating it as free would publish a wrong total.
  const noCost = { ...generationSpan, attributes: { model: 'x' } };
  const [record] = normalizeTraceSpans([noCost]);

  assert.equal(record.costBearing, true);
  assert.equal(record.costUsd, null);
});

test('a costContext payload marks a span cost-bearing whatever its type', () => {
  const toolWithCost = { ...generationSpan, spanType: 'tool_call', attributes: { costContext: { estimatedCost: 0.1 } } };
  const [record] = normalizeTraceSpans([toolWithCost]);

  assert.equal(record.costBearing, true);
});

test('a non-model span with no costContext is not cost-bearing', () => {
  const tool = { ...generationSpan, spanType: 'tool_call', attributes: { tool: 'grep' } };
  const [record] = normalizeTraceSpans([tool]);

  assert.equal(record.costBearing, false);
  assert.equal(record.costUsd, null);
});

function FROM_ISO(value) {
  return new Date(Date.parse(value)).toISOString();
}
