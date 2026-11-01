// Mastra writes what a run did to its own DuckDB trace file. This reads that
// file back after the run has stopped writing to it, so the determination can
// quote the commands a Shipping agent really ran instead of what anyone says
// it ran.

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
  'error',
].join(', ');

function plain(rows) {
  return rows.map(row =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])
    )
  );
}

export async function readSpans(traceFile, { attempts = 10, waitMs = 500 } = {}) {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const instance = await DuckDBInstance.create(traceFile, { access_mode: 'READ_ONLY' });
      const connection = await instance.connect();
      const result = await connection.runAndReadAll(`select ${COLUMNS} from span_events order by timestamp`);
      const spans = plain(result.getRowObjectsJS());
      connection.closeSync?.();
      instance.closeSync?.();
      return spans;
    } catch (error) {
      lastError = error;
      if (!/lock/i.test(String(error?.message))) throw error;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

export function workflowRun(spans, workflowId) {
  const span = spans.find(
    item => item.spanType === 'workflow_run' && item.eventType === 'start' && String(item.name ?? '').includes(`'${workflowId}'`)
  ) ?? spans.find(item => item.spanType === 'workflow_run' && item.eventType === 'start');
  return span ? { runId: span.runId, startedAt: span.timestamp, name: span.name } : null;
}
