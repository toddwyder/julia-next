import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const [dir, destination] = process.argv.slice(2);
if (!dir || !destination) throw Error('Supply artifact directory and output file');
const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
const ledger = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => {
  const {event, owner, total, priced, cost, finishReason, usage} = JSON.parse(line);
  return {event, owner, total, priced, cost, finishReason, ...(usage && {usage: (({inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens, cacheCreationInputTokens5m, cacheCreationInputTokens1h}) => ({inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens, cacheCreationInputTokens5m, cacheCreationInputTokens1h}))(usage)})};
});
const db = await DuckDBInstance.create(join(dir, 'trace.duckdb'), {access_mode:'READ_ONLY'});
const conn = await db.connect();
try {
 const spans=(await conn.runAndReadAll("select distinct traceId,spanId,parentSpanId,spanType,entityId,name,model,provider,outcome,stopReason,eventType,timestamp,endedAt from span_events where spanType in ('agent_run','model_generation','tool_call')")).getRowObjectsJS();
 const metrics=(await conn.runAndReadAll("select traceId,spanId,name,value,estimatedCost,costUnit from metric_events where name like '%tokens%'")).getRowObjectsJS();
 writeFileSync(destination, JSON.stringify({run,ledger,spans,metrics},null,2)+'\n');
} finally {conn.closeSync();db.closeSync()}
