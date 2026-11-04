#!/usr/bin/env node
// JUL-334 proof: can an ordinary Mastra workflow step run the build itself as a
// plain agent, with the agent's model calls nested inside the step's own trace
// and the card written on that trace, and can the step end the run on a clock?
//
// Throwaway instrument. It answers those questions and nothing else. Nothing
// outside this folder changes.
//
//   node spikes/build-step-proof/run.mjs
//
// The trace path and the harness state database are set before any Mastra module
// is loaded, the way machine/shipping/run.mjs does it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const runDir = path.join(repoRoot, '.artifacts', 'build-step-proof');

const CARD = 'JUL-334';
const WORKFLOW_ID = 'build-step-proof';
const BUILD_MODEL = 'commandcode/deepseek/deepseek-v4.1-flash';
const SKILL = '.agents/skills/poteto-mode/SKILL.md';
const TIME_LIMIT_MS = 10 * 60_000;
const ABORT_LIMIT_MS = 4_000;
const SCRATCH = path.join(runDir, 'scratch');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const traceFile = path.join(runDir, `trace-${stamp}.duckdb`);
const stateFile = path.join(runDir, `state-${stamp}.db`);

fs.mkdirSync(SCRATCH, { recursive: true });
fs.rmSync(path.join(SCRATCH, 'proof.txt'), { force: true });

process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFile;
process.env.MASTRA_DB_PATH = stateFile;
process.env.MASTRACODE_PROGRAM_DIR ||= path.join(process.env.HOME ?? '', '.local', 'lib', 'mastracode-program');

const log = message => console.log(`[${new Date().toISOString()}] ${message}`);

function task() {
  return [
    'You are a proof agent. Do this and nothing else.',
    '',
    `Read ${SKILL} first and follow it.`,
    '',
    `Then write the single line "a workflow step ran the build agent" to ${path.join(SCRATCH, 'proof.txt')}.`,
    '',
    'Then start one child agent with the subagent tool, agentType "execute", and ask it to answer with the',
    `"name" field from ${path.join(repoRoot, 'package.json')} in one line.`,
    '',
    'Answer with one sentence saying what you wrote and what the child agent answered.',
  ].join('\n');
}

// The stock clock: when it fires, the session aborts its own run, the way a
// person pressing stop would, and the step reports that it ran out of time.
async function runOnClock(send, limitMs) {
  let timer = null;
  let timedOut = false;
  const startedAt = Date.now();
  try {
    const limit = new Promise(resolve => {
      timer = setTimeout(() => {
        timedOut = true;
        log(`The ${limitMs / 1000}s clock fired; aborting the session's run.`);
        send.abort();
        resolve(null);
      }, limitMs);
      timer.unref?.();
    });
    const settled = await Promise.race([send.run().then(value => ({ value })), limit]);
    return { outcome: settled?.value ?? null, timedOut, elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { bootHarness, loadMastra, stopHarness } = await import('../../machine/shipping/harness.mjs');
  const { initContextStorage, getCurrentSpan } = await import(
    path.join(process.env.MASTRACODE_PROGRAM_DIR, 'node_modules', '@mastra', 'core', 'dist', 'observability', 'context-storage.js')
  );
  initContextStorage();

  log(`Trace file: ${traceFile}`);
  log(`Harness state database: ${stateFile}`);

  const { z, createWorkflow, createStep } = await loadMastra();
  const { booted, session, mastra } = await bootHarness({ cwd: repoRoot });

  const inputSchema = z.object({ task: z.string(), timeLimitMs: z.number() });
  const outputSchema = z.object({
    answer: z.string(),
    hadSpan: z.boolean(),
    timedOut: z.boolean(),
    elapsedMs: z.number(),
  });

  const lastAssistantText = async threadId => {
    const messages = await session.thread.listMessages({ threadId, limit: 200 });
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message?.role !== 'assistant') continue;
      const content = message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content?.parts)
          ? content.parts.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')
          : '';
      if (text.trim()) return text.trim();
    }
    return '';
  };

  let send = null;

  const build = createStep({
    id: 'build',
    inputSchema,
    outputSchema,
    execute: async ({ inputData }) => {
      const currentSpan = getCurrentSpan();
      log(`The step's own span: ${currentSpan ? currentSpan.spanId ?? '(no spanId)' : 'none'}`);
      await session.model.switch(BUILD_MODEL);
      send = {
        run: () =>
          session.sendMessage({
            content: inputData.task,
            ...(currentSpan ? { tracingContext: { currentSpan } } : {}),
            tracingOptions: { metadata: { card: CARD }, tags: [CARD] },
            untilIdle: true,
          }),
        abort: () => session.abort(),
      };
      const result = await runOnClock(send, inputData.timeLimitMs);
      const answer = await lastAssistantText(session.thread.getId());
      return { answer, hadSpan: Boolean(currentSpan), timedOut: result.timedOut, elapsedMs: result.elapsedMs };
    },
  });

  const workflow = createWorkflow({ id: WORKFLOW_ID, inputSchema, outputSchema }).then(build).commit();
  mastra.addWorkflow(workflow);

  const outcomes = [];

  for (const [label, limitMs] of [['build proof', TIME_LIMIT_MS], ['abort proof', ABORT_LIMIT_MS]]) {
    const run = await workflow.createRun();
    log(`${label}: workflow run ${run.runId}`);
    const startedAt = Date.now();
    let settled = null;
    try {
      settled = await run.start({ inputData: { task: task(), timeLimitMs: limitMs }, tracingOptions: { metadata: { card: CARD }, tags: [CARD] } });
    } catch (error) {
      log(`${label}: run.start threw ${error?.message ?? error}`);
    }
    outcomes.push({
      label,
      runId: run.runId,
      status: settled?.status ?? 'unknown',
      elapsedMs: Date.now() - startedAt,
      result: settled?.result ?? null,
    });
    log(`${label}: ended ${settled?.status ?? 'unknown'} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  }

  await stopHarness(booted);

  const record = {
    card: CARD,
    modelId: BUILD_MODEL,
    traceFile,
    stateFile,
    proofFile: fs.existsSync(path.join(SCRATCH, 'proof.txt')) ? fs.readFileSync(path.join(SCRATCH, 'proof.txt'), 'utf8').trim() : null,
    outcomes,
  };
  const recordFile = path.join(runDir, `record-${stamp}.json`);
  fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  log(`Wrote the run record to ${recordFile}.`);
}

main().catch(error => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
