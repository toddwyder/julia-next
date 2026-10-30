#!/usr/bin/env node
// Keeps Mastra Code's trace store (observability.duckdb) from filling the disk,
// and writes the per-session numbers the scorecard reads.
//
//   node scripts/trace-store.mjs status
//   node scripts/trace-store.mjs ledger
//   node scripts/trace-store.mjs mine <thread> [--card JUL-276] [--dry-run]
//   node scripts/trace-store.mjs delete <thread> [--card JUL-276] [--dry-run]
//   node scripts/trace-store.mjs compact [--dry-run]
//   node scripts/trace-store.mjs sweep [--dry-run] [--wait-for-lock [--minutes 180]]
//
// Why this exists: DuckDB allows one process to hold the file, so a running
// Mastra Code session blocks every other reader and the scorecard had no cost
// to show. Two functions carry the work now:
//
//   mineSession(thread)   reads what the store really holds for one session and
//                         saves it in the kept cost ledger, which outlives the
//                         payload rows.
//   deletePayloads(thread) deletes that session's span and log rows, and refuses
//                         unless the session was mined and its card has a retro
//                         in docs/retros. The payloads cannot go before the
//                         lesson is on disk.
//
// Deleting by age is gone: a session is deleted because it was learned from, not
// because it is old. Any run that finds the store held reports that and exits 0,
// so a run during a session is not an alarm.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRUNED_TABLES = ['span_events', 'log_events'];
const LEDGER_VERSION = 2;
const MARGIN_BYTES = 512 * 1024 * 1024;
const TOOL_STAGES = ['tool_call', 'tool_action'];
const LESSON_PATTERN = 'compact|handoff';

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

export function stopsFile(env = process.env) {
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'julia', 'stops.jsonl');
}

export function retrosFolder(env = process.env) {
  return env.JULIA_RETROS_DIR || join(REPO, 'docs', 'retros');
}

// The retro is written as docs/retros/<card>.md; docs/retros/jul-231.md shows
// they are lower case on disk, so both spellings count as the record.
export function retroFile(card, { retrosDir = retrosFolder() } = {}) {
  const wanted = [`${card}.md`, `${String(card).toLowerCase()}.md`];
  return wanted.map(name => join(retrosDir, name)).find(file => existsSync(file)) ?? join(retrosDir, wanted[0]);
}

export function retroExists(card, { retrosDir = retrosFolder() } = {}) {
  return Boolean(card) && existsSync(retroFile(card, { retrosDir }));
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
  return { version: LEDGER_VERSION, updatedAt: new Date().toISOString(), rows: [...byKey.values()], requested: [...asks.values()], sessions: existing?.sessions ?? {} };
}

export function readLedger(file = ledgerFile()) {
  if (!existsSync(file)) return { version: LEDGER_VERSION, updatedAt: null, rows: [], requested: [], sessions: {} };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { version: parsed.version, updatedAt: parsed.updatedAt, rows: parsed.rows ?? [], requested: parsed.requested ?? [], sessions: parsed.sessions ?? {} };
}

// A mined session is what lets the payloads go: the numbers stay here after the
// rows that produced them are deleted.
export function recordSession(ledger, record) {
  return {
    version: LEDGER_VERSION,
    updatedAt: new Date().toISOString(),
    rows: ledger?.rows ?? [],
    requested: ledger?.requested ?? [],
    sessions: { ...(ledger?.sessions ?? {}), [record.thread]: record },
  };
}

export function deletionRefusal(thread, { ledger = readLedger(), retrosDir = retrosFolder(), card } = {}) {
  const record = ledger.sessions?.[thread];
  if (!record) {
    return { code: 'not-mined', message: `refusing to delete thread ${thread}: it was never mined, so nothing about it is kept yet; run: node scripts/trace-store.mjs mine ${thread} --card <card>` };
  }
  const wanted = card ?? record.card;
  if (!wanted) {
    return { code: 'no-card', message: `refusing to delete thread ${thread}: the mined record names no card, so there is no retro to look for; mine it again with --card <card>` };
  }
  if (!retroExists(wanted, { retrosDir })) {
    return { code: 'no-retro', message: `refusing to delete thread ${thread}: ${wanted} has no retro at ${retroFile(wanted, { retrosDir })}; the payloads wait until the lesson is written` };
  }
  return null;
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

// The scorecard prices a card from these two: per-minute token and cost rows,
// and which model each call asked for. `thread` narrows them to one session so
// mining can keep that session's numbers before its payload rows are deleted.
const METRIC_QUERY = thread => `select threadId, epoch_ms(date_trunc('minute', timestamp)) as at, entityName, provider, model, name,
    sum(value) as value,
    case when count(*) filter (where estimatedCost is null) > 0 then null else sum(estimatedCost) end as estimatedCost,
    count(*) as rows
  from metric_events
  where name like 'mastra_model_%tokens'${thread ? ` and threadId = ${sqlText(thread)}` : ''}
  group by 1, 2, 3, 4, 5, 6
  order by 2`;

const REQUESTED_QUERY = thread => `select threadId, epoch_ms(timestamp) as at, entityName,
    json_extract_string(attributes, '$.model') as model,
    json_extract_string(attributes, '$.provider') as provider
  from span_events
  where spanType = 'model_generation' and endedAt is null${thread ? ` and threadId = ${sqlText(thread)}` : ''}
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
    const rows = await readRows(connection, METRIC_QUERY());
    const requested = await readRows(connection, REQUESTED_QUERY());
    const merged = mergeLedger(readLedger(ledger), rows, requested);
    writeJsonAtomic(ledger, merged);
    return { status: 'ok', rows: rows.length, requested: requested.length, ledgerRows: merged.rows.length, ledger };
  } finally {
    opened.instance.closeSync?.();
  }
}

const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;
const tokenKey = name => name.replace(/^mastra_model_/, '').replace(/_tokens$/, '');
const stageKey = name => name.replace(/^mastra_/, '').replace(/_ms$/, '');
const normalModel = name => String(name ?? 'unknown').toLowerCase().replace(/[._]/g, '-');

const SESSION_QUERIES = thread => ({
  answered: `select coalesce(provider, 'unknown') as provider, coalesce(model, 'unknown') as model, name, sum(value) as tokenCount,
      case when count(*) filter (where estimatedCost is null) > 0 then null else sum(estimatedCost) end as usd,
      count(*) as rows, min(epoch_ms(timestamp)) as firstAt, max(epoch_ms(timestamp)) as lastAt
    from metric_events where threadId = ${sqlText(thread)} and name like 'mastra_model_%tokens'
    group by 1, 2, 3 order by 7`,
  asked: `select coalesce(json_extract_string(attributes, '$.model'), 'unknown') as model,
      coalesce(json_extract_string(attributes, '$.provider'), 'unknown') as provider,
      count(*) as calls, min(epoch_ms(timestamp)) as firstAt, max(epoch_ms(timestamp)) as lastAt
    from span_events where threadId = ${sqlText(thread)} and spanType = 'model_generation'
    group by 1, 2 order by 4`,
  stages: `select name, count(*) as runs, sum(value) as totalMs, max(value) as maxMs
    from metric_events where threadId = ${sqlText(thread)} and name like 'mastra_%_duration_ms'
    group by 1 order by 3 desc`,
  tools: `select name, count(*) as calls from span_events
    where threadId = ${sqlText(thread)} and spanType in (${TOOL_STAGES.map(sqlText).join(', ')})
    group by 1 order by 2 desc`,
  lessonSpans: `select coalesce(spanType, '') as spanType, coalesce(name, '') as name from span_events
    where threadId = ${sqlText(thread)} and (regexp_matches(lower(coalesce(spanType, '')), '${LESSON_PATTERN}') or regexp_matches(lower(coalesce(name, '')), '${LESSON_PATTERN}'))`,
  lessonLogs: `select coalesce(level, '') as level, coalesce(message, '') as message from log_events
    where threadId = ${sqlText(thread)} and regexp_matches(lower(coalesce(message, '')), '${LESSON_PATTERN}')`,
});

function readStops(thread, file) {
  if (!existsSync(file)) return { file, count: 0, reasons: {}, note: `no stop log at ${file}` };
  const entries = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.thread === thread) entries.push(entry);
    } catch {
      entries.push({ reason: 'unreadable line' });
    }
  }
  const reasons = {};
  for (const entry of entries) if (entry.reason) reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1;
  return { file, count: entries.length, reasons, first: entries[0]?.at ?? null, last: entries.at(-1)?.at ?? null };
}

// What the store can and cannot answer, said in the record itself so nobody
// reads a zero as a fact about the session.
const HOLDS = [
  ['tokens and cost per model', 'metric_events'],
  ['which model each call asked for', 'span_events model_generation attributes'],
  ['which model answered', 'metric_events provider and model'],
  ['time per stage', 'metric_events duration rows'],
  ['tool calls', 'span_events tool spans'],
  ['model changes', 'derived from the asked-model order'],
  ['stops', 'the stop log, not the store'],
  ['compactions', 'nothing in the store unless a span or log names one'],
  ['handoffs', 'nothing in the store unless a span or log names one'],
];

export function buildSessionRecord({ thread, card, answered, asked, stages, tools, stops, lessonSpans, lessonLogs, minedAt = new Date().toISOString(), store }) {
  const tokens = new Map();
  const models = new Map();
  for (const row of answered) {
    const key = `${row.provider}/${row.model}`;
    const priced = row.usd != null;
    const model = models.get(key) ?? { asked: null, answered: key, calls: Number(row.rows), usd: priced ? 0 : null, firstAt: Number(row.firstAt), lastAt: Number(row.lastAt), tokens: {} };
    model.tokens[tokenKey(row.name)] = (model.tokens[tokenKey(row.name)] ?? 0) + Number(row.tokenCount ?? row.value ?? 0);
    model.usd = priced && model.usd != null ? model.usd + Number(row.usd) : null;
    tokens.set(tokenKey(row.name), (tokens.get(tokenKey(row.name)) ?? 0) + Number(row.tokenCount ?? 0));
    models.set(key, model);
  }
  for (const row of asked) {
    const name = `${row.provider}/${row.model}`;
    const match = [...models.values()].find(model => model.answered.toLowerCase().includes(normalModel(row.model).slice(-12)) || normalModel(model.answered).includes(normalModel(row.model)));
    if (match) {
      match.asked = name;
      match.calls = Number(row.calls);
    } else {
      models.set(name, { asked: name, answered: 'not recorded', calls: Number(row.calls), usd: null, firstAt: Number(row.firstAt), lastAt: Number(row.lastAt), tokens: {} });
    }
  }
  const askedOrder = [...asked].sort((a, b) => Number(a.firstAt) - Number(b.firstAt)).map(row => `${row.provider}/${row.model}`);
  const askedChanges = askedOrder.filter((name, index) => index === 0 || name !== askedOrder[index - 1]);
  const perStage = new Map();
  for (const row of stages) {
    const stage = perStage.get(stageKey(row.name)) ?? { stage: stageKey(row.name), runs: 0, totalMs: 0, maxMs: 0 };
    stage.runs += Number(row.runs);
    stage.totalMs += Number(row.totalMs);
    stage.maxMs = Math.max(stage.maxMs, Number(row.maxMs));
    perStage.set(stage.stage, stage);
  }
  const toolCounts = Object.fromEntries(tools.map(row => [row.name, Number(row.calls)]));
  const lessonRows = [...lessonSpans.map(row => `${row.spanType} ${row.name}`.trim()), ...lessonLogs.map(row => row.message)];
  const compactions = lessonRows.filter(text => /compact/.test(text.toLowerCase())).length;
  const handoffs = lessonRows.filter(text => /handoff/.test(text.toLowerCase())).length;
  const totalUsd = [...models.values()].some(model => model.usd == null) ? null : [...models.values()].reduce((total, model) => total + model.usd, 0);
  const notHeld = [];
  if (!compactions) notHeld.push({ fact: 'compactions', why: 'no span or log row for this session mentions a compaction, so a count of 0 here means the store never recorded one, not that none happened' });
  if (!handoffs) notHeld.push({ fact: 'handoffs', why: 'no span or log row for this session mentions a handoff; handoffs are only visible in the handoff document and the card comments' });
  if (!stops.count) notHeld.push({ fact: 'stops', why: `the stop log at ${stops.file} has no entry for this session` });
  const record = {
    thread,
    card: card ?? null,
    minedAt,
    store: store ?? null,
    holds: Object.fromEntries(HOLDS.map(([fact, source]) => [fact, source])),
    notHeld,
    models: [...models.values()],
    modelChanges: { count: Math.max(0, askedChanges.length - 1), sequence: askedChanges },
    stages: [...perStage.values()].sort((a, b) => b.totalMs - a.totalMs).map(stage => ({ ...stage, totalMs: Math.round(stage.totalMs), maxMs: Math.round(stage.maxMs) })),
    tools: toolCounts,
    toolCalls: Object.values(toolCounts).reduce((total, n) => total + n, 0),
    stops,
    compactions,
    handoffs,
    tokens: Object.fromEntries([...tokens].map(([key, value]) => [key, Math.round(value)])),
    totals: {
      calls: [...models.values()].reduce((total, model) => total + Number(model.calls ?? 0), 0),
      usd: totalUsd,
      tokens: Math.round([...tokens.values()].reduce((total, value) => total + value, 0)),
    },
  };
  return record;
}

// mineSession reads one session out of the store and saves it in the kept cost
// ledger. It reports what the store holds and what it does not, because a zero
// for compactions or handoffs is the store being silent, not the session.
export async function mineSession(thread, { card, store = storeFile(), ledgerPath = ledgerFile(), stops = stopsFile(), dryRun = false, minedAt = new Date().toISOString() } = {}) {
  const opened = await openStore(store, 'READ_ONLY');
  if (opened.busy) return { status: 'busy', ...opened.busy, thread };
  let record;
  let costRows = [];
  let requestedRows = [];
  try {
    const connection = await opened.instance.connect();
    const rows = async sql => (await connection.runAndReadAll(sql)).getRowObjectsJson();
    // The scorecard reads the ledger when the store is too big to copy, so a
    // mined session keeps the same per-minute cost rows that exportLedger writes.
    costRows = await readRows(connection, METRIC_QUERY(thread));
    requestedRows = await readRows(connection, REQUESTED_QUERY(thread));
    const session = SESSION_QUERIES(thread);
    record = buildSessionRecord({
      thread,
      card,
      answered: await rows(session.answered),
      asked: await rows(session.asked),
      stages: await rows(session.stages),
      tools: await rows(session.tools),
      stops: readStops(thread, stops),
      lessonSpans: await rows(session.lessonSpans),
      lessonLogs: await rows(session.lessonLogs),
      minedAt,
      store: { file: store, bytes: storeBytes(store), tables: PRUNED_TABLES },
    });
  } finally {
    opened.instance.closeSync?.();
  }
  record.card = card ?? readLedger(ledgerPath).sessions?.[thread]?.card ?? null;
  if (!dryRun) writeJsonAtomic(ledgerPath, recordSession(mergeLedger(readLedger(ledgerPath), costRows, requestedRows), record));
  return { status: dryRun ? 'dry-run' : 'ok', thread, card: record.card, ledger: ledgerPath, record, costRows: costRows.length };
}

// deletePayloads removes the rows that carry this session's tool inputs and
// outputs. It refuses unless the session was mined and its card has a retro:
// the numbers go first, the lesson goes first, then the payloads.
export async function deletePayloads(thread, { card, store = storeFile(), ledgerPath = ledgerFile(), retrosDir = retrosFolder(), dryRun = false } = {}) {
  const ledger = readLedger(ledgerPath);
  const refusal = deletionRefusal(thread, { ledger, retrosDir, card });
  if (refusal) return { status: 'refused', thread, ...refusal };
  const mined = ledger.sessions[thread];
  const bytesBefore = storeBytes(store);
  const opened = await openStore(store);
  if (opened.busy) return { status: 'busy', ...opened.busy, thread };
  const counts = {};
  try {
    const connection = await opened.instance.connect();
    for (const table of PRUNED_TABLES) {
      const exists = Number((await connection.runAndReadAll(`select count(*) as n from duckdb_tables() where table_name = ${sqlText(table)}`)).getRowObjectsJson()[0].n);
      if (!exists) {
        counts[table] = 0;
        continue;
      }
      if (dryRun) {
        counts[table] = Number((await connection.runAndReadAll(`select count(*) as n from ${table} where threadId = ${sqlText(thread)}`)).getRowObjectsJson()[0].n);
        continue;
      }
      const before = Number((await connection.runAndReadAll(`select count(*) as n from ${table} where threadId = ${sqlText(thread)}`)).getRowObjectsJson()[0].n);
      await connection.run(`delete from ${table} where threadId = ${sqlText(thread)}`);
      const after = Number((await connection.runAndReadAll(`select count(*) as n from ${table} where threadId = ${sqlText(thread)}`)).getRowObjectsJson()[0].n);
      counts[table] = before - after;
    }
  } finally {
    opened.instance.closeSync?.();
  }
  return {
    status: dryRun ? 'dry-run' : 'ok',
    thread,
    card: mined?.card ?? card,
    retro: retroFile(mined?.card ?? card, { retrosDir }),
    deleted: counts,
    bytesBefore,
    bytesAfter: dryRun ? bytesBefore : storeBytes(store),
  };
}

// Sessions the sweep may clean: mined, has a retro, its card is Complete, and
// nothing holds it back on purpose. An empty Complete list means no card is
// known to be Complete, so nothing is clean — the safe reading of a missing
// answer, since the alternative deletes every retro'd session.
export function sweepPlan(ledger, { retrosDir = retrosFolder(), completeCards = [], keep = {}, dryRun = false } = {}) {
  const complete = new Set(completeCards);
  const clean = [];
  const kept = [];
  for (const [thread, record] of Object.entries(ledger.sessions ?? {})) {
    const hasRetro = retroExists(record.card, { retrosDir });
    const cardComplete = complete.has(record.card);
    if (keep[thread]) kept.push({ thread, card: record.card, why: `kept on purpose: ${keep[thread]}` });
    else if (hasRetro && cardComplete) clean.push({ thread, card: record.card });
    else kept.push({ thread, card: record.card, why: cardComplete ? 'no retro record' : 'its card is not Complete' });
  }
  return { dryRun, clean, kept };
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
      answer.sessionsMined = Object.keys(readLedger().sessions ?? {}).length;
    } finally {
      opened.instance.closeSync?.();
    }
  }
  return answer;
}

// Compaction is where the disk space comes back. It refuses when the copy would
// not fit, because a half-written copy beside a 22 GB store is how a disk dies.
export async function compactStore({ dryRun = false, store = storeFile() } = {}) {
  if (!existsSync(store)) return { status: 'missing', store };
  const before = storeBytes(store);
  const room = freeBytes(dirname(store));
  const probe = await openStore(store, 'READ_ONLY');
  if (probe.busy) return { status: 'busy', ...probe.busy, store, bytes: before };
  probe.instance.closeSync?.();
  if (!compactionFits(before, room)) {
    return { status: 'no-room', store, bytes: before, room, needed: Math.ceil(before / 2) + MARGIN_BYTES };
  }
  const compacted = dryRun ? null : await compact(store);
  const finalBytes = dryRun ? before : storeBytes(store);
  const entry = { at: new Date().toISOString(), store, dryRun, bytesBefore: before, bytesAfter: finalBytes, compactedBytes: compacted, freeBefore: room, freeAfter: freeBytes(dirname(store)) };
  if (!dryRun) entry.report = appendReport(entry);
  return { status: dryRun ? 'dry-run' : 'ok', ...entry };
}

export async function sweep({ dryRun = false, store = storeFile(), ledgerPath = ledgerFile(), retrosDir = retrosFolder(), completeCards = [], keep = {} } = {}) {
  const plan = sweepPlan(readLedger(ledgerPath), { retrosDir, completeCards, keep, dryRun });
  const deleted = [];
  for (const item of plan.clean) {
    const answer = await deletePayloads(item.thread, { store, ledgerPath, retrosDir, dryRun });
    deleted.push({ thread: item.thread, card: item.card, status: answer.status, deleted: answer.deleted ?? null });
    if (answer.status === 'busy') return { status: 'busy', ...answer, store, plan, deleted };
  }
  const compacted = await compactStore({ dryRun, store });
  return { status: compacted.status, store, plan, deleted, compact: compacted };
}

function usage() {
  return [
    'usage: node scripts/trace-store.mjs status',
    '       node scripts/trace-store.mjs ledger',
    '       node scripts/trace-store.mjs mine <thread> [--card JUL-276] [--dry-run]',
    '       node scripts/trace-store.mjs delete <thread> [--card JUL-276] [--dry-run]',
    '       node scripts/trace-store.mjs compact [--dry-run]',
    '       node scripts/trace-store.mjs sweep [--complete JUL-1,JUL-2] [--dry-run] [--wait-for-lock [--minutes 180]]',
  ].join('\n');
}

async function main(argv) {
  const [command, ...rest] = argv;
  const flag = name => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1];
  };
  const thread = rest.find(arg => !arg.startsWith('--') && arg !== flag('--card'));
  const dryRun = rest.includes('--dry-run');
  let answer;
  if (command === 'status') answer = await status();
  else if (command === 'ledger') {
    answer = await exportLedger();
    if (answer.status === 'busy') answer.note = 'a Mastra Code session holds the trace store; the ledger keeps the rows from the last run that could read it';
  } else if (command === 'mine' || command === 'delete') {
    if (!thread) throw new Error(`${command} needs a thread id`);
    answer = command === 'mine' ? await mineSession(thread, { card: flag('--card'), dryRun }) : await deletePayloads(thread, { card: flag('--card'), dryRun });
  } else if (command === 'compact') {
    answer = await compactStore({ dryRun });
    if (answer.status === 'no-room') answer.note = `not enough room to compact: ${gb(answer.bytes)} store needs about ${gb(answer.needed)} free, ${gb(answer.room)} is free`;
    if (answer.status === 'ok') answer.note = `${mb(answer.bytesBefore)} → ${mb(answer.bytesAfter)} on disk`;
  } else if (command === 'sweep') {
    const completeCards = (flag('--complete') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const waitMinutes = Number(flag('--minutes') ?? (rest.includes('--wait-for-lock') ? 180 : 0));
    if (!Number.isFinite(waitMinutes) || waitMinutes < 0) throw new Error('--minutes needs a number (0 or more)');
    // A live session holds an exclusive lock for hours, so the sweep can be told to
    // wait for it rather than report busy and leave the store at 22.6 GB.
    const deadline = Date.now() + waitMinutes * 60_000;
    for (;;) {
      answer = await sweep({ dryRun, completeCards });
      if (answer.status !== 'busy' || Date.now() >= deadline) break;
      await sleep(30_000);
    }
    if (answer.status === 'busy') answer.note = `a Mastra Code session holds the trace store${answer.pid ? ` (PID ${answer.pid})` : ''}; this run waited ${waitMinutes} min and changed nothing`;
    if (answer.compact?.status === 'no-room') answer.note = `not enough room to compact: ${gb(answer.compact.bytes)} store needs about ${gb(answer.compact.needed)} free, ${gb(answer.compact.room)} is free`;
    if (answer.compact?.status === 'ok') answer.note = `${mb(answer.compact.bytesBefore)} → ${mb(answer.compact.bytesAfter)} on disk`;
    if (!completeCards.length) answer.note = 'no --complete list, so no card is known to be Complete and nothing was cleaned';
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
