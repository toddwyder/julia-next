#!/usr/bin/env node
// The watch on card runs (JUL-331). A run's process beats a heartbeat while it
// is alive (machine/run.mjs); this program compares each running run's last
// heartbeat against the run's own idle limit and, when the limit has passed,
// marks the run stalled and tells Todd once.
//
//   node machine/watch.mjs            one pass (a systemd timer runs this every minute)
//   node machine/watch.mjs --dry-run  print what a pass would mark and say
//
// The ping is written into the run (store.stall) before it is sent, and a run
// that already carries a ping is skipped, so however often this program runs
// Todd hears about a given run exactly once.
//
// Exit 0: the pass finished. Exit 1: the store could not be listed, or a ping
// could not be recorded.

import path from 'node:path';

import { createStore, shownStatus } from './parent/store.mjs';
import { pingCard, stalledMessage } from './parent/ping.mjs';

const USAGE = `Usage: node machine/watch.mjs [options]

  --dry-run   print what the pass would mark and say, and change nothing
  --help      this text
`;

export function parseArgs(argv) {
  const options = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

export function stallReason(record) {
  const last = record.heartbeatAt ?? record.updatedAt ?? record.startedAt;
  const minutes = Math.round((Number(record.idleLimitMs) || 0) / 60_000);
  return `nothing has written to this run since ${last}, and its idle limit of ${minutes} minutes has passed`;
}

// One pass over the store. Everything it needs is passed in, so the test can
// run it against a folder of records with no clock, no network and no server.
export async function watchOnce({ folder, store = createStore(folder), now = new Date(), ping = pingCard, log = console.log } = {}) {
  const listed = store.list();
  if (listed.listError) {
    log(`machine watch: ${listed.dir} ${listed.listError}`);
    return { stalled: [], pinged: [], failed: [], listError: listed.listError };
  }

  const stalled = [];
  const pinged = [];
  const failed = [];
  for (const listedRun of listed.runs) {
    const { record, error } = store.read(listedRun.id);
    if (!record) {
      failed.push({ id: listedRun.id, error });
      continue;
    }
    if (record.pingedAt) continue;
    if (shownStatus(record, { now: now.getTime() }) !== 'stalled') continue;

    const reason = stallReason(record);
    const marked = store.stall(record, { reason, now });
    if (!marked) continue;
    stalled.push(marked);

    const inFlight = marked.steps.find(step => step.status === 'failed' && step.detail === reason) ?? null;
    const message = stalledMessage({
      record: marked,
      step: inFlight,
      idleMinutes: Math.round((Number(marked.idleLimitMs) || 0) / 60_000),
    });
    const sent = await ping(marked.card, message, { log });
    if (sent?.sent === false) failed.push({ id: marked.id, error: sent.error ?? 'the ping was refused' });
    else pinged.push(marked.id);
  }
  return { stalled, pinged, failed, listError: '' };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const folder = process.env.MACHINE_RUNS_DIR || undefined;
  if (options.dryRun) {
    const store = createStore(folder);
    const listed = store.list();
    for (const record of listed.runs) {
      const status = shownStatus(record);
      if (status !== 'stalled' || record.pingedAt) continue;
      console.log(`would mark ${record.id} stalled and tell Todd once: ${stallReason(record)}`);
    }
    return 0;
  }
  const result = await watchOnce({ folder });
  for (const id of result.pinged) console.log(`machine watch: ${id} stalled; told Todd once.`);
  for (const entry of result.failed) console.error(`machine watch: ${entry.id}: ${entry.error}`);
  return result.listError || result.failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      console.error(error.stack ?? error.message);
      process.exit(1);
    });
}
