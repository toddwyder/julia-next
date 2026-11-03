// Reads the machine's run records (JUL-330). The machine writes one JSON file
// per run into its run store; this module reads that folder the same way the
// machine does, without importing the machine's code, because the dashboard is
// its own Next app.
//
// The store's status is only running, succeeded or failed. A run that says it is
// running but has not been heard from for longer than its own idle limit is
// stalled, and the page says so.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_RUNS_DIR = '/var/lib/julia-dashboard/state/machine-runs';

const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' });

// Times are shown in UTC with the label, so the reader is never misled by
// whatever clock the server happens to keep.
export function stamp(value) {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? `${when.format(new Date(ms))} UTC` : 'unknown';
}

export function runsFolder(env = process.env) {
  return env.MACHINE_RUNS_DIR || DEFAULT_RUNS_DIR;
}

export function isStalled(record, now = Date.now()) {
  if (record.status !== 'running') return false;
  const beat = Date.parse(record.heartbeatAt ?? record.updatedAt ?? record.startedAt);
  if (!Number.isFinite(beat)) return false;
  return now - beat > record.idleLimitMs;
}

export function shownStatus(record, now = Date.now()) {
  return isStalled(record, now) ? 'stalled' : record.status;
}

function parseRecord(text) {
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return null;
  }
  if (!record || typeof record.id !== 'string' || typeof record.card !== 'string') return null;
  if (!Array.isArray(record.steps)) return null;
  return record;
}

export async function readRun(id, folder = runsFolder()) {
  try {
    const record = parseRecord(await readFile(path.join(folder, `${id}.json`), 'utf8'));
    return record && record.id === id ? record : null;
  } catch {
    return null;
  }
}

export async function listRuns(folder = runsFolder()) {
  let names;
  try {
    names = await readdir(folder);
  } catch (error) {
    if (error.code === 'ENOENT') return { dir: folder, runs: [], listError: null };
    return { dir: folder, runs: [], listError: error.message };
  }
  const runs = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = await readRun(name.slice(0, -'.json'.length), folder);
    if (record) runs.push(record);
  }
  runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return { dir: folder, runs, listError: null };
}
