#!/usr/bin/env node
// JUL-329 proof: does a workflow step's agent work land in that step's trace
// tree? The stock subagent tool passes `context.tracingContext` to the agent it
// starts, so a step that hands it the span the workflow already opened should
// put the agent's spans under the workflow run instead of beside it.
//
//   node spikes/stock-workflow-proof/trace-tree.mjs
//
// The trace path and the harness state database are set before any Mastra module
// is loaded, the way machine/shipping/run.mjs does it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const runDir = path.join(repoRoot, '.artifacts', 'stock-workflow-proof');

const TIME_LIMIT_MS = 10 * 60_000;
const WORKFLOW_ID = 'stock-workflow-trace-tree';
const MODEL = 'commandcode/reflection/beam:free';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const traceFile = path.join(runDir, `trace-tree-${stamp}.duckdb`);
const stateFile = path.join(runDir, `state-tree-${stamp}.db`);

process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFile;
process.env.MASTRA_DB_PATH = stateFile;
process.env.MASTRACODE_PROGRAM_DIR ||= path.join(process.env.HOME ?? '', '.local', 'lib', 'mastracode-program');

const log = message => console.log(`[${new Date().toISOString()}] ${message}`);

const TASK = [
  'You are a proof agent. Do this and nothing else.',
  '',
  'Answer with exactly one word: ok',
].join('\n');

async function readSpans() {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(traceFile, { access_mode: 'READ_ONLY' });
  try {
    const connection = await instance.connect();
    const spans = await connection.runAndReadAll(
      "select spanType, name, traceId, spanId, parentSpanId from span_events where eventType = 'start' and attributes <> 'null' order by timestamp"
    );
    const threads = await connection.runAndReadAll(
      "select distinct threadId, model from metric_events where name like 'mastra_model_%'"
    );
    connection.closeSync();
    return { spans: spans.getRowObjectsJS(), threads: threads.getRowObjectsJS() };
  } finally {
    instance.closeSync();
  }
}

async function main() {
  const { bootHarness, loadMastra, stopHarness } = await import('../../machine/shipping/harness.mjs');
  const { initContextStorage, getCurrentSpan } = await import(
    path.join(process.env.MASTRACODE_PROGRAM_DIR, 'node_modules', '@mastra', 'core', 'dist', 'observability', 'context-storage.js')
  );
  initContextStorage();

  log(`Trace file: ${traceFile}`);
  const { z, createWorkflow, createStep } = await loadMastra();
  const { booted, session, mastra, requestContext, subagent } = await bootHarness({ cwd: repoRoot });

  const inputSchema = z.object({ task: z.string() });
  const outputSchema = z.object({ answer: z.string(), hadSpan: z.boolean() });

  const review = createStep({
    id: 'review',
    inputSchema,
    outputSchema,
    execute: async ({ inputData }) => {
      const currentSpan = getCurrentSpan();
      log(`The step's own span: ${currentSpan ? currentSpan.spanId ?? '(no spanId)' : 'none'}`);
      const result = await subagent.execute(
        { agentType: 'execute', task: inputData.task, modelId: MODEL },
        {
          workspace: session.getWorkspace(),
          requestContext,
          mastra,
          ...(currentSpan ? { tracingContext: { currentSpan } } : {}),
        }
      );
      const answer = String(result?.content ?? '');
      log(`The subagent answered: ${answer.split(/\r?\n/)[0]}`);
      return { answer, hadSpan: Boolean(currentSpan) };
    },
  });

  const workflow = createWorkflow({ id: WORKFLOW_ID, inputSchema, outputSchema }).then(review).commit();
  mastra.addWorkflow(workflow);
  const run = await workflow.createRun();

  let timer = null;
  let outcome = null;
  try {
    const limit = new Promise(resolve => {
      timer = setTimeout(() => resolve({ timedOut: true }), TIME_LIMIT_MS);
      timer.unref?.();
    });
    const raced = await Promise.race([run.start({ inputData: { task: TASK } }).then(value => ({ value })), limit]);
    outcome = raced.value ?? null;
  } finally {
    clearTimeout(timer);
  }
  log(`Run ended with status ${outcome?.status ?? 'timeout'}.`);

  await stopHarness(booted);
  const { spans, threads } = await readSpans();

  const byTrace = new Map();
  for (const span of spans) {
    const list = byTrace.get(span.traceId) ?? [];
    list.push(span);
    byTrace.set(span.traceId, list);
  }
  log(`The trace holds ${spans.length} spans in ${byTrace.size} trace(s).`);
  for (const [traceId, list] of byTrace) {
    log(`trace ${traceId}: ${list.length} spans`);
    for (const span of list.filter(item => ['workflow_run', 'workflow_step', 'agent_run', 'model_generation'].includes(item.spanType))) {
      log(`  ${span.spanType} ${span.name} span=${span.spanId} parent=${span.parentSpanId ?? 'none'}`);
    }
  }
  log(`Model metric threads: ${JSON.stringify(threads)}`);

  const modelThreads = threads.map(row => row.threadId);
  const record = {
    workflowId: WORKFLOW_ID,
    traceFile,
    status: outcome?.status ?? 'timeout',
    answer: outcome?.result?.answer ?? null,
    traces: [...byTrace.entries()].map(([traceId, list]) => ({
      traceId,
      spans: list.map(span => ({ spanType: span.spanType, name: span.name, spanId: span.spanId, parentSpanId: span.parentSpanId })),
    })),
    modelThreads,
  };
  fs.writeFileSync(path.join(runDir, `trace-tree-${stamp}.json`), `${JSON.stringify(record, null, 2)}\n`);
  log(`Wrote ${path.join(runDir, `trace-tree-${stamp}.json`)}.`);
}

main().catch(error => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
