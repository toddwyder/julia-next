import { DuckDBInstance } from '@duckdb/node-api';
import { performance } from 'node:perf_hooks';

export async function readRunTrace(file) {
  const start = performance.now();
  const db = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' });
  let connection;
  try {
    connection = await db.connect();
    const rows = async sql => (await connection.runAndReadAll(sql)).getRowObjectsJson();
    const metrics = await rows("select threadId, entityName, provider, model, name, value, estimatedCost from metric_events where name like 'mastra_model_%tokens'");
    const generations = await rows("select spanId, parentSpanId, threadId, name, entityName, attributes, errorPreview, timestamp, endedAt from span_events where spanType in ('model_generation', 'memory_operation')");
    const models = new Map();
    for (const metric of metrics) {
      const key = `${metric.provider}/${metric.model}`;
      const model = models.get(key) ?? { model: key, tokens: {}, usd: 0, unpriced: false, agents: [] };
      if (!model.agents.includes(metric.entityName)) model.agents.push(metric.entityName);
      model.tokens[metric.name] = (model.tokens[metric.name] ?? 0) + Number(metric.value);
      if (['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'].includes(metric.name)) {
        if (metric.estimatedCost == null) model.unpriced = true;
        else model.usd += Number(metric.estimatedCost);
      }
      models.set(key, model);
    }
    return { path: file, readMs: performance.now() - start, rowCount: metrics.length, models: [...models.values()], metrics, generations };
  } finally {
    connection?.closeSync();
    db.closeSync();
  }
}
