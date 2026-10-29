#!/usr/bin/env node
// Keeps Mastra Code's trace store (observability.duckdb) from filling the disk,
// and writes the per-card cost ledger the scorecard reads.
//
//   node scripts/trace-store.mjs status
//   node scripts/trace-store.mjs ledger
//   node scripts/trace-store.mjs prune [--keep-days 14] [--dry-run]
//
// Why this exists: DuckDB allows one process to hold the file. A running Mastra
// Code session holds it, so nothing else can read it — the scorecard's copy
// trick is the only way in and the store had grown past the free space, so cards
// reported "Cost: unknown". This job runs when no session holds the store: it
// writes a small ledger of the cost rows (which outlives the pruning), deletes
// the aged span and log rows that carry the payloads, and compacts the file so
// the space actually comes back. Any run that finds the store held reports that
// and exits 0, so a run during a session is not an alarm.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Spans and logs carry the full tool inputs and outputs, which is what makes the
// store huge; Mastra Code's own retention gives them 14 days.
const DEFAULT_KEEP_DAYS = 14;
const PRUNED_TABLES = ['span_events', 'log_events'];
const LEDGER_VERSION = 1;
const MARGIN_BYTES = 512 * 1024 * 1024;

export function storeFile(env = process.env) {
  return env.MASTRA_OBSERVABILITY_DB_PATH || join(env.MASTRA_APP_DATA_DIR || join(homedir(), '.local', 'share', 'mastracode'), 'observability.duckdb');
}

export function ledgerFile(env = process.env) {
  if (env.MASTRA_TRACE_LEDGER) return env.MASTRA_TRACE_LEDGER;
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'julia', 'trace-costs.json');
}

export function reportFile(env = process.env) {
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'julia', 'trace-store-report.json');
}

export function storeBytes(file) {
  const wal = `${file}.wal`;
  return (existsSync(file) ? statSync(file).size : 0) + (existsSync(wal) ? statSync(wal).size : 0);
}

export function freeBytes(dir) {
  const fs = statfsSync(existsSync(dir) ? dir : dirname(dir));
  return Number(fs.bavail) * Number(fs.bsize);
}

// DuckDB refuses the second handle with "Could not set lock on file ... by user
// ubuntu". That is the store being in use, not a fault, so it is its own answer.
export function lockOwnerFromError(message) {
  const pid = /Conflicting lock is held .*\(PID (\d+)\)/.exec(message);
  if (!pid) return null;
  return { pid: Number(pid[1]) };
}

export function isLockedMessage(message) {
  return /Could not set lock on file/.test(message);
}

export function retentionCutoff(now, keepDays) {
  return new Date(now.getTime() - keepDays * 24 * 60 * 60 * 1000);
}

// The compacted file is a whole-database copy of the live rows, so it needs room
// for what survives the delete — never more than the file that is there now.
export function compactionFits(bytes, room) {
  return Math.ceil(bytes / 2) + MARGIN_BYTES <= room;
}

export function mergeLedger(existing, rows, requested = []) {
  const keyOf = r => `${r.threadId}\u0000${r.at}\u0000${r.entityName}\u0000${r.provider}\u0000${r.model}\u0000${r.name}`;
  const byKey = new Map((existing?.rows ?? []).map(r => [keyOf(r), r]));
  for (const row of rows) byKey.set(keyOf(row), row);
  const asks = new Map();
  const askKey = r => `${r.threadId}\u0000${r.at}\u0000${r.entityName}`;
  for (const r of existing?.requested ?? []) asks.set(askKey(r), r);
  for (const r of requested) asks.set(askKey(r), r);
  return { version: LEDGER_VERSION, updatedAt: new Date().toISOString(), rows: [...byKey.values()], requested: [...asks.values()] };
}

export function readLedger(file = ledgerFile()) {
  if (!existsSync(file)) return { version: LEDGER_VERSION, updatedAt: null, rows: [], requested: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { version: parsed.version, updatedAt: parsed.updatedAt, rows: parsed.rows ?? [], requested: parsed.requested ?? [] };
}

function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

function duckdb() {
  const dir = resolve(REPO, 'node_modules');
  const candidates = [join(dir, '@duckdb', 'node-api'), join(homedir(), '.local', 'lib', 'mastracode-program', 'node_modules', '@duckdb', 'node-api')];
  const found = candidates.find(p => existsSync(join(p, 'package.json')));
  if (!found) throw new Error('no @duckdb/node-api package found to read the trace store');
  return createRequire(join(found, 'package.json'))('@duckdb/node-api');
}

async function openStore(file, mode) {
  const { DuckDBInstance } = duckdb();
  try {
    const instance = await DuckDBInstance.create(file, mode ? { access_mode: mode } : {});
    return { instance };
  } catch (error) {
    const owner = lockOwnerFromError(error.message);
    if (owner || isLockedMessage(error.message)) return { busy: owner ?? {} };
    throw error;
  }
}

const METRIC_QUERY = `select threadId, epoch_ms(date_trunc('minute', timestamp)) as at, entityName, provider, model, name,
    sum(value) as value,
    case when count(*) filter (where estimatedCost is null) > 0 then null else sum(estimatedCost) end as estimatedCost,
    count(*) as rows
  from metric_events
  where name like 'mastra_model_%tokens'
  group by 1, 2, 3, 4, 5, 6
  order by 2`;

const REQUESTED_QUERY = `select threadId, epoch_ms(timestamp) as at, entityName,
    json_extract_string(attributes, '$.model') as model,
    json_extract_string(attributes, '$.provider') as provider
  from span_events
  where spanType = 'model_generation' and endedAt is null
  order by 2`;

async function readRows(connection, sql) {
  return (await connection.runAndReadAll(sql)).getRowObjectsJson().map(row => {
    const value = Number(row.value);
    return { ...row, value: Number.isFinite(value) ? value : 0, estimatedCost: row.estimatedCost == null ? null : Number(row.estimatedCost), rows: row.rows == null ? undefined : Number(row.rows) };
  });
}

export async function exportLedger(file = storeFile(), ledger = ledgerFile()) {
  const opened = await openStore(file, 'READ_ONLY');
  if (opened.busy) return { status: 'busy', ...opened.busy };
  try {
    const connection = await opened.instance.connect();
    const rows = await readRows(connection, METRIC_QUERY);
    const requested = await readRows(connection, REQUESTED_QUERY);
    const merged = mergeLedger(readLedger(ledger), rows, requested);
    writeJsonAtomic(ledger, merged);
    return { status: 'ok', rows: rows.length, requested: requested.length, ledgerRows: merged.rows.length, ledger };
  } finally {
    opened.instance.closeSync?.();
  }
}

async function deleteAged(file, keepDays, dryRun) {
  const opened = await openStore(file);
  if (opened.busy) return { status: 'busy', ...opened.busy };
  const cutoff = retentionCutoff(new Date(), keepDays);
  const stamp = cutoff.toISOString().replace('T', ' ').slice(0, 19);
  const counts = {};
  try {
    const connection = await opened.instance.connect();
    for (const table of PRUNED_TABLES) {
      const exists = (await connection.runAndReadAll(`select count(*) as n from duckdb_tables() where table_name = '${table}'`)).getRowObjectsJson()[0].n;
      if (!Number(exists)) {
        counts[table] = 0;
        continue;
      }
      if (dryRun) {
        counts[table] = Number((await connection.runAndReadAll(`select count(*) as n from ${table} where timestamp < timestamp '${stamp}'`)).getRowObjectsJson()[0].n);
        continue;
      }
      const before = Number((await connection.runAndReadAll(`select count(*) as n from ${table}`)).getRowObjectsJson()[0].n);
      await connection.run(`delete from ${table} where timestamp < timestamp '${stamp}'`);
      const after = Number((await connection.runAndReadAll(`select count(*) as n from ${table}`)).getRowObjectsJson()[0].n);
      counts[table] = before - after;
    }
  } finally {
    opened.instance.closeSync?.();
  }
  return { status: 'ok', counts, cutoff: cutoff.toISOString() };
}

function removeQuietly(file) {
  if (existsSync(file)) rmSync(file, { force: true });
}

async function compact(file) {
  const temp = `${file}.compact`;
  removeQuietly(temp);
  const { DuckDBInstance } = duckdb();
  const instance = await DuckDBInstance.create(':memory:');
  try {
    const connection = await instance.connect();
    await connection.run(`attach '${file}' as src (read_only)`);
    await connection.run(`attach '${temp}' as dst`);
    await connection.run('copy from database src to dst');
    await connection.run('detach dst');
    await connection.run('detach src');
  } finally {
    instance.closeSync?.();
  }
  const compactBytes = statSync(temp).size;
  const parked = `${file}.pruned`;
  removeQuietly(parked);
  renameSync(file, parked);
  renameSync(temp, file);
  removeQuietly(`${file}.wal`);
  removeQuietly(parked);
  removeQuietly(`${parked}.wal`);
  return compactBytes;
}

function appendReport(entry) {
  const file = reportFile();
  let report = { runs: [] };
  if (existsSync(file)) {
    try {
      report = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      report = { runs: [] };
    }
  }
  report.runs = [...(report.runs ?? []).slice(-19), entry];
  writeJsonAtomic(file, report);
  return file;
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

const mb = bytes => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const gb = bytes => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export async function status() {
  const file = storeFile();
  const bytes = storeBytes(file);
  const room = freeBytes(dirname(file));
  const opened = await openStore(file, 'READ_ONLY');
  const answer = {
    store: file,
    bytes,
    size: bytes > 1024 ** 3 ? gb(bytes) : mb(bytes),
    freeBytes: room,
    free: gb(room),
    busy: Boolean(opened.busy),
    holderPid: opened.busy?.pid ?? null,
    ledger: ledgerFile(),
    report: reportFile(),
  };
  if (!opened.busy) {
    try {
      const connection = await opened.instance.connect();
      const tables = (await connection.runAndReadAll("select table_name from duckdb_tables() order by table_name")).getRowObjectsJson().map(r => r.table_name);
      const rows = {};
      for (const table of tables) rows[table] = Number((await connection.runAndReadAll(`select count(*) as n from ${table}`)).getRowObjectsJson()[0].n);
      answer.tables = rows;
    } finally {
      opened.instance.closeSync?.();
    }
  }
  return answer;
}

export async function prune({ keepDays = DEFAULT_KEEP_DAYS, dryRun = false } = {}) {
  const file = storeFile();
  if (!existsSync(file)) return { status: 'missing', store: file };
  const before = storeBytes(file);
  const room = freeBytes(dirname(file));
  const probe = await openStore(file, 'READ_ONLY');
  if (probe.busy) return { status: 'busy', ...probe.busy, store: file, bytes: before };
  probe.instance.closeSync?.();
  if (!dryRun && !compactionFits(before, room)) {
    return { status: 'no-room', store: file, bytes: before, room, needed: Math.ceil(before / 2) + MARGIN_BYTES };
  }
  const ledger = dryRun ? { status: 'skipped' } : await exportLedger(file);
  const deleted = await deleteAged(file, keepDays, dryRun);
  if (deleted.status !== 'ok') return { ...deleted, store: file };
  const after = dryRun ? before : storeBytes(file);
  const compacted = dryRun ? null : await compact(file);
  const finalBytes = dryRun ? before : storeBytes(file);
  const entry = {
    at: new Date().toISOString(),
    store: file,
    keepDays,
    dryRun,
    bytesBefore: before,
    bytesAfterDelete: after,
    bytesAfter: finalBytes,
    compactedBytes: compacted,
    deleted: deleted.counts,
    freeBefore: room,
    freeAfter: freeBytes(dirname(file)),
    ledger: ledger.status === 'ok' ? { rows: ledger.rows, ledgerRows: ledger.ledgerRows } : ledger,
  };
  if (!dryRun) entry.report = appendReport(entry);
  return { status: dryRun ? 'dry-run' : 'ok', ...entry };
}

function usage() {
  return [
    'usage: node scripts/trace-store.mjs status',
    '       node scripts/trace-store.mjs ledger',
    '       node scripts/trace-store.mjs prune [--keep-days 14] [--dry-run] [--wait-for-lock [--minutes 180]]',
  ].join('\n');
}

async function main(argv) {
  const [command, ...rest] = argv;
  const flag = name => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1];
  };
  let answer;
  if (command === 'status') answer = await status();
  else if (command === 'ledger') {
    answer = await exportLedger();
    if (answer.status === 'busy') answer.note = 'a Mastra Code session holds the trace store; the ledger keeps the rows from the last run that could read it';
  } else if (command === 'prune') {
    const keepDays = flag('--keep-days') == null ? DEFAULT_KEEP_DAYS : Number(flag('--keep-days'));
    if (!Number.isFinite(keepDays) || keepDays < 0) throw new Error('--keep-days needs a number of days (0 or more)');
    const waitMinutes = Number(flag('--minutes') ?? (rest.includes('--wait-for-lock') ? 180 : 0));
    if (!Number.isFinite(waitMinutes) || waitMinutes < 0) throw new Error('--minutes needs a number (0 or more)');
    // A live session holds an exclusive lock for hours, so the nightly sweep can be told to
    // wait for it rather than report busy and leave the store at 22.6 GB.
    const deadline = Date.now() + waitMinutes * 60_000;
    for (;;) {
      answer = await prune({ keepDays, dryRun: rest.includes('--dry-run') });
      if (answer.status !== 'busy' || Date.now() >= deadline) break;
      await sleep(30_000);
    }
    if (answer.status === 'busy') answer.note = `a Mastra Code session holds the trace store (PID ${answer.pid}); this run waited ${waitMinutes} min and changed nothing`;
    if (answer.status === 'no-room') answer.note = `not enough room to compact: ${gb(answer.bytes)} store needs about ${gb(answer.needed)} free, ${gb(answer.room)} is free`;
    if (answer.status === 'ok') answer.note = `${mb(answer.bytesBefore)} → ${mb(answer.bytesAfter)} on disk`;
  } else {
    console.error(usage());
    return 2;
  }
  console.log(JSON.stringify(answer, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
