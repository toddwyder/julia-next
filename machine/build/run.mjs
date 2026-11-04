#!/usr/bin/env node
// One way to start a card: this command. It builds the card in a workflow run,
// then hands the same run to review and to landing.
//
//   node machine/build/run.mjs JUL-334
//
// The build is a step of the workflow, done by the stock session from
// `machine/shipping/harness.mjs` on the model pstack names for the `feature`
// role. Review and landing are the machine's existing commands, started by their
// own steps. Everything the run does is written to one trace file, tagged with
// the card, so the build's timings, model calls, tokens and cost can be read back
// from a single place.
//
// Exit 0: the card landed. Exit 1: the run stopped; the last line names the step
// and the reason. Exit 2: bad arguments.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootHarness, stopHarness } from '../shipping/harness.mjs';
import { BUILD_TIME_LIMIT_MS } from './agent.mjs';
import { buildModel } from './model.mjs';
import { loadTracing } from './tracing.mjs';
import { createCardWorkflow, stageCommand, WORKFLOW_ID } from './workflow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');

const USAGE = `Usage: node machine/build/run.mjs <JUL-n> [options]

  --pr <n>              a pull request that already exists for the card
  --model <id>          build model, overriding pstack's model file
  --time-limit-min <n>  minutes the build may run before the step aborts it
  --dry-run             print what each step would do and stop
`;

export function parseArgs(argv) {
  const options = { card: null, pr: null, model: null, timeLimitMs: BUILD_TIME_LIMIT_MS, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--pr') options.pr = Number(argv[++index]);
    else if (arg === '--model') options.model = argv[++index];
    else if (arg === '--time-limit-min') options.timeLimitMs = Number(argv[++index]) * 60_000;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (/^JUL-\d+$/i.test(arg)) options.card = arg.toUpperCase();
    else throw new Error(`unknown argument ${arg}`);
  }
  if (options.pr !== null && !Number.isInteger(options.pr)) throw new Error('--pr takes a pull request number');
  if (!Number.isFinite(options.timeLimitMs) || options.timeLimitMs <= 0) throw new Error('--time-limit-min takes a number of minutes');
  return options;
}

export function runDirFor(card, root = repoRoot) {
  return path.join(root, '.artifacts', 'build', card);
}

// The trace file name is the one the launcher folds into its archive: a per-run
// file beside the other stages' traces, not the interactive session's file.
export function traceFileForCard(card, dir = process.env.JULIA_TRACES_DIR || path.join(os.homedir(), '.local', 'share', 'mastracode', 'traces')) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${stamp}-${process.pid}-build-${card}.duckdb`);
}

export async function startCard(options, { root = repoRoot, log = console.log } = {}) {
  const card = options.card;
  const runDir = runDirFor(card, root);

  if (options.dryRun) {
    const named = options.model ?? 'the feature model in ~/.agents/pstack-models.md';
    log(`build: in-process agent for ${card} on ${named}, ${Math.round(options.timeLimitMs / 60_000)} minute limit`);
    for (const stage of ['review', 'landing']) {
      const [command, args] = stageCommand(stage, { card, pr: options.pr ?? '<n>' });
      log(`${stage}: ${command} ${args.join(' ')}`);
    }
    return { code: 0 };
  }

  const model = options.model ?? buildModel();
  const traceFile = process.env.MASTRA_OBSERVABILITY_DB_PATH || traceFileForCard(card);
  fs.mkdirSync(runDir, { recursive: true });

  process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFile;
  const { getCurrentSpan } = await loadTracing();
  log(`card: trace file ${traceFile}`);

  const { booted, session, mastra } = await bootHarness({ cwd: root });
  const startedAt = Date.now();
  let settled = null;
  try {
    const { workflow } = await createCardWorkflow({
      mastra,
      session,
      root,
      model,
      timeLimitMs: options.timeLimitMs,
      currentSpan: getCurrentSpan,
      log,
    });
    const run = await workflow.createRun();
    log(`card: workflow run ${run.runId}`);
    try {
      settled = await run.start({
        inputData: { card, pr: options.pr },
        tracingOptions: { metadata: { card }, tags: [card] },
      });
    } catch (error) {
      settled = { status: 'failed', error: error?.message ?? String(error) };
    }
    const record = {
      card,
      model,
      workflowId: WORKFLOW_ID,
      workflowRunId: run.runId,
      traceFile,
      status: settled?.status ?? 'unknown',
      error: settled?.error ?? null,
      elapsedMs: Date.now() - startedAt,
      threadId: session.thread.getId(),
      endedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(runDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
    log(`card: ${card} ${record.status} in ${Math.round(record.elapsedMs / 1000)}s; record in ${runDir}/record.json`);
    if (record.status !== 'success') {
      log(`card: stopped — ${record.error ?? 'the workflow did not finish'}`);
      return { code: 1, ...record };
    }
    return { code: 0, ...record };
  } finally {
    await stopHarness(booted);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!options.card) {
    console.error(USAGE);
    process.exit(2);
  }
  startCard(options)
    .then(result => process.exit(result.code))
    .catch(error => {
      console.error(error?.stack ?? String(error));
      process.exit(1);
    });
}
