import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  duckdbObservabilityConfig,
  duckdbObservabilityRetention,
  observabilityDuckDBPath,
} from './src/mastra/observability-store.ts';
import {
  DEFAULT_PRUNE_OPTIONS,
  EMERGENCY_RETENTION,
  EMERGENCY_TRACE_RETENTION_DAYS,
  OBSERVABILITY_PRUNE_CRON,
  OBSERVABILITY_SIZE_BUDGET_BYTES,
  observabilityRetentionWorkflow,
  pruneObservabilityRetention,
  requiredFreeBytes,
  runObservabilityPrune,
  runObservabilityRetention,
  setObservabilityPruneTarget,
} from './src/mastra/observability-retention.ts';
import { captureFinishedFactoryCards } from './src/mastra/issue-cost-capture.ts';
import { MODEL_ID_MAP, OPENROUTER_MODELS_URL, refreshModelPrices } from './src/mastra/model-price-refresh.ts';

const savedOpenRouterModels = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/openrouter-models-2026-10-06.json'), 'utf8'));

test('maps every configured Factory model only to an exact ID in the saved OpenRouter list', () => {
  const expected = {
    'openai/gpt-6-sol': 'openai/gpt-6-sol',
    'moonshotai/Kimi-K2.7-Code': 'moonshotai/kimi-k2.7-code',
    'deepseek/deepseek-v4-pro': 'deepseek/deepseek-v4-pro',
    'command-code/deepseek/deepseek-v4-flash': 'deepseek/deepseek-v4-flash',
  };
  assert.deepEqual(MODEL_ID_MAP, expected);
  const savedIds = new Set(savedOpenRouterModels.data.map((model) => model.id));
  for (const routerId of Object.values(MODEL_ID_MAP)) assert.ok(savedIds.has(routerId), `${routerId} must be an exact saved OpenRouter ID`);
  assert.equal(MODEL_ID_MAP['deepseek/deepseek-flash'], undefined, 'OpenRouter has no exact listing for this Factory configuration ID');
});

test('refreshes only changed prices from a real OpenRouter response shape', async () => {
  const calls = [];
  await refreshModelPrices({
    database: { any: async (sql, values) => { calls.push([sql, values]); if (sql.startsWith('SELECT DISTINCT')) return [{ provider: 'openai', model: 'gpt-6-sol' }]; if (sql.startsWith('SELECT usd')) return []; return []; } },
    fetchImpl: async (url) => { assert.equal(url, OPENROUTER_MODELS_URL); return { ok: true, status: 200, json: async () => ({ data: [{ id: 'openai/gpt-6-sol', pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002', input_cache_write: '0.0000025', internal_reasoning: '0.00001' } }] }) }; },
    now: new Date('2026-10-06T00:00:00Z'), log: () => {},
  });
  assert.equal(calls.filter(([sql]) => sql.startsWith('INSERT')).length, 5);
});

test('reports a configured model as price-unknown when OpenRouter has no exact mapping', async () => {
  const lines = [];
  await refreshModelPrices({
    database: { any: async (sql) => sql.startsWith('SELECT DISTINCT') ? [{ provider: 'deepseek', model: 'deepseek-flash' }] : [] },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => savedOpenRouterModels }),
    log: (line) => lines.push(line),
  });
  assert.deepEqual(lines, ['model-price-refresh event=price-unknown provider=deepseek model=deepseek-flash', 'model-price-refresh event=completed']);
});

test('records every trace page by provider, model, and effort with named unknown token fields', async () => {
  const writes = [];
  const pages = [
    { spans: [{ spanId: 'live-163-a', sessionId: '12b5e576-9f88-4d6f-91f2-7279efad97b9', attributes: { costContext: { provider: 'openai', model: 'gpt-5' }, usage: { inputTokens: 100, outputTokens: 40, inputTokenDetails: { cacheRead: 20, cacheWrite: 5 }, outputTokenDetails: { reasoning: 7 } }, providerOptions: { openai: { reasoningEffort: 'high' } } } }], pagination: { hasMore: true } },
    // #163-style Mastra model span: usage can omit cacheWrite and the span can
    // omit providerOptions.  Those are named unknowns rather than zeroes.
    { spans: [{ spanId: 'live-163-b', sessionId: '12b5e576-9f88-4d6f-91f2-7279efad97b9', attributes: { costContext: { provider: 'openai', model: 'gpt-5' }, usage: { inputTokens: 30, outputTokens: 10, inputTokenDetails: { cacheRead: 0 } } } }], pagination: { hasMore: false } },
  ];
  await captureFinishedFactoryCards({
    projectId: 'project', projects: { listAll: async () => [{ id: 'project', orgId: 'org' }] },
    workItems: { list: async () => [{ title: 'Long session', stages: ['done'], externalSource: { externalId: 'github-issue:163' }, sessions: { work: { sessionId: '12b5e576-9f88-4d6f-91f2-7279efad97b9', threadId: 'same', thinkingLevel: 'medium' } } }] },
    observability: { listTraces: async ({ pagination }) => pages[pagination.page] },
    database: { any: async () => [], one: async (_sql, values) => { writes.push(values); return { record: values[1] }; } },
  });
  const record = JSON.parse(writes[0][2]);
  assert.deepEqual(record.tokens, [
    { provider: 'openai', model: 'gpt-5', effort: 'high', effortSources: ['span'], freshInputTokens: 80, cacheReadTokens: 20, cacheWriteTokens: 5, outputTokens: 40, thinkingTokens: 7 },
    { provider: 'openai', model: 'gpt-5', effort: 'medium', effortSources: ['session'], freshInputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 'unknown', outputTokens: 10, thinkingTokens: 'unknown' },
  ]);
});

test('captures a finished Factory card from the in-process stores and names unavailable values', async () => {
  const writes = [];
  const lines = [];
  await captureFinishedFactoryCards({
    projectId: '49b0ea94-d24b-43d7-8ce1-618cb61c5188',
    projects: { listAll: async () => [{ id: '49b0ea94-d24b-43d7-8ce1-618cb61c5188', orgId: 'org-1' }] },
    workItems: { list: async () => [{
      title: 'A finished card', stages: ['done'],
      externalSource: { externalId: 'github-issue:163' },
      stageHistory: [{ stage: 'done', enteredAt: '2026-10-06T10:00:00.000Z', by: 'agent:reviewer' }],
      sessions: { builder: { sessionId: 'session-163', threadId: 'thread-163', branch: 'main', startedBy: 'agent:builder' } },
    }] },
    observability: { listTraces: async () => ({ pagination: { hasMore: false }, spans: [{
      spanId: 'span-163', sessionId: 'session-163', name: 'execute', spanType: 'model_generation',
      attributes: { costContext: { estimatedCost: 0.25, provider: 'openai', model: 'gpt-test' } },
    }] }) },
    database: { any: async () => [], one: async (_sql, values) => { writes.push(values); return { record: values[1] }; } },
    log: (line) => lines.push(line),
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], 163);
  assert.deepEqual(JSON.parse(writes[0][2]).tokens, [{ provider: 'openai', model: 'gpt-test', effort: 'effort unknown', effortSources: ['unknown'], freshInputTokens: 'unknown', cacheReadTokens: 'unknown', cacheWriteTokens: 'unknown', outputTokens: 'unknown', thinkingTokens: 'unknown' }]);
  assert.ok(lines.includes('issue-cost-capture event=captured issue=163'));
});

test('labels the current Factory mode default when a saved effort is absent', async () => {
  const writes = [];
  await captureFinishedFactoryCards({
    projectId: 'project', projects: { listAll: async () => [{ id: 'project', orgId: 'org' }] },
    workItems: { list: async () => [{ title: 'Default effort', stages: ['done'], externalSource: { externalId: 'github-issue:164' }, sessions: { work: { sessionId: 'session-164', threadId: 'thread-164', mode: 'build' } } }] },
    observability: { listTraces: async () => ({ pagination: { hasMore: false }, spans: [{ sessionId: 'session-164', attributes: { costContext: { provider: 'openai', model: 'gpt-test' }, usage: { inputTokens: 1, outputTokens: 1, inputTokenDetails: { cacheRead: 0, cacheWrite: 0 }, outputTokenDetails: { reasoning: 0 } } } }] }) },
    currentModeDefault: (mode) => mode === 'build' ? 'high' : undefined,
    database: { any: async () => [], one: async (_sql, values) => { writes.push(values); return { record: values[1] }; } },
  });
  const [token] = JSON.parse(writes[0][2]).tokens;
  assert.equal(token.effort, 'high');
  assert.deepEqual(token.effortSources, ['current-default (may differ from run time)']);
});

test('marks a finished card with no session reference as no-sessions-on-card', async () => {
  const writes = [];
  await captureFinishedFactoryCards({
    projectId: 'project', projects: { listAll: async () => [{ id: 'project', orgId: 'org' }] },
    workItems: { list: async () => [{ title: 'No session', stages: ['done'], externalSource: { externalId: 'github-issue:230' } }] },
    observability: { listTraces: async () => { throw new Error('must not list traces without a session'); } },
    database: { any: async () => [], one: async (_sql, values) => { writes.push(values); return { record: values[1] }; } },
  });
  assert.equal(JSON.parse(writes[0][2]).source.sessionStatus, 'no-sessions-on-card');
});

test('logs the session and page when a later trace page fails', async () => {
  const lines = [];
  await captureFinishedFactoryCards({
    projectId: 'project', projects: { listAll: async () => [{ id: 'project', orgId: 'org' }] },
    workItems: { list: async () => [{ title: 'Trace failure', stages: ['done'], externalSource: { externalId: 'github-issue:163' }, sessions: { work: { sessionId: 'session-163', threadId: 'thread-163' } } }] },
    observability: { listTraces: async ({ pagination }) => pagination.page === 0 ? { spans: [], pagination: { hasMore: true } } : Promise.reject(new Error('store unavailable')) },
    database: { any: async () => [], one: async () => ({ record: {} }) }, log: (line) => lines.push(line),
  });
  assert.ok(lines.some((line) => line.includes('trace read failed: session session-163 page 1: store unavailable')));
});


test('a card capture failure is logged and never prevents the retention prune', async () => {
  const lines = [];
  const target = { prune: async () => [{ domain: 'observability', table: 'spans', deleted: 1, done: true }] };
  setObservabilityPruneTarget(target);
  const output = await runObservabilityPrune({
    capture: async () => { throw new Error('trace read failed'); },
    log: (line) => lines.push(line),
  });

  assert.equal(output.pruned[0].deleted, 1);
  assert.ok(lines.some((line) => line.includes('issue-cost-capture event=failed issue=unknown error=trace read failed')));
});

test('the DuckDB observability config carries the supported retention and the code-sdk path', () => {
  const config = duckdbObservabilityConfig();

  assert.equal(config.id, 'factory-observability');
  // DEFAULT_RETENTION keeps observability.spans for 14 days; that is the value
  // the installed @mastra/duckdb adapter applies when prune() runs.
  assert.deepEqual(duckdbObservabilityRetention().observability, {
    spans: { maxAge: '14d' },
    logs: { maxAge: '14d' },
  });
  assert.equal(config.retention.observability.spans.maxAge, '14d');
  // The path is the same one @mastra/code-sdk writes, so app and prune agree.
  assert.match(config.path, /observability\.duckdb$/);
});

test('MASTRA_OBSERVABILITY_DB_PATH overrides the DuckDB path without a second copy', () => {
  assert.equal(
    observabilityDuckDBPath({ MASTRA_OBSERVABILITY_DB_PATH: '/tmp/custom-observability.duckdb' }),
    '/tmp/custom-observability.duckdb',
  );
});

test('the daily prune calls the real store once and reports each table', async () => {
  const calls = [];
  const target = {
    prune: async (options) => {
      calls.push(options);
      return [
        { domain: 'observability', table: 'span_events', deleted: 12, done: true },
        { domain: 'observability', table: 'log_events', deleted: 0, done: false },
      ];
    },
  };
  const lines = [];

  const results = await pruneObservabilityRetention({ target, log: (line) => lines.push(line) });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], DEFAULT_PRUNE_OPTIONS);
  assert.equal(results.length, 2);
  assert.ok(lines.some((line) => line.includes('span_events deleted=12 done=true')));
  assert.ok(lines.some((line) => line.includes('1 table(s) still draining')));
});

test('the prune is bounded so a large backlog drains over several runs', () => {
  assert.equal(DEFAULT_PRUNE_OPTIONS.maxRows, 100_000);
  assert.equal(DEFAULT_PRUNE_OPTIONS.pauseMs, 25);
});

test('a missing prune target fails closed instead of reporting a prune that did not run', async () => {
  await assert.rejects(() => pruneObservabilityRetention({ target: null }), /not configured/i);
});

test('the scheduled step prunes through the configured target', async () => {
  const target = {
    prune: async () => [{ domain: 'observability', table: 'span_events', deleted: 5, done: true }],
  };
  setObservabilityPruneTarget(target);

  const output = await runObservabilityPrune({ log: () => {} });

  assert.equal(output.pruned.length, 1);
  assert.equal(output.pruned[0].deleted, 5);
});

test('the workflow declares a daily cron so the prune runs on a framework schedule', () => {
  assert.equal(OBSERVABILITY_PRUNE_CRON, '0 4 * * *');
  assert.equal(observabilityRetentionWorkflow.id, 'observability-retention');
  // Mastra reads the declarative schedule through getScheduleConfigs(); this is
  // the same accessor its scheduler uses to register the daily fire.
  assert.deepEqual(observabilityRetentionWorkflow.getScheduleConfigs(), [{ cron: '0 4 * * *' }]);
});

test('the over-budget guard applies a tighter supported retention, then CHECKPOINT', async () => {
  const calls = { prune: [], checkpoint: 0 };
  const target = {
    prune: async (options) => {
      calls.prune.push(options);
      return [{ domain: 'observability', table: 'span_events', deleted: 9, done: true }];
    },
    checkpoint: async () => { calls.checkpoint += 1; },
  };
  // First measure is over budget; the checkpointed re-measure is under budget,
  // so the guard reports the reclaim instead of a real DuckDB file.
  const sizes = [8 * 1024 * 1024 * 1024, 4 * 1024 * 1024 * 1024];
  let measure = 0;

  const result = await runObservabilityRetention({
    target,
    budgetBytes: 5 * 1024 * 1024 * 1024,
    measureBytes: () => sizes[Math.min(measure++, sizes.length - 1)],
    measureFree: () => 30 * 1024 * 1024 * 1024,
    log: () => {},
  });

  assert.equal(result.action, 'emergency-prune');
  assert.equal(result.bytesBefore, 8 * 1024 * 1024 * 1024);
  assert.equal(result.bytesAfter, 4 * 1024 * 1024 * 1024);
  assert.equal(calls.prune.length, 1);
  assert.deepEqual(calls.prune[0].retention, EMERGENCY_RETENTION);
  assert.equal(calls.checkpoint, 1);
});

test('the guard fails closed when the store is still over budget after the emergency prune', async () => {
  const target = {
    prune: async () => [{ domain: 'observability', table: 'span_events', deleted: 1, done: true }],
    checkpoint: async () => {},
  };

  await assert.rejects(
    () => runObservabilityRetention({
      target,
      budgetBytes: 5 * 1024 * 1024 * 1024,
      measureBytes: () => 8 * 1024 * 1024 * 1024,
      measureFree: () => 30 * 1024 * 1024 * 1024,
      log: () => {},
    }),
    /still over budget/i,
  );
});

test('the guard fails closed before touching the store when free disk is too low', async () => {
  const calls = { prune: 0, checkpoint: 0 };
  const target = {
    prune: async () => { calls.prune += 1; return []; },
    checkpoint: async () => { calls.checkpoint += 1; },
  };

  await assert.rejects(
    () => runObservabilityRetention({
      target,
      budgetBytes: 5 * 1024 * 1024 * 1024,
      measureBytes: () => 8 * 1024 * 1024 * 1024,
      measureFree: () => 128 * 1024 * 1024,
      log: () => {},
    }),
    /free disk|disk/i,
  );

  // Nothing was pruned or checkpointed, so the disk cannot be pushed over the edge.
  assert.equal(calls.prune, 0);
  assert.equal(calls.checkpoint, 0);
});

test('the guard fails closed when an unknown free-space reading would be assumed safe', async () => {
  const target = { prune: async () => [] };

  await assert.rejects(
    () => runObservabilityRetention({
      target,
      budgetBytes: 5 * 1024 * 1024 * 1024,
      measureBytes: () => 6 * 1024 * 1024 * 1024,
      measureFree: () => null,
      log: () => {},
    }),
    /free disk|disk|unknown/i,
  );
});

test('the emergency retention window is the tightened 1d policy', () => {
  assert.equal(EMERGENCY_TRACE_RETENTION_DAYS, 1);
  assert.deepEqual(EMERGENCY_RETENTION.observability?.spans, { maxAge: '1d' });
  assert.deepEqual(EMERGENCY_RETENTION.observability?.logs, { maxAge: '1d' });
});

test('requiredFreeBytes keeps the documented 1.2x + 256 MB headroom', () => {
  assert.equal(requiredFreeBytes(0), 256 * 1024 * 1024);
  assert.equal(OBSERVABILITY_SIZE_BUDGET_BYTES, 5 * 1024 * 1024 * 1024);
});
