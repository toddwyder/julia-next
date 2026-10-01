import assert from 'node:assert/strict';
import test from 'node:test';
import { DuckDBStore } from '@mastra/duckdb';
import { readTraceSpans, normalizeTraceSpans } from '../mastra-traces.mjs';

test('native DuckDB retains a model call in this week when its root began last week', async () => {
  const store = new DuckDBStore({ id: 'cost-window-test', path: ':memory:' });
  try {
    await store.init();
    const observability = await store.getStore('observability');
    for (const span of [
      { spanId: 'root', spanType: 'agent_run', name: 'code-review-agent', startedAt: new Date('2026-10-04T23:59:00Z'), metadata: { threadId: 'pr-184-head' } },
      { spanId: 'generation', parentSpanId: 'root', spanType: 'model_generation', name: 'generate', startedAt: new Date('2026-10-04T23:59:30Z') },
      { spanId: 'step', parentSpanId: 'generation', spanType: 'model_step', name: 'step', startedAt: new Date('2026-10-05T00:01:00Z') },
      { spanId: 'call', parentSpanId: 'step', spanType: 'model_inference', name: 'infer', startedAt: new Date('2026-10-05T00:01:00Z'), attributes: { model: 'deepseek-v4-pro', usage: { inputTokens: 1000, outputTokens: 100, inputDetails: { cacheRead: 0 }, outputDetails: { reasoning: 50 } } } },
    ]) await observability.createSpan({ span: { traceId: 'crossing', isEvent: false, ...span } });
    const from = '2026-10-05T00:00:00Z';
    const to = '2026-10-12T00:00:00Z';
    const oldQuery = await observability.listTracesLight({ filters: { startedAt: { start: new Date(from), end: new Date(to) } }, pagination: { page: 0, perPage: 20 } });
    assert.equal(oldQuery.spans.length, 0, 'root-only weekly filtering really omits the crossing call');
    const fetchImpl = async url => {
      const u = new URL(url);
      const route = u.pathname.replace('/api/observability/traces', '');
      let body;
      if (route === '/light') {
        const dateRange = JSON.parse(u.searchParams.get('startedAt'));
        body = await observability.listTracesLight({ filters: { startedAt: dateRange }, pagination: { page: Number(u.searchParams.get('page')), perPage: Number(u.searchParams.get('perPage')) } });
      } else if (route === '/crossing/light') body = await observability.getTraceLight({ traceId: 'crossing' });
      else if (route === '/crossing/spans/call') body = await observability.getSpan({ traceId: 'crossing', spanId: 'call' });
      else throw new Error(`Unexpected route ${route}`);
      return new Response(JSON.stringify(body));
    };
    const spans = await readTraceSpans({ factoryUrl: 'http://localhost', token: 'reader', from, to, fetchImpl });
    assert.equal(spans.filter(span => span.spanType === 'model_step' && span.includedInGeneration).length, 1);
    const calls = normalizeTraceSpans(spans, { cards: [{ number: 'PR-184' }] }).filter(span => span.costBearing);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].card, 'PR-184');
    assert.equal(calls[0].phase, 'review');
    assert.equal(calls[0].startedAt, '2026-10-05T00:01:00.000Z');
    assert.equal(calls[0].tokens.thinking, 50);
  } finally {
    await store.close();
  }
});
