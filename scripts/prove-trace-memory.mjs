#!/usr/bin/env node
// The trace's memory ceiling, measured the way the 7 Nov build broke it: one
// model step per prompt, every step answering with a 1 MB tool result, all of it
// traced through the run's own storage. A run that keeps the spans bounded ends
// small; one that stores the whole prompt per span grows with the square of the
// step count and dies at the heap cap.
//
//   node scripts/prove-trace-memory.mjs
//
// Prints one JSON reading and exits 0 when the final heap is under 150 MB. A
// probe that dies at the 1.2 GB cap exits 1 and names the step it died on.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STEPS = 60;
export const PAYLOAD_BYTES = 1_000_000;
export const HEAP_CAP_MB = 1229;
export const HEAP_LIMIT_MB = 150;

const SELF = fileURLToPath(import.meta.url);
const READING = '@@reading ';

const mb = bytes => Math.round(bytes / 1048576);

function sample() {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

async function worker() {
  process.env.CMD_API_KEY ??= 'unused-in-probe';
  const { Agent } = await import('@mastra/core/agent');
  const { createTool } = await import('@mastra/core/tools');
  const { createStep, createWorkflow } = await import('@mastra/core/workflows');
  const { z } = await import('zod');
  const { openMastra } = await import('../machine/flow/mastra.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'prove-trace-memory-'));
  const traceDb = join(dir, 'trace.duckdb');

  let peak = sample();
  let done = 0;
  const step = createTool({
    id: 'step',
    description: 'does one step of work and answers with a megabyte',
    inputSchema: z.object({ n: z.number() }),
    execute: async ({ n }) => {
      done = n + 1;
      peak = Math.max(peak, sample());
      if (done % 10 === 0) console.error(`step ${done} heap ${mb(peak)}MB`);
      return { n, blob: 'x'.repeat(PAYLOAD_BYTES) };
    },
  });

  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const chunk = parts => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  });
  const finish = reason => ({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage });
  const text = value => [
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: value },
    { type: 'text-end', id: 't' },
  ];
  // The scripted model picks its move from the prompt alone, so the step count
  // is the run's own history rather than a counter in this file.
  const toolResults = prompt =>
    prompt.filter(message => message.role === 'tool').length;

  const model = {
    specificationVersion: 'v3',
    provider: 'scripted',
    modelId: 'scripted-lead',
    doStream: async ({ prompt }) => {
      const sofar = toolResults(prompt);
      if (sofar < STEPS) {
        return chunk([
          {
            type: 'tool-call',
            toolCallId: `call-${sofar}`,
            toolName: 'step',
            input: JSON.stringify({ n: sofar }),
          },
          finish('tool-calls'),
        ]);
      }
      return chunk([...text('build done'), finish('stop')]);
    },
  };

  const agent = new Agent({
    id: 'probe-build',
    name: 'Probe build',
    instructions: 'Take one step at a time until the work is done.',
    model,
    tools: { step },
    defaultOptions: { maxSteps: STEPS + 5 },
  });

  const build = createStep({
    id: 'build',
    inputSchema: z.object({ card: z.string() }),
    outputSchema: z.object({ text: z.string() }),
    execute: async ({ inputData }) => {
      const result = await agent.stream(`build ${inputData.card}`);
      return { text: await result.text };
    },
  });
  const workflow = createWorkflow({
    id: 'prove-trace-memory',
    inputSchema: z.object({ card: z.string() }),
    outputSchema: z.object({ text: z.string() }),
  })
    .then(build)
    .commit();

  const mastra = await openMastra({
    card: 'PROBE-STEPS',
    agents: { build: agent },
    workflow,
    stateDb: join(dir, 'state.db'),
    traceDb,
  });
  const run = await mastra.getWorkflow(workflow.id).createRun();
  const result = await run.start({ inputData: { card: 'PROBE-STEPS' } });

  // The exporter flushes on its own timer, and the spans it still holds are part
  // of what the run costs. Give it its window, then read the heap.
  await new Promise(resolve => setTimeout(resolve, 8000));
  const finalHeap = sample();
  peak = Math.max(peak, finalHeap);

  const reading = {
    steps: done,
    payloadBytes: PAYLOAD_BYTES,
    heapCapMb: HEAP_CAP_MB,
    peakHeapMb: mb(peak),
    finalHeapMb: mb(finalHeap),
    traceMb: Math.round(statSync(traceDb).size / 1024) / 1024,
    status: result.status,
  };
  rmSync(dir, { recursive: true, force: true });
  console.log(`${READING}${JSON.stringify(reading)}`);
}

function parent() {
  const child = spawn(process.execPath, ['--expose-gc', `--max-old-space-size=${HEAP_CAP_MB}`, SELF, '--run'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  child.stdout.on('data', data => {
    out += data;
  });
  child.on('exit', (code, signal) => {
    const line = out.split('\n').find(entry => entry.startsWith(READING));
    if (!line) {
      const last = out.trim().split('\n').filter(Boolean).pop() ?? '';
      console.log(
        JSON.stringify({
          died: true,
          signal: signal ?? null,
          exitCode: code,
          detail: 'the probe reached the heap cap before it finished the steps',
          last,
        }),
      );
      process.exitCode = 1;
      return;
    }
    const reading = JSON.parse(line.slice(READING.length));
    const pass = reading.finalHeapMb < HEAP_LIMIT_MB && reading.steps === STEPS;
    console.log(JSON.stringify({ ...reading, heapLimitMb: HEAP_LIMIT_MB, pass }));
    process.exitCode = pass ? 0 : 1;
  });
}

if (process.argv[2] === '--run') await worker();
else parent();
