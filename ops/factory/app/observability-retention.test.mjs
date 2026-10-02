import assert from 'node:assert/strict';
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
  assert.equal(config.memoryLimit, '4GB');
  assert.equal(duckdbObservabilityConfig({ MASTRA_DUCKDB_MEMORY_LIMIT: '3GB' }).memoryLimit, '3GB');
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
