#!/usr/bin/env node
// Keeps Mastra Code's trace store (observability.duckdb) from filling the disk,
// and writes the per-session numbers the scorecard reads.
//
//   node scripts/trace-store.mjs status
//   node scripts/trace-store.mjs ledger
//   node scripts/trace-store.mjs mine <thread> [--dry-run]
//   node scripts/trace-store.mjs sweep [--dry-run] [--census <file>] [--no-comment] [--wait-for-lock [--minutes 180]]
//
// The sweep is the only thing that deletes payloads. One run reads every session
// in mastra.db, mines each into the cost ledger, cleans the sessions the census
// doc allows, compacts the file when the freed room is worth it, and comments the
// result on JUL-276. Nothing deletes on a timer, and no other code path deletes:
// a second path is how an unreviewed script on the server once held the store
// while it threw away a live session's payloads.
//
// Why the ledger exists: DuckDB allows one process to hold the file, so a running
// Mastra Code session blocks every other reader and the scorecard had no cost to
// show. Mining copies a session's numbers into the ledger, which outlives the rows
// they came from.
//
// Deleting by age is gone: a session is deleted because it was learned from, not
// because it is old. Any run that finds the store held reports that and exits 0,
// so a run during a session is not an alarm.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRUNED_TABLES = ['span_events', 'log_events'];
const LEDGER_VERSION = 2;
const MARGIN_BYTES = 512 * 1024 * 1024;
const TOOL_STAGES = ['tool_call', 'tool_action'];
const LESSON_PATTERN = 'compact|handoff';
const SWEEP_CARD = 'JUL-276';

export function storeFile(env = process.env) {
  return env.MASTRA_OBSERVABILITY_DB_PATH || join(env.MASTRA_APP_DATA_DIR || join(homedir(), '.local', 'share', 'mastracode'), 'observability.duckdb');
}

export function dbFile(env = process.env) {
  return env.MASTRA_DB_PATH || join(env.MASTRA_APP_DATA_DIR || join(homedir(), '.local', 'share', 'mastracode'), 'mastra.db');
}

// Every session Mastra Code recorded. The trace store only holds the sessions that
// produced spans, and the ones that produced none still need a mined record before
// a sweep may pass them by, so the list comes from the thread store instead.
export function listSessions(file = dbFile()) {
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('select id, title, updatedAt from mastra_threads order by updatedAt').all()
      .map(row => ({ thread: row.id, title: row.title ?? null, updatedAt: row.updatedAt ?? null }));
  } finally {
    db.close();
  }
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

// The census doc is the reviewed list every deletion rule reads: which cards are
// Complete, which session belongs to which card, which sessions Todd approved
// deleting without a retro because they never named a card, and which sessions are
// held back on purpose. Each of those is a line in the doc, so widening what may be
// deleted is a reviewed diff instead of a code change.
export function censusFile(env = process.env) {
  return env.JULIA_CENSUS || join(retrosFolder(env), 'census-2026-10-29.md');
}

const APPROVAL_HEADING = /^#{2,6} Approved to delete without a retro\b.*$/m;
const HOLD_HEADING = /^#{2,6} Held back on purpose\b.*$/m;
const COMPLETE_WITHOUT_SESSION = /^#{2,6} Complete cards with no session\b.*$/m;
const OPEN_CARD_HEADING = /^#{2,6} Sessions on a card that is not Complete\b.*$/m;

const THREAD_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// A section runs from its heading to the next heading of any level, so an id
// quoted in another section never counts as a fact of this one.
function section(text, heading) {
  const found = heading.exec(text);
  if (!found) return '';
  const rest = text.slice(found.index + found[0].length);
  const next = /^#{1,6} /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// An entry is a bullet, because prose in the same section names files and cards
// too; only the list's first token is an id.
function bullets(text) {
  const ids = [];
  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*]\s+`?([^\s`]+)`?/.exec(line);
    if (bullet) ids.push(bullet[1]);
  }
  return ids;
}

export function approvedWithoutRetro(file = censusFile()) {
  if (!existsSync(file)) return new Set();
  return new Set(bullets(section(readFileSync(file, 'utf8'), APPROVAL_HEADING)));
}

// A held session outranks every other rule, including a written retro: the reason
// beside it says why the record that exists does not cover the whole session.
export function heldOnPurpose(file = censusFile()) {
  if (!existsSync(file)) return new Map();
  const holds = new Map();
  for (const line of section(readFileSync(file, 'utf8'), HOLD_HEADING).split('\n')) {
    // The reason is optional: a bullet that is only an id still holds the session.
    const bullet = /^\s*[-*]\s+`?([0-9a-f-]{36})`?\s*(?:[—–]|--?)?\s*(.*)$/i.exec(line);
    if (!bullet) continue;
    holds.set(bullet[1], bullet[2].trim() || 'held back on purpose, with no reason written');
  }
  return holds;
}

export function readCensus(file = censusFile()) {
  const facts = { complete: new Set(), cards: new Map(), approved: new Set(), hold: new Map() };
  if (!existsSync(file)) return facts;
  const text = readFileSync(file, 'utf8');
  // | JUL-284 | 2026-10-29 | `13351dad-…` "Handoff doc…" | 2026-10-29 | first request | jul-284.md |
  // The second column is the date the card went Complete, and the third starts
  // with the session id, so the row is read whole rather than cell by cell.
  for (const line of text.split('\n')) {
    const row = /^\|\s*(JUL-\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})[^|]*\|[^|]*?(?:`([0-9a-f-]{36})`|(?<![0-9a-f-])([0-9a-f-]{36})(?![0-9a-f-]))/i.exec(line);
    if (!row) continue;
    facts.complete.add(row[1]);
    facts.cards.set(row[3] ?? row[4], row[1]);
  }
  for (const card of section(text, COMPLETE_WITHOUT_SESSION).match(/JUL-\d+/g) ?? []) facts.complete.add(card);
  // A card named under the open-card heading is still open, whatever else the
  // doc says about it; this line is what keeps a JUL-276 session while its card
  // is in Implementation. Its bullets name the card before the session id, so the
  // session keeps a card to report in the plan even though the card is not
  // Complete.
  const open = section(text, OPEN_CARD_HEADING);
  for (const card of open.match(/JUL-\d+/g) ?? []) facts.complete.delete(card);
  for (const line of open.split('\n')) {
    const bullet = /^\s*[-*]\s+(JUL-\d+)\s+`?([0-9a-f-]{36})`?/i.exec(line);
    if (bullet) facts.cards.set(bullet[2], bullet[1]);
  }
  facts.approved = approvedWithoutRetro(file);
  facts.hold = heldOnPurpose(file);
  return facts;
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

// Two ways a session may lose its payloads: its own card has a retro, or it never
// named a card and Todd approved it in the census doc. A hold in the census doc
// outranks both. Nothing here accepts a card from the caller: the card the session
// itself named is the only one that can open the gate, because a card passed in
// from outside once let a sweep delete a live session under a finished card's retro.
export function deletionRefusal(thread, { ledger = readLedger(), retrosDir = retrosFolder(), census = censusFile() } = {}) {
  const record = ledger.sessions?.[thread];
  if (!record) {
    return { code: 'not-mined', message: `refusing to delete thread ${thread}: it was never mined, so nothing about it is kept yet; run: node scripts/trace-store.mjs mine ${thread} (the card it reports comes from ${census}, never from a flag)` };
  }
  const hold = heldOnPurpose(census).get(thread);
  if (hold) {
    return { code: 'held', message: `refusing to delete thread ${thread}: ${census} holds it back on purpose — ${hold}` };
  }
  if (!record.card) {
    if (approvedWithoutRetro(census).has(thread)) return null;
    return { code: 'no-card', message: `refusing to delete thread ${thread}: the mined record names no card and the session is not on the approved list in ${census}, so nothing stands in for a retro` };
  }
  if (!retroExists(record.card, { retrosDir })) {
    return { code: 'no-retro', message: `refusing to delete thread ${thread}: ${record.card} has no retro at ${retroFile(record.card, { retrosDir })}; the payloads wait until the lesson is written` };
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

// DuckDB sizes its buffer pool at 85% of the machine's memory, which on this
// server is 6 GB of 7 GB. The sweep mined 49 sessions inside that budget at 02:51
// on 30 October and the kernel killed it at 6.15 GB the moment it started writing,
// before it deleted a row. A budget the machine can hold, with anything that does
// not fit spilling to the temp directory beside the store, keeps a deep read of a
// 22 GB file from deciding how much memory the process needs.
export function openOptions(file, mode) {
  const limit = Math.min(2048, Math.max(256, Math.floor(totalmem() / 2 ** 20 / 3)));
  return { ...(mode ? { access_mode: mode } : {}), memory_limit: `${limit}MB`, temp_directory: `${file}.tmp` };
}

export async function openStore(file, mode) {
  const { DuckDBInstance } = duckdb();
  try {
    const instance = await DuckDBInstance.create(file, openOptions(file, mode));
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

// mineSessions reads every given session out of the store through one connection
// and saves each in the kept cost ledger. It reports what the store holds and what
// it does not, because a zero for compactions or handoffs is the store being
// silent, not the session. One connection for a whole sweep: 49 opens of a 22 GB
// file would checkpoint it 49 times.
export async function mineSessions(threads, { cards = new Map(), store = storeFile(), ledgerPath = ledgerFile(), stops = stopsFile(), dryRun = false, minedAt = new Date().toISOString() } = {}) {
  const opened = await openStore(store, 'READ_ONLY');
  if (opened.busy) return { status: 'busy', ...opened.busy, store, threads: threads.length };
  const previous = readLedger(ledgerPath);
  const records = [];
  const costRows = [];
  const requestedRows = [];
  try {
    const connection = await opened.instance.connect();
    const rows = async sql => (await connection.runAndReadAll(sql)).getRowObjectsJson();
    for (const thread of threads) {
      // The scorecard reads the ledger when the store is too big to copy, so a
      // mined session keeps the same per-minute cost rows that exportLedger writes.
      costRows.push(...await readRows(connection, METRIC_QUERY(thread)));
      requestedRows.push(...await readRows(connection, REQUESTED_QUERY(thread)));
      const session = SESSION_QUERIES(thread);
      const record = buildSessionRecord({
        thread,
        // The card is the census doc's and nothing else's. A card left in the
        // ledger by an older run must not outlive the census that justified it,
        // because that is how a finished card's retro deletes a live session.
        card: cards.get(thread) ?? null,
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
      records.push(record);
    }
  } finally {
    opened.instance.closeSync?.();
  }
  const data = records.reduce((ledger, record) => recordSession(ledger, record), mergeLedger(previous, costRows, requestedRows));
  if (!dryRun) writeJsonAtomic(ledgerPath, data);
  return { status: dryRun ? 'dry-run' : 'ok', ledger: ledgerPath, store, written: !dryRun, threads: threads.length, costRows: costRows.length, records, data };
}

// mineSession is the one-session form, kept for reading a single store by hand.
// It takes the card from the census doc like every other path: there is no flag
// that can tell a session which card it was on.
export async function mineSession(thread, { census = censusFile(), ...opts } = {}) {
  const cards = readCensus(census).cards;
  const answer = await mineSessions([thread], { ...opts, cards });
  if (answer.status === 'busy') return { ...answer, thread };
  const record = answer.records[0];
  return { status: answer.status, thread, card: record?.card ?? null, ledger: answer.ledger, record, costRows: answer.costRows };
}

// deletePayloads removes the rows that carry this session's tool inputs and
// outputs. It refuses unless the session was mined and something stands in for
// the lesson: a retro for its card, or Todd's approval of the sessions that
// never named a card. The numbers go first, the lesson goes first, then the
// payloads.
export async function deletePayloads(thread, { store = storeFile(), ledgerPath = ledgerFile(), retrosDir = retrosFolder(), census = censusFile(), ledger, dryRun = false, instance } = {}) {
  // A dry run mines in memory and writes nothing, so the sweep hands the rows it
  // just mined in rather than making this read a ledger that is still empty.
  const minedLedger = ledger ?? readLedger(ledgerPath);
  const refusal = deletionRefusal(thread, { ledger: minedLedger, retrosDir, census });
  if (refusal) return { status: 'refused', thread, ...refusal };
  const mined = minedLedger.sessions[thread];
  // The refusal passed, so a session with no card got here on Todd's approval.
  const approved = !mined.card && approvedWithoutRetro(census).has(thread);
  const bytesBefore = storeBytes(store);
  // A dry run only counts rows, so it must not ask for the write lock a live
  // session holds. A caller with a store already open hands it in: opening the
  // 22 GB file once per session left 3.1 GB of DuckDB caches behind after 42 of
  // them on 30 October, and the kernel killed the run before it deleted a row.
  const opened = instance ? { instance } : await openStore(store, dryRun ? 'READ_ONLY' : undefined);
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
    if (!instance) opened.instance.closeSync?.();
  }
  return {
    status: dryRun ? 'dry-run' : 'ok',
    thread,
    card: mined?.card ?? null,
    approved,
    retro: approved ? null : retroFile(mined?.card, { retrosDir }),
    deleted: counts,
    bytesBefore,
    bytesAfter: dryRun ? bytesBefore : storeBytes(store),
  };
}

// Sessions the sweep may clean: mined, nothing in the census doc holding it back,
// and either its own card is Complete with a retro, or it never named a card and
// Todd approved it. A hold outranks both, and approval never stands in for a card
// the session itself named. The card comes from the census doc and nowhere else,
// including a card left in the ledger by an older run. A missing Complete list
// means no card is known to be Complete, so a card session is never clean — the
// safe reading of a missing answer, since the alternative deletes every retro'd
// session.
export function sweepPlan(ledger, { retrosDir = retrosFolder(), census = censusFile(), hold, dryRun = false } = {}) {
  const facts = readCensus(census);
  const complete = facts.complete;
  const held = hold ?? facts.hold;
  const clean = [];
  const kept = [];
  for (const thread of Object.keys(ledger.sessions ?? {})) {
    const card = facts.cards.get(thread) ?? null;
    if (held.has(thread)) {
      kept.push({ thread, card, why: `kept on purpose: ${held.get(thread)}` });
    } else if (!card) {
      if (facts.approved.has(thread)) clean.push({ thread, card: null, approved: true });
      else kept.push({ thread, card: null, why: 'no card, no retro, not on the approved list' });
    } else if (!complete.has(card)) {
      kept.push({ thread, card, why: 'its card is not Complete' });
    } else if (!retroExists(card, { retrosDir })) {
      kept.push({ thread, card, why: 'no retro record' });
    } else {
      clean.push({ thread, card });
    }
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
  // Copying 22 GB through an in-memory instance takes the same budget as reading
  // it, or the copy is what runs the machine out of memory.
  const instance = await DuckDBInstance.create(':memory:', openOptions(file));
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

// The sweep is the one path that deletes payloads. It mines every session it is
// given (all of mastra.db by default), decides from the census doc and the retros
// on disk, deletes the payloads of the sessions both allow, then compacts when the
// freed room is worth it. A dry run mines and prints the plan and touches nothing.
export async function sweep({ dryRun = false, store = storeFile(), ledgerPath = ledgerFile(), retrosDir = retrosFolder(), census = censusFile(), sessions, dbPath } = {}) {
  const facts = readCensus(census);
  const threads = sessions ?? listSessions(dbPath).map(session => session.thread);
  const mined = await mineSessions(threads, { cards: facts.cards, store, ledgerPath, dryRun });
  if (mined.status === 'busy') return { status: 'busy', ...mined, store };
  const plan = sweepPlan(mined.data, { retrosDir, census, hold: facts.hold, dryRun });
  const deleted = [];
  // One open for every session the plan cleans: the file is 22 GB, and an open per
  // session kept its caches and grew this process by 3.1 GB across 42 of them.
  const opened = plan.clean.length ? await openStore(store, dryRun ? 'READ_ONLY' : undefined) : { instance: null };
  if (opened.busy) return { status: 'busy', ...opened.busy, store, mined: { sessions: threads.length, mined: mined.records.length }, plan, deleted };
  try {
    for (const item of plan.clean) {
      const answer = await deletePayloads(item.thread, { store, ledgerPath, retrosDir, census, ledger: mined.data, dryRun, instance: opened.instance });
      deleted.push({ thread: item.thread, card: item.card, status: answer.status, deleted: answer.deleted ?? null });
      if (answer.status === 'busy') return { status: 'busy', ...answer, store, mined: { sessions: threads.length, mined: mined.records.length }, plan, deleted };
    }
  } finally {
    opened.instance?.closeSync?.();
  }
  // Compaction copies the whole store, so it only earns its time when rows went.
  if (!plan.clean.length) {
    return { status: 'ok', store, census, mined: { sessions: threads.length, mined: mined.records.length, written: mined.written }, plan, deleted, compact: null };
  }
  const compact = await compactStore({ dryRun, store });
  return {
    // A dry run that got this far did its job: nothing failed, so the run is ok
    // and the compact block carries the fact that it only looked.
    status: dryRun ? 'ok' : compact.status,
    store,
    census,
    mined: { sessions: threads.length, mined: mined.records.length, written: mined.written },
    plan,
    deleted,
    compact,
  };
}

// What goes on JUL-276 after a real run: the numbers a person reads without the
// terminal, and the reason each kept session was kept.
export function sweepComment(answer) {
  const { mined, plan, compact } = answer;
  const total = Object.values(answer.deleted).reduce((sum, entry) => sum + Object.values(entry.deleted ?? {}).reduce((n, rows) => n + rows, 0), 0);
  const lines = [
    `Trace store sweep: ${mined.sessions} session(s) mined, ${plan.clean.length} cleaned, ${plan.kept.length} kept.`,
    '',
  ];
  if (compact) {
    lines.push(
      `- Store: \`${answer.store}\`, ${mb(compact.bytesBefore)} before the deletion, ${mb(compact.bytesAfter)} after${compact.compactedBytes != null ? ` (compacted to ${mb(compact.compactedBytes)})` : ''}.`,
      `- Rows deleted: ${total} across ${PRUNED_TABLES.join(' and ')}; every cost row stays in the ledger.`,
      `- Disk: ${gb(compact.freeBefore)} free before, ${gb(compact.freeAfter)} free after.`,
    );
  } else {
    lines.push(`- Store: \`${answer.store}\`; nothing was deleted, so nothing was compacted.`);
  }
  if (plan.kept.length) {
    lines.push('', `Kept ${plan.kept.length}:`);
    for (const entry of plan.kept) lines.push(`- \`${entry.thread}\`${entry.card ? ` (${entry.card})` : ''} — ${entry.why}`);
  }
  return `${lines.join('\n')}\n`;
}

// The comment goes up through the wrapper that unlocks the Linear key, not by
// importing the client here: this module runs on the server without the env file.
function postSweepComment(body) {
  const file = join(dirname(reportFile()), `trace-sweep-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  writeFileSync(file, body);
  const answer = spawnSync(process.execPath, [join(REPO, 'scripts', 'julia-agents.mjs'), '--', join(REPO, 'scripts', 'linear-cli.mjs'), 'comment', SWEEP_CARD, '--file', file], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  return { card: SWEEP_CARD, file, exit: answer.status, output: `${answer.stdout ?? ''}${answer.stderr ?? ''}`.trim().slice(-400) };
}

function usage() {
  return [
    'usage: node scripts/trace-store.mjs status',
    '       node scripts/trace-store.mjs ledger',
    '       node scripts/trace-store.mjs mine <thread> [--dry-run]',
    '       node scripts/trace-store.mjs sweep [--dry-run] [--census <file>] [--no-comment] [--wait-for-lock [--minutes 180]]',
  ].join('\n');
}

async function main(argv) {
  const [command, ...rest] = argv;
  const flag = name => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1];
  };
  const thread = rest.find(arg => !arg.startsWith('--'));
  const dryRun = rest.includes('--dry-run');
  // A flag that looks like it sets a card is worse than no flag: `--card` once let a
  // caller name a session's card, and `--complete` once let one guess which cards were
  // done. Both are gone, so a run that still passes one is told instead of ignored.
  const unknown = rest.filter(arg => arg.startsWith('--') && !['--dry-run', '--census', '--no-comment', '--wait-for-lock', '--minutes'].includes(arg));
  if (unknown.length) throw new Error(`${unknown.join(' ')} is not an option: the card a session was on and the cards that are Complete come from ${censusFile()}, never from a flag`);
  let answer;
  if (command === 'status') answer = await status();
  else if (command === 'ledger') {
    answer = await exportLedger();
    if (answer.status === 'busy') answer.note = 'a Mastra Code session holds the trace store; the ledger keeps the rows from the last run that could read it';
  } else if (command === 'mine') {
    if (!thread) throw new Error('mine needs a thread id');
    answer = await mineSession(thread, { dryRun });
  } else if (command === 'sweep') {
    const census = flag('--census') ?? censusFile();
    const waitMinutes = Number(flag('--minutes') ?? (rest.includes('--wait-for-lock') ? 180 : 0));
    if (!Number.isFinite(waitMinutes) || waitMinutes < 0) throw new Error('--minutes needs a number (0 or more)');
    // A live session holds an exclusive lock for hours, so the sweep can be told to
    // wait for it rather than report busy and leave the store at 22.6 GB.
    const deadline = Date.now() + waitMinutes * 60_000;
    for (;;) {
      answer = await sweep({ dryRun, census });
      if (answer.status !== 'busy' || Date.now() >= deadline) break;
      await sleep(30_000);
    }
    if (answer.status === 'busy') answer.note = `a Mastra Code session holds the trace store${answer.pid ? ` (PID ${answer.pid})` : ''}; this run waited ${waitMinutes} min and changed nothing`;
    if (answer.compact?.status === 'no-room') answer.note = `not enough room to compact: ${gb(answer.compact.bytes)} store needs about ${gb(answer.compact.needed)} free, ${gb(answer.compact.room)} is free`;
    if (answer.compact?.status === 'ok') answer.note = `${mb(answer.compact.bytesBefore)} → ${mb(answer.compact.bytesAfter)} on disk`;
    if (dryRun && answer.plan) answer.note = `dry run: ${answer.mined.sessions} session(s) read and planned, nothing written, nothing deleted`;
    if (!dryRun && answer.plan && !answer.deleted.length) answer.note = 'nothing was clean to delete, so nothing was deleted and nothing was compacted';
    if (dryRun && !answer.plan) answer.note = `dry run: nothing was mined, because ${answer.status}`;
    if (!dryRun && answer.plan && !rest.includes('--no-comment')) answer.comment = postSweepComment(sweepComment(answer));
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
