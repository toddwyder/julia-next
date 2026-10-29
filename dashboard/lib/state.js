// state.js -- the dashboard service's on-disk state contract (JUL-276 PR-2, decision D3).
//
// The state root is DASHBOARD_STATE_DIR, /var/lib/julia-dashboard on the server, owned by
// ubuntu. It sits outside the git checkout, so an update that fast-forwards
// /home/ubuntu/julia-dashboard cannot delete a run's record. Everything this PR reads or
// writes lives under <DASHBOARD_STATE_DIR>/state:
//
//   runs/<id>.json   {id, status, startedAt}   status: starting | running | finished | failed
//   build.json       {commit, ref, updatedAt, previous}   written by scripts/update.mjs
//   watchdog.json    {consecutiveFailures, down, ...}     written by scripts/watchdog.mjs
//
// This PR only defines and reads the run contract. PR-7 writes the run files.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_STATE_DIR = '/var/lib/julia-dashboard';
export const RUN_STATUSES = Object.freeze(['starting', 'running', 'finished', 'failed']);
export const ACTIVE_RUN_STATUSES = Object.freeze(['starting', 'running']);

const trimSlash = value => value.replace(/\/+$/, '');

export const stateRoot = (env = process.env) => trimSlash(env.DASHBOARD_STATE_DIR || DEFAULT_STATE_DIR);
export const stateFolder = (env = process.env) => join(stateRoot(env), 'state');
export const runsFolder = (env = process.env) => join(stateFolder(env), 'runs');
export const buildRecordFile = (env = process.env) => join(stateFolder(env), 'build.json');
export const watchdogRecordFile = (env = process.env) => join(stateFolder(env), 'watchdog.json');

// The reason a value is not a run record, or '' when it is one. Named so the health view,
// the updater and the tests all agree on what "parses" means.
export function runRecordProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'is not a JSON object';
  if (typeof value.id !== 'string' || !value.id.trim()) return 'has no id';
  if (!RUN_STATUSES.includes(value.status)) return `has status ${JSON.stringify(value.status)}; expected one of ${RUN_STATUSES.join(', ')}`;
  if (typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) return 'has an unreadable startedAt';
  return '';
}

// One file, parsed. `error` is a human reason a broken file is named by, never a throw.
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

// Every *.json in the runs folder, sorted by name so a log line and a health view read the
// same way twice. A missing runs folder means no runs, not an error: the folder is created
// by scripts/install-service.mjs, and a run record is the only thing that makes it exist.
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

// Writes through a temporary file and renames it, so a crash mid-write leaves the previous
// record intact rather than a half-written one the health check would name.
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
