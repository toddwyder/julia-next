// What each stage spent, read back from the trace files that stage left behind
// (JUL-331). A free model reports no cost, so "free model" is only ever said
// when every model the stage used is one the provider names free; anything else
// that reports no cost is "cost unknown", never a zero.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { describeUsage, isFreeModel, money, readStageUsage, stageEnvironment, stageTraceFolder, traceFiles } from './usage.mjs';

async function traceFile(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-usage-'));
  const file = path.join(dir, 'stage.duckdb');
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  await connection.run(`create table metric_events (name varchar, value double, provider varchar, model varchar, estimatedCost double, threadId varchar)`);
  for (const row of rows) {
    await connection.run(
      `insert into metric_events values ('${row.name}', ${row.value}, '${row.provider ?? 'commandcode.chat'}', '${row.model ?? 'reflection/beam:free'}', ${row.cost ?? 'null'}, null)`
    );
  }
  connection.closeSync?.();
  instance.closeSync?.();
  return file;
}

test('a stage in its own folder keeps its trace files, and never inherits the parent’s', () => {
  const folder = stageTraceFolder('/run/dir', 'build');
  assert.equal(folder, path.join('/run/dir', 'traces', 'build'));
  const env = stageEnvironment({ MASTRA_OBSERVABILITY_DB_PATH: '/parent.duckdb', MASTRA_DB_PATH: '/parent.db', KEEP: 'yes' }, folder);
  assert.equal(env.JULIA_TRACES_DIR, folder);
  assert.equal(env.MASTRA_OBSERVABILITY_DB_PATH, undefined);
  assert.equal(env.MASTRA_DB_PATH, undefined);
  assert.equal(env.KEEP, 'yes');
});

test('the trace files a stage left are found, and a folder nobody wrote to is empty', async () => {
  const file = await traceFile([{ name: 'mastra_model_total_input_tokens', value: 10 }]);
  assert.deepEqual(traceFiles(path.dirname(file)), [file]);
  assert.deepEqual(traceFiles(path.join(path.dirname(file), 'missing')), []);
});

test('the tokens and calls a stage used are summed across every trace file it left', async () => {
  const input = await traceFile([
    { name: 'mastra_model_total_input_tokens', value: 1200 },
    { name: 'mastra_model_total_input_tokens', value: 800 },
    { name: 'mastra_model_total_output_tokens', value: 40 },
    { name: 'mastra_model_input_cache_read_tokens', value: 900 },
    { name: 'mastra_model_duration_ms', value: 12, model: 'reflection/beam:free' },
  ]);
  const usage = await readStageUsage([input]);
  assert.equal(usage.inputTokens, 2000);
  assert.equal(usage.outputTokens, 40);
  assert.equal(usage.cacheReadTokens, 900);
  assert.equal(usage.costUsd, 0);
  assert.deepEqual(usage.models, ['reflection/beam:free']);
  assert.equal(usage.empty, false);
  assert.equal(usage.readError, '');
});

test('a stage that left no trace file at all says so instead of spending nothing', async () => {
  const usage = await readStageUsage([]);
  assert.equal(usage.empty, true);
  assert.equal(usage.files.length, 0);
  const described = describeUsage(usage);
  assert.equal(described.empty, true);
  assert.match(described.label, /no trace file/);

  const file = await traceFile([]);
  const empty = await readStageUsage([file]);
  assert.equal(empty.empty, true);
  assert.match(describeUsage(empty).label, /no model rows/);
});

test('a paid stage reports dollars, a free one says free model, and the rest say cost unknown', async () => {
  const paid = await readStageUsage([await traceFile([
    { name: 'mastra_model_total_input_tokens', value: 500, model: 'anthropic/claude-opus-5-5', cost: 0.42 },
    { name: 'mastra_model_total_output_tokens', value: 100, model: 'anthropic/claude-opus-5-5', cost: 0.08 },
    { name: 'mastra_model_duration_ms', value: 900, model: 'anthropic/claude-opus-5-5' },
  ])]);
  assert.equal(Number(paid.costUsd.toFixed(2)), 0.5);
  assert.equal(describeUsage(paid).costLabel, '$0.50');

  const free = await readStageUsage([await traceFile([
    { name: 'mastra_model_total_input_tokens', value: 500, model: 'reflection/beam:free' },
    { name: 'mastra_model_duration_ms', value: 900, model: 'reflection/beam:free' },
  ])]);
  assert.equal(describeUsage(free).costLabel, 'free model');

  const unpriced = await readStageUsage([await traceFile([
    { name: 'mastra_model_total_input_tokens', value: 500, model: 'someone/unpriced' },
    { name: 'mastra_model_duration_ms', value: 900, model: 'someone/unpriced' },
  ])]);
  assert.equal(describeUsage(unpriced).costLabel, 'cost unknown');
  assert.equal(describeUsage(unpriced).empty, false);
});

test('a stage that used a free model and a paid one is not called free', async () => {
  const mixed = await readStageUsage([await traceFile([
    { name: 'mastra_model_total_input_tokens', value: 100, model: 'reflection/beam:free' },
    { name: 'mastra_model_total_input_tokens', value: 100, model: 'someone/unpriced' },
  ])]);
  assert.deepEqual(mixed.models.sort(), ['reflection/beam:free', 'someone/unpriced']);
  assert.equal(describeUsage(mixed).costLabel, 'cost unknown');
});

test('free is a provider naming convention, and money never hides a real amount', () => {
  assert.equal(isFreeModel('reflection/beam:free'), true);
  assert.equal(isFreeModel('reflection/beam'), false);
  assert.equal(isFreeModel(null), false);
  assert.equal(money(0), '$0');
  assert.equal(money(0.0012), '$0.0012');
  assert.equal(money(1.5), '$1.50');
});
