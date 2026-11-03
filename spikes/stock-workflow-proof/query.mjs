#!/usr/bin/env node
// Every trace answer in FINDINGS.md comes from one of these queries. Run this
// against the trace file the findings name and compare the output.
//
//   node spikes/stock-workflow-proof/query.mjs <trace file>
//
// Mastra writes each span's start row twice: once with the span's attributes,
// once with the string "null" in that column. Filtering on
// `attributes <> 'null'` (Q0 shows the doubling) keeps one row per span.
// Without it every count and sum comes out doubled.

import { DuckDBInstance } from '@duckdb/node-api';

const file = process.argv[2];
if (!file) {
  console.error('usage: node spikes/stock-workflow-proof/query.mjs <trace file>');
  process.exit(1);
}

const instance = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' });
const connection = await instance.connect();

const show = async (title, sql) => {
  const rows = (await connection.runAndReadAll(sql)).getRowObjectsJS();
  console.log(`\n## ${title}\n${sql.trim()}`);
  for (const row of rows) console.log(JSON.stringify(row, (_, value) => (typeof value === 'bigint' ? Number(value) : value)));
  return rows;
};

await show(
  'Q0. Mastra writes each start row twice, so queries dedupe on attributes',
  `select spanType, count(*) as n_rows, count(distinct spanId) as n_spans
     from span_events where eventType = 'start' group by 1 order by n_spans desc`
);

await show(
  'Q1a. The workflow run span and its own trace id',
  `select distinct spanType, name, spanId, parentSpanId, traceId, runId
     from span_events
    where spanType = 'workflow_run' and eventType = 'start' and attributes is not null and attributes <> 'null'`
);

await show(
  'Q1b. The agent run span and its own trace id',
  `select distinct spanType, name, spanId, parentSpanId, traceId, runId
     from span_events
    where spanType = 'agent_run' and eventType = 'start' and attributes is not null and attributes <> 'null'`
);

await show(
  'Q1c. Every span that hangs off the workflow run span',
  `select distinct spanType, name, parentSpanId
     from span_events
    where parentSpanId in (select spanId from span_events where spanType = 'workflow_run')
      and eventType = 'start' and attributes is not null and attributes <> 'null'`
);

await show(
  'Q1d. The parent chain above a model call, top of the chain first',
  `with recursive chain(spanId, parentSpanId, spanType, name, depth) as (
     select distinct spanId, parentSpanId, spanType, name, 0
       from span_events
      where spanType = 'model_inference' and eventType = 'start' and attributes is not null and attributes <> 'null'
     union all
     select s.spanId, s.parentSpanId, s.spanType, s.name, c.depth + 1
       from span_events s join chain c on s.spanId = c.parentSpanId
      where c.depth < 6
   )
   select depth, spanType, name, count(*) as spans from chain group by 1, 2, 3 order by depth desc`
);

await show(
  'Q1e. Does any row carry the workflow run id, which would tie the two traces together?',
  `select spanType, name, eventType, count(*) as rows
     from span_events
    where input like '%' || (select runId from span_events where spanType = 'workflow_run' limit 1) || '%'
       or attributes like '%' || (select runId from span_events where spanType = 'workflow_run' limit 1) || '%'
       or output like '%' || (select runId from span_events where spanType = 'workflow_run' limit 1) || '%'
    group by 1, 2, 3`
);

await show(
  'Q2a. Token counts on each model call, from attributes.usage',
  `select json_extract_string(attributes, '$.model') as model,
          count(*) as calls,
          sum(cast(json_extract(attributes, '$.usage.inputTokens') as bigint)) as input_tokens,
          sum(cast(json_extract(attributes, '$.usage.outputTokens') as bigint)) as output_tokens,
          sum(cast(json_extract(attributes, '$.usage.inputDetails.cacheRead') as bigint)) as cache_read_tokens
     from span_events
    where spanType = 'model_inference' and eventType = 'end' and attributes is not null and attributes <> 'null'
    group by 1`
);

await show(
  'Q2b. Mastra token metrics and its own cost estimate',
  `select name, sum(value) as value, sum(estimatedCost) as estimated_cost, costUnit
     from metric_events where name like 'mastra_model_%'
    group by 1, 4 order by 1`
);

await show(
  'Q3a. Tool calls that read the poteto-mode skill',
  `select distinct name, json_extract_string(input, '$.path') as path,
          cast(json_extract(input, '$.offset') as integer) as offset_from_top
     from span_events
    where spanType = 'tool_call' and eventType = 'start' and attributes is not null and attributes <> 'null'
      and input like '%poteto-mode/SKILL.md%' and input <> 'null'
    order by offset_from_top`
);

await show(
  'Q3b. Every tool the agent called, with the input it was given',
  `select distinct name, input
     from span_events
    where spanType = 'tool_call' and eventType = 'start' and input is not null and input <> 'null'
    order by name, input`
);

await show(
  'Q4a. Trace ids written to the file',
  `select traceId, count(*) as spans, min(timestamp) as first_span from span_events group by 1 order by first_span`
);

await show(
  'Q4b. What span types the file holds',
  `select spanType, count(*) as spans from span_events where eventType = 'start' and attributes is not null and attributes <> 'null' group by 1 order by spans desc`
);

await show(
  'Q5. What the workflow answered and whether it finished',
  `select name, eventType, output
     from span_events
    where spanType = 'workflow_run' and eventType = 'end'`
);

connection.closeSync();
instance.closeSync();
