// Everything this PR reads or writes lives under <DASHBOARD_STATE_DIR>/state:
//
//   runs/<id>.json   {id, status, startedAt, ...}   status: starting | running |
//                    waiting (blocked on Todd) | finished | failed | stopped
//                    (the process stopped it; the reason is in the file)
//   build.json       {commit, ref, updatedAt, previous}   written by scripts/update.mjs
//   watchdog.json    {consecutiveFailures, down, ...}     written by scripts/watchdog.mjs
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_STATE_DIR = '/var/lib/julia-dashboard';
export const RUN_STATUSES = Object.freeze(['starting', 'running', 'waiting', 'finished', 'failed', 'stopped']);
export const ACTIVE_RUN_STATUSES = Object.freeze(['starting', 'running']);

const trimSlash = value => value.replace(/\/+$/, '');

export const stateRoot = (env = process.env) => trimSlash(env.DASHBOARD_STATE_DIR || DEFAULT_STATE_DIR);
export const stateFolder = (env = process.env) => join(stateRoot(env), 'state');
export const runsFolder = (env = process.env) => join(stateFolder(env), 'runs');
export const buildRecordFile = (env = process.env) => join(stateFolder(env), 'build.json');
export const watchdogRecordFile = (env = process.env) => join(stateFolder(env), 'watchdog.json');

export function runRecordProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'is not a JSON object';
  if (typeof value.id !== 'string' || !value.id.trim()) return 'has no id';
  if (!RUN_STATUSES.includes(value.status)) return `has status ${JSON.stringify(value.status)}; expected one of ${RUN_STATUSES.join(', ')}`;
  if (typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) return 'has an unreadable startedAt';
  return '';
}

export function parseRunFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return { file, run: null, error: `could not be read (${error.code ?? error.message})` };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { file, run: null, error: 'is not valid JSON' };
  }
  const problem = runRecordProblem(value);
  if (problem) return { file, run: null, error: problem };
  return { file, run: { id: value.id, status: value.status, startedAt: value.startedAt }, error: '' };
}

export function readRuns(env = process.env) {
  const dir = runsFolder(env);
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return { dir, entries: [], listError: '' };
    return { dir, entries: [], listError: `could not be listed (${error.code ?? error.message})` };
  }
  const entries = names.filter(name => name.endsWith('.json')).sort().map(name => parseRunFile(join(dir, name)));
  return { dir, entries, listError: '' };
}

export const isActiveRun = entry => !entry.error && ACTIVE_RUN_STATUSES.includes(entry.run.status);

export function writeJsonRecord(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, file);
}

export function readJsonRecord(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return { value: null, error: error.code === 'ENOENT' ? '' : `could not be read (${error.code ?? error.message})` };
  }
  try {
    return { value: JSON.parse(text), error: '' };
  } catch {
    return { value: null, error: 'is not valid JSON' };
  }
}
