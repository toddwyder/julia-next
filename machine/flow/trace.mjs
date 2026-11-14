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
  'input',
  'output',
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

function parseJson(value, fallback = value) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeSpan(span) {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId ?? null,
    spanType: span.spanType,
    name: span.name,
    timestamp: span.timestamp ?? span.startedAt ?? null,
    endedAt: span.endedAt ?? null,
    input: parseJson(span.input, span.input ?? null),
    output: parseJson(span.output, span.output ?? null),
    attributes: parseJson(span.attributes, {}),
  };
}

const byTime = (a, b) => (a.timestamp && b.timestamp ? new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() : 0);

function scopeToFlowBuild(spans) {
  const ordered = [...spans].sort(byTime);
  const byType = (type) => ordered.filter(s => s.spanType === type && String(s.name ?? '').includes('flow-build'));
  const candidates = byType('workflow_step');
  const pool = candidates.length > 0 ? candidates : byType('agent_run');
  if (pool.length === 0) return ordered;
  const root = pool.at(-1);
  const childrenByParent = new Map();
  for (const span of ordered) {
    const list = childrenByParent.get(span.parentSpanId) ?? [];
    list.push(span);
    childrenByParent.set(span.parentSpanId, list);
  }
  const keep = new Set([root.spanId]);
  const queue = [root.spanId];
  while (queue.length > 0) {
    const id = queue.shift();
    for (const child of childrenByParent.get(id) ?? []) {
      if (!keep.has(child.spanId)) {
        keep.add(child.spanId);
        queue.push(child.spanId);
      }
    }
  }
  return ordered.filter(span => keep.has(span.spanId));
}

export async function buildSpans({ mastra, traceId, traceFile, spans } = {}) {
  let raw = [];
  if (spans) {
    raw = mergedSpans(spans);
  } else if (mastra && traceId) {
    const obs = await mastra.getStorage()?.getStore('observability');
    const trace = await obs?.getTrace({ traceId });
    raw = mergedSpans(Array.isArray(trace) ? trace : (trace?.spans ?? []));
  } else if (traceFile) {
    raw = mergedSpans(await readSpans(traceFile));
  }
  return scopeToFlowBuild(raw.map(normalizeSpan));
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
