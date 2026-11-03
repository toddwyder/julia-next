// What each stage of a run cost, read back from that stage's own trace files.
//
// A stage is its own process (see stages.mjs: only one process may hold the
// observability database), and Mastra writes what a process did into the DuckDB
// file that process was given. So the parent gives every stage a folder of its
// own, `JULIA_TRACES_DIR`, and reads the files that stage left there when it
// exits. Nothing is carried between processes, and no stage can overwrite
// another stage's numbers.
//
// The parent's own trace file is never inherited: the parent holds that file
// open, so a child that wrote to it would be locked out and (Mastra being
// silent about that) would record nothing at all.

import { readdirSync } from 'node:fs';
import path from 'node:path';

const INPUT = 'mastra_model_total_input_tokens';
const OUTPUT = 'mastra_model_total_output_tokens';
const CACHE_READ = 'mastra_model_input_cache_read_tokens';
const DURATION = 'mastra_model_duration_ms';

export function stageTraceFolder(runDir, stage) {
  return path.join(runDir, 'traces', stage);
}

// The parent's observability path is removed on purpose. A stage that inherits
// it writes into a file another process holds, and Mastra records nothing
// rather than failing, which is the empty-trace fault this module reports.
export function stageEnvironment(env, folder) {
  const next = { ...env, JULIA_TRACES_DIR: folder };
  delete next.MASTRA_OBSERVABILITY_DB_PATH;
  delete next.MASTRA_DB_PATH;
  return next;
}

export function traceFiles(folder) {
  try {
    return readdirSync(folder).filter(name => name.endsWith('.duckdb')).sort().map(name => path.join(folder, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const plain = rows => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])));

async function readFile(file) {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' });
  const connection = await instance.connect();
  try {
    const metrics = await connection.runAndReadAll(
      `select name, sum(value) as total, count(*) as calls, any_value(model) as model, sum(estimatedCost) as cost
         from metric_events
        where name like 'mastra_model_%'
        group by name`
    );
    const models = await connection.runAndReadAll(
      "select distinct model from metric_events where name like 'mastra_model_%' and model is not null"
    );
    return {
      metrics: plain(metrics.getRowObjectsJS()),
      models: plain(models.getRowObjectsJS()).map(row => String(row.model)),
    };
  } finally {
    connection.closeSync?.();
    instance.closeSync?.();
  }
}

// A stage that found no trace file at all reports that too: the difference
// between "free" and "nobody wrote this down" is the whole point of the flag.
export async function readStageUsage(files) {
  const usage = { files, modelCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, models: [], readError: '' };
  for (const file of files) {
    let read;
    try {
      read = await readFile(file);
    } catch (error) {
      usage.readError = `${path.basename(file)} could not be read (${error.message})`;
      continue;
    }
    for (const row of read.metrics) {
      const value = Number(row.total) || 0;
      if (row.name === INPUT) usage.inputTokens += value;
      if (row.name === OUTPUT) usage.outputTokens += value;
      if (row.name === CACHE_READ) usage.cacheReadTokens += value;
      if (row.name === DURATION) usage.modelCalls += Number(row.calls) || 0;
      usage.costUsd += Number(row.cost) || 0;
    }
    for (const model of read.models) if (!usage.models.includes(model)) usage.models.push(model);
  }
  usage.modelCalls = usage.modelCalls || 0;
  usage.empty = files.length === 0 || (usage.modelCalls === 0 && usage.inputTokens === 0 && usage.outputTokens === 0);
  return usage;
}

// A free model reports no cost. `:free` is how the CommandCode provider names
// one (deviation row 13 in docs/pstack-deviations.md), so every model a stage
// used ending in `:free` is the only case that may say "free model".
export function isFreeModel(model) {
  return /:free$/i.test(String(model ?? ''));
}

export function money(value) {
  const amount = Number(value) || 0;
  return amount === 0 ? '$0' : `$${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
}

// What a page says about a stage's usage. Null when the stage said nothing, so
// the page shows nothing rather than a zero it cannot defend.
export function describeUsage(usage) {
  if (!usage) return null;
  if (usage.empty) {
    return {
      empty: true,
      label: usage.files.length === 0 ? 'no trace file: this stage recorded nothing' : 'no model rows in the trace file this stage left',
    };
  }
  const free = usage.models.length > 0 && usage.models.every(isFreeModel);
  return {
    empty: false,
    modelCalls: usage.modelCalls,
    tokensIn: usage.inputTokens,
    tokensOut: usage.outputTokens,
    costUsd: usage.costUsd,
    costLabel: usage.costUsd > 0 ? money(usage.costUsd) : free ? 'free model' : 'cost unknown',
    models: usage.models,
    label: [
      `${usage.modelCalls} model ${usage.modelCalls === 1 ? 'call' : 'calls'}`,
      `${usage.inputTokens} in / ${usage.outputTokens} out`,
      usage.costUsd > 0 ? money(usage.costUsd) : free ? 'free model' : 'cost unknown',
    ].join(' · '),
  };
}
