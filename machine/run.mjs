#!/usr/bin/env node
// The one machine entry point (JUL-330). It starts the build, the review loop
// and the landing as the three steps of one stock Mastra workflow, writes the
// run into the shared run store, and beats a heartbeat for as long as it is
// alive. That record is what the dashboard's runs page reads.
//
//   node machine/run.mjs JUL-330
//   node machine/run.mjs JUL-330 --pr 431
//
// Exit 0: the run finished and every stage passed. Exit 1: the run stopped; the
// last line names the stage and the reason. Exit 2: bad arguments.

import fs from 'node:fs';
import path from 'node:path';

import { createStore, idleLimitMs, runId, writeRun } from './parent/store.mjs';
import { createStages, repoRoot, stageCommand } from './parent/stages.mjs';

const USAGE = `Usage: node machine/run.mjs <JUL-n> [options]

  --pr <n>        a pull request that already exists for the card; skips the build
  --model <id>    Shipping review model, passed to the review loop
  --dry-run       print the command each stage would run and stop
  --help          this text
`;

export function parseArgs(argv) {
  const options = { card: null, pr: null, model: null, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--pr') options.pr = Number(argv[++index]);
    else if (arg === '--model') options.model = argv[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (/^JUL-\d+$/i.test(arg)) options.card = arg.toUpperCase();
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

function traceFileFor(id) {
  const dir = process.env.JULIA_TRACES_DIR ?? path.join(process.env.HOME ?? '.', '.local/share/mastracode/traces');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `machine-${id}-${Date.now()}.duckdb`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (!options.card || (options.pr !== null && (!Number.isInteger(options.pr) || options.pr <= 0))) {
    console.error(USAGE);
    return 2;
  }

  const env = process.env;
  if (options.dryRun) {
    for (const stage of ['build', 'remediation', 'landing']) {
      const [command, args] = stageCommand(stage, { card: options.card, pr: options.pr ?? '<n>', model: options.model }, env);
      console.log(`${stage}: ${command} ${args.map(arg => (arg.includes('\n') ? '<kickoff prompt>' : arg)).join(' ')}`);
    }
    return 0;
  }

  const store = createStore(undefined, { idleLimit: idleLimitMs(env) });
  const id = runId({ card: options.card });
  const runDir = path.join(repoRoot, '.artifacts', 'machine', id);
  fs.mkdirSync(runDir, { recursive: true });

  const holder = { record: store.start({ card: options.card, pr: options.pr, id }) };
  console.log(`machine: run ${id} for ${options.card}; record in ${store.folder}`);

  process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFileFor(id);
  process.env.MASTRA_DB_PATH = path.join(runDir, 'state.db');

  const { loadMastra } = await import('./shipping/harness.mjs');
  const { Mastra, LibSQLStore } = await loadMastra();
  const { createMachineWorkflow } = await import('./parent/workflow.mjs');

  const mastra = new Mastra({ storage: new LibSQLStore({ id, url: `file:${path.join(runDir, 'state.db')}` }), logger: false });
  const { workflow } = await createMachineWorkflow({
    mastra,
    store,
    holder,
    model: options.model,
    runStage: createStages({ env, log: console.log }),
  });

  const run = await workflow.createRun();
  holder.record = writeRun({ ...holder.record, workflowRunId: run.runId, evidence: runDir }, store.folder);

  // A live process beats; a dead one stops. That is how the page tells a long
  // build from a run whose process vanished.
  const beat = setInterval(() => {
    try {
      holder.record = store.beat(holder.record);
    } catch (error) {
      console.error(`machine: heartbeat failed: ${error.message}`);
    }
  }, 30_000);
  beat.unref?.();

  let result;
  try {
    result = await run.start({ inputData: { card: options.card, pr: options.pr } });
  } catch (error) {
    clearInterval(beat);
    const stopped = store.finish(holder.record, 'failed', { detail: error.message });
    console.error(`machine: ${stopped.id} stopped: ${error.message}`);
    return 1;
  }
  clearInterval(beat);

  const succeeded = result?.status === 'success';
  const failedStep = holder.record.steps.find(step => step.status === 'failed');
  const detail = succeeded
    ? `every stage finished${holder.record.pr ? `; pull request #${holder.record.pr}` : ''}`
    : failedStep?.detail ?? result?.error?.message ?? result?.status ?? 'no result';
  const finished = store.finish(holder.record, succeeded ? 'succeeded' : 'failed', { detail });

  if (!succeeded) {
    console.error(`machine: ${finished.id} failed at ${failedStep?.id ?? 'an unknown stage'}: ${detail}`);
    return 1;
  }
  console.log(`machine: ${options.card} finished run ${finished.id}; every stage passed.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      console.error(error.stack ?? error.message);
      process.exit(1);
    });
}
