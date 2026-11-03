// One store for card runs (JUL-330). A run is one file, named after the run, in
// one folder that both the machine and the dashboard read. The machine is the
// only writer. Every stage of the run is a step in that file, so a reader can
// answer "which stage, how long, did it finish" from the file alone.
//
// A record carries its own idle limit, so the viewer never invents a threshold:
// it compares now against the record's heartbeat and the record's limit.
//
// A write is a temporary file followed by a rename, so a reader never sees half
// a record.

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RUN_STATUSES = Object.freeze(['running', 'succeeded', 'failed']);
export const STEP_STATUSES = Object.freeze(['pending', 'running', 'succeeded', 'failed', 'skipped']);
export const STEP_IDS = Object.freeze(['build', 'remediation', 'landing']);
export const DEFAULT_RUNS_DIR = '/var/lib/julia-dashboard/state/machine-runs';
export const DEFAULT_IDLE_LIMIT_MIN = 10;

export function runsFolder(env = process.env) {
  return env.MACHINE_RUNS_DIR || DEFAULT_RUNS_DIR;
}

export function idleLimitMs(env = process.env) {
  const minutes = Number(env.MACHINE_IDLE_LIMIT_MIN ?? DEFAULT_IDLE_LIMIT_MIN);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_LIMIT_MIN) * 60_000;
}

// 20261103T064122Z-JUL-330: readable in a URL, safe as a file name, and it
// sorts by start time as text.
export function runId({ card, now = new Date() }) {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll('-', '').replaceAll(':', '');
  return `${stamp}-${card}`;
}

// Each step names its own card, so a step read without the run around it still
// says which card it belongs to.
const step = (id, card) => ({ id, card, status: 'pending', startedAt: null, endedAt: null, elapsedMs: null, detail: null, usage: null });

export function writeRun(record, folder = runsFolder()) {
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${record.id}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, file);
  return record;
}

export function readRunFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return { record: null, error: `could not be read (${error.code ?? error.message})` };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { record: null, error: 'is not valid JSON' };
  }
  const problem = runProblem(value);
  return problem ? { record: null, error: problem } : { record: value, error: '' };
}

export function runProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'is not a JSON object';
  if (typeof value.id !== 'string' || !value.id.trim()) return 'has no id';
  if (typeof value.card !== 'string' || !value.card.trim()) return 'has no card';
  if (!RUN_STATUSES.includes(value.status)) return `has status ${JSON.stringify(value.status)}; expected one of ${RUN_STATUSES.join(', ')}`;
  if (typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) return 'has an unreadable startedAt';
  if (!Array.isArray(value.steps)) return 'has no steps';
  return '';
}

// startedAt newest first: the page opens on what the machine is doing now.
export function listRuns(folder = runsFolder()) {
  let names;
  try {
    names = readdirSync(folder);
  } catch (error) {
    if (error.code === 'ENOENT') return { dir: folder, runs: [], listError: '' };
    return { dir: folder, runs: [], listError: `could not be listed (${error.code ?? error.message})` };
  }
  const runs = names
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => readRunFile(path.join(folder, name)))
    .filter(entry => entry.record);
  runs.sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt));
  return { dir: folder, runs: runs.map(entry => entry.record), listError: '' };
}

// A running run whose heartbeat is older than its own idle limit has stalled:
// the process behind it is gone, and nothing else will ever move the file on.
export function shownStatus(record, { now = Date.now() } = {}) {
  if (record.status !== 'running') return record.status;
  const beat = Date.parse(record.heartbeatAt ?? record.updatedAt ?? record.startedAt);
  const limit = Number(record.idleLimitMs) || DEFAULT_IDLE_LIMIT_MIN * 60_000;
  return Number.isFinite(beat) && now - beat > limit ? 'stalled' : 'running';
}

export function createStore(folder = runsFolder(), { idleLimit = idleLimitMs() } = {}) {
  const save = record => writeRun(record, folder);
  const stepIndex = (record, id) => record.steps.findIndex(candidate => candidate.id === id);
  const replace = (record, index, next) => record.steps.map((candidate, at) => (at === index ? { ...candidate, ...next } : candidate));

  return {
    folder,
    idleLimit,

    start({ card, pr = null, id = null, now = new Date() }) {
      const at = now.toISOString();
      return save({
        id: id ?? runId({ card, now }),
        card,
        pr,
        status: 'running',
        idleLimitMs: idleLimit,
        startedAt: at,
        updatedAt: at,
        heartbeatAt: at,
        endedAt: null,
        pingedAt: null,
        pingedReason: null,
        steps: STEP_IDS.map(id => step(id, card)),
      });
    },

    begin(record, id, now = new Date()) {
      const at = now.toISOString();
      const index = stepIndex(record, id);
      if (index < 0) throw new Error(`run ${record.id} has no step named ${id}`);
      return save({ ...record, steps: replace(record, index, { status: 'running', startedAt: at, endedAt: null, elapsedMs: null, detail: null, usage: null, warning: null }), updatedAt: at, heartbeatAt: at });
    },

    end(record, id, { status, detail = null, pr, usage = null, now = new Date() }) {
      const at = now.toISOString();
      const index = stepIndex(record, id);
      if (index < 0) throw new Error(`run ${record.id} has no step named ${id}`);
      if (!STEP_STATUSES.includes(status)) throw new Error(`${status} is not a step status`);
      const startedAt = record.steps[index].startedAt;
      const elapsedMs = startedAt && Number.isFinite(Date.parse(startedAt)) ? Date.parse(at) - Date.parse(startedAt) : null;
      // A stage that succeeded and left no model rows behind is the fault the
      // spike found: the session got no tracing and said nothing about it. The
      // flag is written next to the usage so the page has to show it.
      const warning = status === 'succeeded' && usage?.empty ? 'this stage ran but its trace file holds no model rows' : null;
      const steps = replace(record, index, { status, endedAt: at, elapsedMs, detail, usage, warning });
      return save({ ...record, steps, pr: pr ?? record.pr, updatedAt: at, heartbeatAt: at });
    },

    // The heartbeat is what tells a stalled run from a slow one. run.mjs beats
    // while its process is alive; the beat stops when the process does.
    beat(record, now = new Date()) {
      const at = now.toISOString();
      return save({ ...record, heartbeatAt: at, updatedAt: at });
    },

    finish(record, status, { detail = null, now = new Date() } = {}) {
      if (!RUN_STATUSES.includes(status)) throw new Error(`${status} is not a run status`);
      const at = now.toISOString();
      return save({ ...record, status, endedAt: at, updatedAt: at, heartbeatAt: at, detail });
    },

    // The watcher marks a run the moment its heartbeat is too old, before it
    // sends anything: the mark is what makes the ping a once-only event, so a
    // second pass over the same folder finds the run already spoken for.
    stall(record, { reason, now = new Date() }) {
      if (record.pingedAt) return null;
      const at = now.toISOString();
      const index = record.steps.findIndex(candidate => candidate.status === 'running');
      const steps = index < 0 ? record.steps : replace(record, index, {
        status: 'failed',
        endedAt: at,
        elapsedMs: record.steps[index].startedAt ? Date.parse(at) - Date.parse(record.steps[index].startedAt) : null,
        detail: reason,
      });
      return save({ ...record, steps, pingedAt: at, pingedReason: reason, updatedAt: at });
    },

    read(id) {
      return readRunFile(path.join(folder, `${id}.json`));
    },

    list() {
      return listRuns(folder);
    },
  };
}
