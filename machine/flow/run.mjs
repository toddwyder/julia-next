#!/usr/bin/env node
// The runner. It starts a card down the path, reports where the run is waiting,
// resumes it with Todd's answer, and writes the run's record and cost record
// beside the run's own files. It does not decide anything.

process.env.CMD_API_KEY ??= process.env.COMMANDCODE_API_KEY;

import { appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const usage = `usage:
  node machine/flow/run.mjs start --card <card> --kind product|machine [--dir <dir>] [--verdicts <file>]
  node machine/flow/run.mjs resume --dir <dir> --run-id <id> [--request <id>] --answer yes|no
  node machine/flow/run.mjs status --dir <dir> --run-id <id>
  node machine/flow/run.mjs cost --dir <dir>`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
      out[key] = value;
    } else {
      out._.push(item);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

function need(key) {
  if (!args[key]) {
    console.error(`${command} needs --${key}\n${usage}`);
    process.exit(2);
  }
  return args[key];
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function recordPath(dir) {
  return join(dir, 'record.json');
}

// A finished run's cost record is read after the exporter shut down, because
// spans still in the exporter are not in the trace file yet.
let costWhenDone = null;

function keep(dir, event) {
  appendFileSync(recordPath(dir), `${JSON.stringify(event)}\n`);
}

async function writeCost(dir) {
  const { costRecord } = await import('./trace.mjs');
  const record = await costRecord(join(dir, 'trace.duckdb'));
  writeFileSync(join(dir, 'cost.json'), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function start() {
  const card = need('card');
  const kind = need('kind');
  if (kind !== 'product' && kind !== 'machine') throw new Error('--kind must be product or machine');
  const dir = resolve(args.dir ?? join('.artifacts/flow', `${card}-${stamp()}`));

  const { startCard } = await import('./start.mjs');
  const run = await startCard({ dir, card, kind, model: args.model, verdicts: args.verdicts });

  keep(dir, { at: new Date().toISOString(), event: 'start', ...run });
  console.log(JSON.stringify(run, null, 2));

  if (run.status === 'suspended') {
    console.log(`\nWaiting. Resume with:\n  node machine/flow/run.mjs resume --dir ${dir} --run-id ${run.runId} --request ${run.request} --answer yes`);
  } else {
    costWhenDone = dir;
  }
}

async function resume() {
  const dir = resolve(need('dir'));
  const runId = need('run-id');
  const answer = need('answer');
  if (answer !== 'yes' && answer !== 'no') throw new Error('--answer must be yes or no');

  const { resumeCard } = await import('./start.mjs');
  const result = await resumeCard({ dir, runId, request: args.request, answer });

  keep(dir, { at: new Date().toISOString(), event: 'resume', ...result });
  console.log(JSON.stringify(result, null, 2));

  if (result.status !== 'suspended') costWhenDone = dir;
}

async function status() {
  const dir = resolve(need('dir'));
  const runId = need('run-id');
  const { readState } = await import('./start.mjs');
  console.log(JSON.stringify(await readState({ dir, runId }), null, 2));
}

async function cost() {
  const dir = resolve(need('dir'));
  console.log(JSON.stringify(await writeCost(dir), null, 2));
}

const commands = { start, resume, status, cost };

if (!commands[command]) {
  console.error(usage);
  process.exit(2);
}

commands[command]().then(
  async () => {
    if (command === 'start' || command === 'resume') {
      const { closeFlow } = await import('./start.mjs');
      await closeFlow();
    }
    if (costWhenDone) {
      await writeCost(costWhenDone);
      console.log(`\nRun record: ${recordPath(costWhenDone)}\nCost record: ${join(costWhenDone, 'cost.json')}`);
    }
    process.exitCode = 0;
    // Some storage handles keep the loop alive after the run is done.
    setTimeout(() => process.exit(0), 2000).unref();
  },
  error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 2000).unref();
  },
);
