// The trace and the cost record. Mastra writes what a run did to its own
// DuckDB trace file, and this reads that file back after the run has stopped
// writing to it. A model call is counted once per inference span, and the
// stage it belongs to is the step span above it.

import { DuckDBInstance } from '@duckdb/node-api';

import { costFromMetrics, loadCatalog, readCorrections } from '../../dashboard/lib/model-prices.js';

const COLUMNS = [
  'eventType',
  'spanType',
  'name',
  'runId',
  'traceId',
  'spanId',
  'parentSpanId',
  'timestamp',
  'endedAt',
  'attributes',
].join(', ');

function plain(rows) {
  return rows.map(row =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]),
    ),
  );
}

async function query(traceFile, sql, { attempts = 10, waitMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const instance = await DuckDBInstance.create(traceFile, { access_mode: 'READ_ONLY' });
      const connection = await instance.connect();
      const result = await connection.runAndReadAll(sql);
      const rows = plain(result.getRowObjectsJS());
      connection.closeSync?.();
      instance.closeSync?.();
      return rows;
    } catch (error) {
      lastError = error;
      if (!/lock/i.test(String(error?.message))) throw error;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

export const readSpans = traceFile => query(traceFile, `select ${COLUMNS} from span_events order by timestamp`);

// Each span arrives as a start row and an end row, and a start row can arrive
// twice (one copy with attributes, one with none). Keep the end row when there
// is one, else the copy that carries attributes.
const RANK = row => (row.eventType === 'end' ? 3 : row.attributes ? 2 : 1);

export function mergedSpans(spans) {
  const best = new Map();
  for (const span of spans) {
    const kept = best.get(span.spanId);
    if (!kept || RANK(span) > RANK(kept)) best.set(span.spanId, span);
  }
  return [...best.values()];
}

export function stageOf(spansById, span) {
  let cursor = span;
  const seen = new Set();
  while (cursor && !seen.has(cursor.spanId)) {
    seen.add(cursor.spanId);
    if (cursor.spanType === 'workflow_step') {
      return String(cursor.name ?? '').replace(/^workflow step: '?|'?$/g, '') || 'unnamed stage';
    }
    cursor = cursor.parentSpanId ? spansById.get(cursor.parentSpanId) : undefined;
  }
  return 'unattributed';
}

function parseAttributes(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// One model call is one `model_inference` span. Mastra emits a token metric per
// agent run, not per call, so the per-stage numbers come from the spans' own
// usage and the stage is the workflow step the call sits under.
export function summarise(spanRows, metricRows = [], { catalog = null, corrections = {} } = {}) {
  const spans = mergedSpans(spanRows);
  const byId = new Map(spans.map(span => [span.spanId, span]));
  const inferences = spans.filter(span => span.spanType === 'model_inference');

  const stages = new Map();
  const bump = (stage, call) => {
    const row = stages.get(stage) ?? { stage, modelCalls: 0, inputTokens: 0, outputTokens: 0 };
    row.modelCalls += 1;
    row.inputTokens += call.inputTokens;
    row.outputTokens += call.outputTokens;
    stages.set(stage, row);
  };

  for (const span of inferences) {
    const usage = parseAttributes(span.attributes).usage ?? {};
    bump(stageOf(byId, span), {
      inputTokens: Number(usage.inputTokens ?? 0),
      outputTokens: Number(usage.outputTokens ?? 0),
    });
  }

  const perStage = [...stages.values()].sort((a, b) => a.stage.localeCompare(b.stage));
  for (const row of perStage) {
    row.share = inferences.length ? Number((row.modelCalls / inferences.length).toFixed(3)) : 0;
  }

  // The spending total is recomputed from token rows against the same price list the picker
  // uses. Mastra's own estimatedCost is left alone: it records the installed table's rate, which
  // is DeepSeek's off-peak price during peak hours.
  const cost = costFromMetrics(metricRows, { catalog, corrections });

  return {
    modelCalls: inferences.length,
    perStage,
    total: {
      modelCalls: inferences.length,
      inputTokens: perStage.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: perStage.reduce((sum, row) => sum + row.outputTokens, 0),
    },
    usd: cost.usd,
    costNote: cost.usd === null
      ? cost.unpriced.length
        ? `Unknown: the price list has no price for ${cost.unpriced.join(', ')}, so the run cost is not a number.`
        : 'Unknown: the trace holds no priced metric for this run.'
      : 'Priced from the same list the model picker uses.',
  };
}

export async function costRecord(traceFile) {
  const spans = await readSpans(traceFile);
  const metricRows = await query(
    traceFile,
    'select spanId, provider, model, timestamp, name, value from metric_events',
  ).catch(() => []);
  let catalog = null;
  let corrections = {};
  try {
    catalog = loadCatalog();
  } catch {
    // The run record still reports tokens; it just cannot put a price on them.
  }
  try {
    corrections = readCorrections();
  } catch {
    // A broken corrections file must not hide the run record.
  }
  return summarise(spans, metricRows, { catalog, corrections });
}
