#!/usr/bin/env node
// JUL-325 proof: can one stock Mastra workflow step run the same build agent the
// machine runs today, with the model calls, tokens and skill use all recorded in
// the run's own trace?
//
// Throwaway instrument. It answers one question and is deleted when the rebuild
// is decided. Nothing outside this folder changes.
//
//   node spikes/stock-workflow-proof/run.mjs
//
// The trace path and the harness state database are set before any Mastra module
// is loaded, the way machine/shipping/harness.mjs does it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir } from '../../scripts/scratch-dir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const runDir = path.join(scratchDir, 'stock-workflow-proof');

const TIME_LIMIT_MS = 10 * 60_000;
const COST_LIMIT_USD = 0.5;
const SCRATCH = path.join(runDir, 'scratch');
const WORKFLOW_ID = 'stock-workflow-proof';
const BUILD_MODEL = 'commandcode/reflection/beam:free';
const SKILL = '.agents/skills/poteto-mode/SKILL.md';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const traceFile = path.join(runDir, `trace-${stamp}.duckdb`);
const stateFile = path.join(runDir, `state-${stamp}.db`);

fs.mkdirSync(SCRATCH, { recursive: true });
fs.rmSync(path.join(SCRATCH, 'proof.txt'), { force: true });

process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFile;
process.env.MASTRA_DB_PATH = stateFile;

const log = message => console.log(`[${new Date().toISOString()}] ${message}`);

function task() {
  return [
    'You are a proof agent. Do this and nothing else.',
    '',
    `Read ${SKILL} first and follow it.`,
    '',
    `Then write the single line "stock workflow step ran the build agent" to ${path.join(SCRATCH, 'proof.txt')}.`,
    '',
    'Answer with one sentence saying what you wrote.',
  ].join('\n');
}

// The run ends itself: the clock ends it at ten minutes, and a watcher ends it
// when Mastra's own cost estimate for the run passes the cap. The free model
// prices at zero, so on this run the clock is the one that can fire.
async function watchCost({ readCost, onLimit, limitUsd = COST_LIMIT_USD }) {
  const timer = setInterval(async () => {
    try {
      const usd = await readCost();
      if (usd !== null && usd > limitUsd) {
        clearInterval(timer);
        log(`Mastra estimates $${usd.toFixed(4)} so far, over the $${limitUsd} cap; ending the run.`);
        await onLimit();
      }
    } catch {
      // The trace file is locked or not written yet; try again on the next tick.
    }
  }, 5_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function main() {
  const { bootHarness, loadMastra, stopHarness } = await import('../../machine/shipping/harness.mjs');
  const { DuckDBInstance } = await import('@duckdb/node-api');

  log(`Trace file: ${traceFile}`);
  log(`Harness state database: ${stateFile}`);

  const { z, createWorkflow, createStep } = await loadMastra();
  const { booted, session, mastra, requestContext, subagent } = await bootHarness({ cwd: repoRoot });

  const readCost = async () => {
    const instance = await DuckDBInstance.create(traceFile, { access_mode: 'READ_ONLY' });
    try {
      const connection = await instance.connect();
      const rows = await connection.runAndReadAll(
        "select sum(estimatedCost) as usd from metric_events where name like 'mastra_model_%'"
      );
      const usd = rows.getRowObjectsJS()[0]?.usd;
      connection.closeSync();
      return usd === null || usd === undefined ? 0 : Number(usd);
    } finally {
      instance.closeSync();
    }
  };

  const inputSchema = z.object({ task: z.string() });
  const outputSchema = z.object({ answer: z.string(), modelId: z.string() });

  const build = createStep({
    id: 'build',
    inputSchema,
    outputSchema,
    execute: async ({ inputData }) => {
      log('Workflow step started; handing the task to the stock Execute subagent.');
      const result = await subagent.execute(
        { agentType: 'execute', task: inputData.task, modelId: BUILD_MODEL },
        { workspace: session.getWorkspace(), requestContext, mastra }
      );
      const answer = String(result?.content ?? '');
      log(`The subagent answered: ${answer.split(/\r?\n/)[0]}`);
      return { answer, modelId: BUILD_MODEL };
    },
  });

  const workflow = createWorkflow({ id: WORKFLOW_ID, inputSchema, outputSchema }).then(build).commit();
  mastra.addWorkflow(workflow);

  const run = await workflow.createRun();
  log(`Mastra workflow run ${run.runId} created.`);

  const startedAt = Date.now();
  const stopWatching = await watchCost({ readCost, onLimit: () => stopHarness(booted) });

  // Mastra's stock way of asking what is running right now. The question only
  // means anything while the run is in flight, so the run is started first and
  // the listing is polled until the run settles.
  const activeSamples = [];
  const pollActive = setInterval(async () => {
    try {
      const active = await workflow.listActiveWorkflowRuns();
      activeSamples.push({
        at: new Date().toISOString(),
        total: active.total,
        runs: active.runs.map(item => ({ runId: item.runId, status: item.status })),
      });
      log(`listActiveWorkflowRuns() during the run: ${active.total} active — ${JSON.stringify(active.runs.map(item => ({ runId: item.runId, status: item.status })))}`);
    } catch (error) {
      activeSamples.push({ at: new Date().toISOString(), error: error.message });
    }
  }, 2_000);
  pollActive.unref?.();

  let outcome = null;
  let timedOut = false;
  let timer = null;
  try {
    const limit = new Promise(resolve => {
      timer = setTimeout(() => resolve({ timedOut: true }), TIME_LIMIT_MS);
      timer.unref?.();
    });
    const raced = await Promise.race([run.start({ inputData: { task: task() } }).then(value => ({ timedOut: false, value })), limit]);
    timedOut = raced.timedOut;
    outcome = raced.value ?? null;
  } finally {
    clearInterval(pollActive);
    clearTimeout(timer);
    stopWatching();
  }

  const elapsedMs = Date.now() - startedAt;
  log(`Run ended after ${(elapsedMs / 1000).toFixed(1)}s${timedOut ? ' on the ten-minute clock' : ` with status ${outcome?.status}`}.`);

  const activeAfter = await workflow.listActiveWorkflowRuns();
  log(`listActiveWorkflowRuns() after the run: ${activeAfter.total} active.`);
  let statusAfter = null;
  try {
    statusAfter = await run.getStatus?.();
  } catch (error) {
    statusAfter = `getStatus() threw: ${error.message}`;
  }
  log(`run.getStatus() after the run: ${JSON.stringify(statusAfter)}`);
  log(`workflow run record from listWorkflowRuns(): ${JSON.stringify((await workflow.listWorkflowRuns?.({ perPage: 5 }))?.runs?.map(item => ({ runId: item.runId, status: item.status })) ?? null)}`);

  await stopHarness(booted);

  const record = {
    workflowId: WORKFLOW_ID,
    workflowRunId: run.runId,
    modelId: BUILD_MODEL,
    traceFile,
    stateFile,
    elapsedMs,
    timedOut,
    status: timedOut ? 'timeout' : outcome?.status ?? 'unknown',
    answer: timedOut ? null : outcome?.result?.answer ?? null,
    activeDuring: activeSamples,
    activeAfter: { total: activeAfter.total, runs: activeAfter.runs.map(item => ({ runId: item.runId, status: item.status })) },
    statusAfter,
    proofFile: fs.existsSync(path.join(SCRATCH, 'proof.txt')) ? fs.readFileSync(path.join(SCRATCH, 'proof.txt'), 'utf8') : null,
    estimateUsd: await readCost().catch(() => null),
  };
  fs.writeFileSync(path.join(runDir, `record-${stamp}.json`), `${JSON.stringify(record, null, 2)}\n`);
  log(`Wrote the run record to ${path.join(runDir, `record-${stamp}.json`)}.`);
  log(`The run reported status ${record.status}; that is a result either way.`);
}

main().catch(error => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
