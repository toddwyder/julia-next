import assert from 'node:assert/strict';
import test from 'node:test';
import {
  duckdbObservabilityConfig,
  duckdbObservabilityRetention,
  observabilityDuckDBPath,
} from './src/mastra/observability-store.ts';
import {
  DEFAULT_PRUNE_OPTIONS,
  OBSERVABILITY_PRUNE_CRON,
  observabilityRetentionWorkflow,
  pruneObservabilityRetention,
  runObservabilityPrune,
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
