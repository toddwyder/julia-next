// #211 local capture route: WorkOS protects Factory's HTTP reads, so the
// operator reads the same server-owned stores without sending credentials.
import { runPsql } from './run-psql.mjs';

const TRACE_DATABASE = '/var/lib/julia-factory/.local/share/mastracode/observability.duckdb';

function object(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { throw new Error(`Local trace ${field} was not valid JSON`); }
}

async function queryDuckdb({ sql, parameters, databasePath = TRACE_DATABASE }) {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(databasePath, { access_mode: 'READ_ONLY' });
  const connection = await instance.connect();
  try { return (await connection.runAndReadAll(sql, parameters)).getRowObjects(); }
  finally { connection.closeSync(); instance.closeSync(); }
}

// Mirrors Mastra's append-only `span_events` reconstruction: retain the last
// non-null value for each field and the first start event as the start time.
const TRACE_SQL = `SELECT traceId, spanId,
  arg_max(sessionId, timestamp) FILTER (WHERE sessionId IS NOT NULL) AS sessionId,
  arg_max(name, timestamp) FILTER (WHERE name IS NOT NULL) AS name,
  arg_max(spanType, timestamp) FILTER (WHERE spanType IS NOT NULL) AS spanType,
  coalesce(min(timestamp) FILTER (WHERE eventType = 'start'), min(timestamp)) AS startedAt,
  arg_max(endedAt, timestamp) FILTER (WHERE endedAt IS NOT NULL) AS endedAt,
  arg_max(attributes, timestamp) FILTER (WHERE attributes IS NOT NULL) AS attributes,
  arg_max(metadata, timestamp) FILTER (WHERE metadata IS NOT NULL) AS metadata,
  arg_max(scope, timestamp) FILTER (WHERE scope IS NOT NULL) AS scope,
  arg_max(error, timestamp) FILTER (WHERE error IS NOT NULL) AS error
FROM span_events WHERE timestamp >= ? AND timestamp < ? GROUP BY traceId, spanId`;

export async function readLocalTraceSpans({ from, to, runQuery = queryDuckdb }) {
  const rows = await runQuery({ sql: TRACE_SQL, parameters: [from, to] });
  if (!Array.isArray(rows)) throw new Error('Local trace reader returned an unsupported row set');
  return rows.map((row) => ({ ...row, attributes: object(row.attributes, 'attributes') ?? {}, metadata: object(row.metadata, 'metadata'), scope: object(row.scope, 'scope'), error: object(row.error, 'error') }));
}

export async function readLocalSessionMessages({ threadId, runPsql: executePsql = runPsql, database = 'julia_factory_trial' }) {
  if (!threadId) throw new Error('Local message read requires a thread id');
  const result = await executePsql({
    args: ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', `thread_id=${threadId}`, '-d', database, '-c', "BEGIN TRANSACTION READ ONLY; SELECT jsonb_build_object('content', content::jsonb)::text FROM mastra_messages WHERE thread_id = :'thread_id' ORDER BY \"createdAtZ\", id; COMMIT;"],
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
  });
  if ((result?.status ?? 0) !== 0) throw new Error(`Could not read Factory session messages: ${(result?.stderr ?? '').trim()}`);
  return String(result.stdout ?? '').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { throw new Error('Local message reader returned invalid JSON'); }
  });
}
