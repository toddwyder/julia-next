#!/usr/bin/env node
// Keeps Mastra Code's trace store small by folding it into an archive.
//
//   node scripts/trace-store.mjs status
//   node scripts/trace-store.mjs fold [--quiet]
//
// Stock Mastra Code writes one file, ~/.local/share/mastracode/observability.duckdb, and
// DuckDB admits one writer per file: a session that starts while another holds it gets no
// tracing at all, silently, for its whole life (`@mastra/code-sdk/dist/index.js:323`), so
// its cost rows are never recorded and the card scored from it reads unknown. One session
// at a time is traced, which is what the stock install offers without a wrapper.
//
// `fold` copies the finished store's `metric_events` rows, the per-call tokens and cost a
// scorecard prices from, into `archive.duckdb`, then deletes the file. Deleting the file is
// what returns the disk: DuckDB keeps freed blocks inside the file, so a delete in place
// gives back nothing. Measured on 30 October: 52,443 rows deleted and checkpointed,
// 5,955,137,536 B before and after. A file a running session still holds is left alone, and
// the daily `julia-trace-fold.timer` calls fold so no one has to remember a cleanup step.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { programDir } from './mastra-program.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALARM_BYTES = 15 * 1024 ** 3;
const ARCHIVE = 'archive.duckdb';
const FOLDING = '.folding';
const LEFT_BEHIND = 'left-behind.json';

export function appDataDir(env = process.env) {
  return env.MASTRA_APP_DATA_DIR || join(homedir(), '.local', 'share', 'mastracode');
}

export function tracesDir(env = process.env) {
  return env.JULIA_TRACES_DIR || join(appDataDir(env), 'traces');
}

// The file stock Mastra Code writes. `fold` empties it and the next session recreates it.
export function legacyStoreFile(env = process.env) {
  return env.MASTRA_OBSERVABILITY_DB_PATH || join(appDataDir(env), 'observability.duckdb');
}

export function fileBytes(file) {
  const wal = `${file}.wal`;
  return (existsSync(file) ? statSync(file).size : 0) + (existsSync(wal) ? statSync(wal).size : 0);
}

export function freeBytes(dir) {
  const fs = statfsSync(existsSync(dir) ? dir : dirname(dir));
  return Number(fs.bavail) * Number(fs.bsize);
}

const gb = bytes => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

// DuckDB refuses the second handle with "Could not set lock on file ... by user ubuntu".
// That is a session holding the file, not a fault, so it is its own answer.
export function lockOwnerFromError(message) {
  const pid = /Conflicting lock is held .*\(PID (\d+)\)/.exec(message);
  return pid ? { pid: Number(pid[1]) } : null;
}

export function isLockedMessage(message) {
  return /Could not set lock on file/.test(message);
}

function duckdb() {
  let installed;
  try {
    installed = join(programDir(), 'node_modules', '@duckdb', 'node-api');
  } catch {
    installed = '';
  }
  const candidates = [join(REPO, 'node_modules', '@duckdb', 'node-api'), installed].filter(Boolean);
  const found = candidates.find(candidate => existsSync(join(candidate, 'package.json')));
  if (!found) throw new Error('no @duckdb/node-api package found to fold the trace files: run npm ci');
  return createRequire(join(found, 'package.json'))('@duckdb/node-api');
}

// DuckDB sizes its buffer pool at 85% of the machine's memory, which on this server is
// 6 GB of 7 GB, and the kernel killed a run that read every session at 6.15 GB before it
// deleted a row. A budget the machine can hold, with the rest spilling beside the file,
// keeps a deep read from deciding how much memory the process needs.
export function openOptions(file) {
  const limit = Math.min(2048, Math.max(256, Math.floor(totalmem() / 2 ** 20 / 3)));
  return { memory_limit: `${limit}MB`, temp_directory: `${file}.tmp` };
}

// Every file that can hold traces: the archive, each session's own file, and the single file
// this replaced if it sits somewhere else.
export function traceFiles(dir = tracesDir(), legacy = legacyStoreFile()) {
  const names = existsSync(dir) ? readdirSync(dir) : [];
  const files = names.filter(name => name.endsWith('.duckdb')).sort().map(name => join(dir, name));
  if (existsSync(legacy) && resolve(dirname(legacy)) !== resolve(dir)) files.push(legacy);
  return files;
}

// The work of a fold: a half-finished file left by an interrupted fold, then every session
// file, then the single file this replaced. The archive is the destination, so it is not work.
export function pendingFiles(dir = tracesDir(), legacy = legacyStoreFile()) {
  const names = existsSync(dir) ? readdirSync(dir) : [];
  const files = names
    .filter(name => name.endsWith(FOLDING) || (name.endsWith('.duckdb') && name !== ARCHIVE))
    .sort()
    .map(name => join(dir, name));
  if (existsSync(legacy) && resolve(dirname(legacy)) !== resolve(dir)) files.push(legacy);
  return files;
}

// A trace whose cleanup failed stays on disk, and DuckDB can magnify it on the way out
// rather than shrink it. The reason goes beside the trace so the next status report and the
// scorecard of any card it carries can name both, until a cleanup clears it.
export function leftBehindFile(dir = tracesDir()) {
  return join(dir, LEFT_BEHIND);
}

export function readLeftBehind(dir = tracesDir()) {
  const file = leftBehindFile(dir);
  if (!existsSync(file)) return [];
  try {
    const entries = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(entries) ? entries.filter(entry => entry?.file && entry?.path && entry?.reason) : [];
  } catch {
    // A half-written record must not be the reason a cleanup stops.
    return [];
  }
}

// A trace left behind after a failed cleanup is still on disk, so a card it carries has to
// name it rather than quietly price the card from what reached the archive.
export function leftBehindTraces({ dir = tracesDir() } = {}) {
  return readLeftBehind(dir).map(entry => ({ path: entry.path, name: entry.left, reason: entry.reason }));
}

function rememberLeftBehind(dir, entry) {
  const entries = readLeftBehind(dir);
  const at = entries.findIndex(existing => existing.file === entry.file);
  if (at === -1) entries.push(entry);
  else entries[at] = entry;
  const file = leftBehindFile(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(entries.sort((a, b) => a.file.localeCompare(b.file)), null, 2)}\n`);
}

function forgetLeftBehind(dir, key) {
  const entries = readLeftBehind(dir).filter(entry => entry.file !== key);
  const file = leftBehindFile(dir);
  if (entries.length) writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
  else rmSync(file, { force: true });
}

async function tryAttach(connection, file, alias, readOnly = false) {
  try {
    // The fold only reads an old trace before deleting it. Attached for writing, detaching
    // runs a checkpoint that rewrote a 14.2 GiB trace to 18.1 GiB and filled the disk on
    // 2 Nov 2026; read-only, the file cannot be rewritten and its size holds until removal.
    await connection.run(`attach '${file.replaceAll("'", "''")}' as ${alias}${readOnly ? ' (READ_ONLY)' : ''}`);
    return null;
  } catch (error) {
    if (isLockedMessage(error.message)) return lockOwnerFromError(error.message) ?? {};
    throw error;
  }
}

// The cost rows of one dead file go into the archive, then the file goes. A file is renamed
// before its rows are copied so a copy that lands twice cannot be counted twice, and a
// half-finished `.folding` file is picked up by the next fold.
async function foldOne(connection, catalog, file, dir) {
  const key = basename(file).replace(FOLDING, '');
  const probe = await tryAttach(connection, file, 'src', true);
  if (probe) return { skipped: { file: key, pid: probe.pid ?? null } };
  await connection.run('detach src');
  const folding = file.endsWith(FOLDING) ? file : `${file}${FOLDING}`;
  if (folding !== file) {
    renameSync(file, folding);
    if (existsSync(`${file}.wal`)) renameSync(`${file}.wal`, `${folding}.wal`);
  }
  const second = await tryAttach(connection, folding, 'src', true);
  if (second) return { skipped: { file: key, pid: second.pid ?? null } };
  // A run killed part way leaves the trace behind with no reason of its own, so say it may
  // be here before the copy and replace that reason with the real one if the copy fails.
  rememberLeftBehind(dir, {
    file: key,
    path: folding,
    left: basename(folding),
    reason: 'a cleanup started on this trace and was interrupted before its rows reached the archive',
    at: new Date().toISOString(),
  });
  try {
    const metrics = Number((await connection.runAndReadAll('select count(*) as n from src.metric_events')).getRowObjectsJson()[0].n);
    await connection.run(`create table if not exists ${catalog}.metric_events as select * from src.metric_events limit 0`);
    await connection.run(`alter table ${catalog}.metric_events add column if not exists source_file varchar`);
    await connection.run(`delete from ${catalog}.metric_events where source_file = '${key}'`);
    await connection.run(`insert into ${catalog}.metric_events by name select *, '${key}' as source_file from src.metric_events`);
    await connection.run('detach src');
    rmSync(folding, { force: true });
    rmSync(`${folding}.wal`, { force: true });
    forgetLeftBehind(dir, key);
    return { folded: { file: key, metrics } };
  } catch (error) {
    // Leave the `.folding` file for the next fold, which replaces its rows rather than
    // adding to them.
    throw new Error(`could not fold ${key}: ${error.message}`);
  }
}

export async function foldTraces({ dir = tracesDir(), legacy = legacyStoreFile() } = {}) {
  const pending = pendingFiles(dir, legacy);
  const diskBytes = () =>
    [...traceFiles(dir, legacy), ...pending.filter(file => file.endsWith(FOLDING))]
      .reduce((sum, file) => sum + fileBytes(file), 0);
  const bytesBefore = diskBytes();
  const folded = [];
  const skipped = [];
  const leftBehind = [];
  let status = 'ok';
  let pid = null;
  if (pending.length) {
    mkdirSync(dir, { recursive: true });
    const archive = join(dir, ARCHIVE);
    const archiveExisted = existsSync(archive);
    const { DuckDBInstance } = duckdb();
    let instance;
    try {
      instance = await DuckDBInstance.create(archive, openOptions(archive));
    } catch (error) {
      const owner = lockOwnerFromError(error.message);
      if (!owner && !isLockedMessage(error.message)) throw error;
      status = 'busy';
      pid = owner?.pid ?? null;
    }
    if (instance) {
      try {
        const connection = await instance.connect();
        const catalog = (await connection.runAndReadAll('select current_database() as db')).getRowObjectsJson()[0].db;
        await connection.run('set threads = 1');
        for (const file of pending) {
          // One trace that cannot be cleaned must not hold back the rest: the oldest failure
          // blocked every later trace from 31 Oct to 2 Nov 2026.
          try {
            const answer = await foldOne(connection, catalog, file, dir);
            if (answer.folded) folded.push(answer.folded);
            else skipped.push(answer.skipped);
          } catch (error) {
            const key = basename(file).replace(FOLDING, '');
            const left = existsSync(`${file}${FOLDING}`) ? `${key}${FOLDING}` : basename(file);
            rememberLeftBehind(dir, { file: key, path: join(dir, left), left, reason: error.message, at: new Date().toISOString() });
            leftBehind.push({ file: key, left, reason: error.message });
          }
        }
        await connection.run('checkpoint');
      } finally {
        instance.closeSync?.();
      }
      // Opening the archive is what creates it, so a launch that only finds live files leaves
      // an empty one behind. Nothing was folded, so it is not worth keeping.
      if (!archiveExisted && !folded.length) {
        rmSync(archive, { force: true });
        rmSync(`${archive}.wal`, { force: true });
      }
    }
  }
  const bytesAfter = diskBytes();
  return {
    status,
    pid,
    dir,
    archive: join(dir, ARCHIVE),
    folded,
    skipped,
    leftBehind,
    bytesBefore,
    bytesAfter,
    size: gb(bytesAfter),
    free: gb(freeBytes(dir)),
    overAlarm: bytesAfter > ALARM_BYTES,
  };
}

// Read from the filesystem alone: a running session holds its file, and asking this
// question must never be the reason a cleanup fails.
export function status({ dir = tracesDir(), legacy = legacyStoreFile() } = {}) {
  const files = traceFiles(dir, legacy).map(file => ({ name: basename(file), bytes: fileBytes(file) }));
  const pending = pendingFiles(dir, legacy).map(file => basename(file));
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  // Only records whose file is still here: a cleanup that worked clears its own record, and
  // this read never writes, so asking can never be the reason a cleanup fails.
  const leftBehind = readLeftBehind(dir)
    .filter(entry => pending.includes(entry.left) || files.some(file => file.name === entry.left))
    .map(({ file, left, reason, at }) => ({ file, left, reason, at }));
  return {
    dir,
    files,
    pending,
    leftBehind,
    bytes,
    size: gb(bytes),
    free: gb(freeBytes(dir)),
    overAlarm: bytes > ALARM_BYTES,
  };
}

function usage() {
  return ['usage: node scripts/trace-store.mjs status', '       node scripts/trace-store.mjs fold [--quiet]'].join('\n');
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const words = [];
  while (rest.length) {
    const arg = rest.shift();
    if (arg === '--quiet') flags.quiet = true;
    else if (arg.startsWith('--')) throw new Error(`${arg} is not an option.\n${usage()}`);
    else words.push(arg);
  }
  return { command, flags, words };
}

async function main(argv) {
  const { command, flags, words } = parseArgs(argv);
  if (words.length) throw new Error(`${command} takes no arguments.\n${usage()}`);
  let answer;
  if (command === 'status') answer = status();
  else if (command === 'fold') answer = await foldTraces();
  else {
    console.error(usage());
    return 2;
  }
  const leftBehindNote = answer.leftBehind?.length
    ? `left behind: ${answer.leftBehind.map(entry => `${entry.file} (${entry.reason})`).join('; ')}`
    : null;
  const unfinished = answer.overAlarm || Boolean(answer.leftBehind?.length);
  if (flags.quiet) {
    // Quiet is what the timer runs, and a failure there is otherwise invisible.
    if (leftBehindNote) console.error(leftBehindNote);
    if (answer.overAlarm) console.error(`the trace files are ${answer.size} in ${answer.dir}, over the ${gb(ALARM_BYTES)} they are allowed to reach: a session is not being folded`);
    return unfinished ? 1 : 0;
  }
  if (answer.status === 'busy') answer.note = `another fold holds ${answer.archive}${answer.pid ? ` (PID ${answer.pid})` : ''}; nothing was changed`;
  if (answer.folded?.length) answer.note = `folded ${answer.folded.map(f => `${f.file} (${f.metrics} cost rows)`).join(', ')}`;
  if (answer.skipped?.length) answer.note = [answer.note, `left ${answer.skipped.map(s => s.file).join(', ')} alone: a session still holds them`].filter(Boolean).join('; ');
  if (leftBehindNote) answer.note = [answer.note, leftBehindNote].filter(Boolean).join('; ');
  if (answer.overAlarm) answer.note = [answer.note, `still over ${gb(ALARM_BYTES)}`].filter(Boolean).join('; ');
  console.log(JSON.stringify(answer, null, 2));
  return unfinished ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
