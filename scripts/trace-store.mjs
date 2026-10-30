#!/usr/bin/env node
// Keeps Mastra Code's trace store (observability.duckdb) small one slice at a time.
//
//   node scripts/trace-store.mjs status
//   node scripts/trace-store.mjs clean <session id> [--card JUL-284]
//
// The last step of a slice's retro runs `clean` for the session that did the slice. It
// keeps that session's `metric_events` rows — the per-call tokens and cost the scorecard
// prices a card from — deletes its `span_events` and `log_events` rows, which carry the
// prompt payloads and are nearly all of the file, and then checkpoints the store so DuckDB
// folds the write-ahead log in and drops the blocks the delete freed. It takes any session
// id: nothing here reads a list of sessions or a dated file, so a session loses its detail
// when a retro has learned from it, and not before.
//
// A checkpoint rewrites blocks in place and truncates the tail, so holes in the middle of a
// file stay until a dense copy is written and the room a cleanup gives back can be less than
// the round added. When the file is still over ALARM_BYTES afterwards, `clean` comments on
// the slice's card: the store size, and that the round was too big.
import { existsSync, mkdirSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DETAIL_TABLES = ['span_events', 'log_events'];
const ALARM_BYTES = 15 * 1024 ** 3;
const ALARM_CARD = 'JUL-276';
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function storeFile(env = process.env) {
  return env.MASTRA_OBSERVABILITY_DB_PATH || join(env.MASTRA_APP_DATA_DIR || join(homedir(), '.local', 'share', 'mastracode'), 'observability.duckdb');
}

function stateDir(env = process.env) {
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'julia');
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

function duckdb() {
  const dir = resolve(REPO, 'node_modules');
  const candidates = [join(dir, '@duckdb', 'node-api'), join(homedir(), '.local', 'lib', 'mastracode-program', 'node_modules', '@duckdb', 'node-api')];
  const found = candidates.find(p => existsSync(join(p, 'package.json')));
  if (!found) throw new Error('no @duckdb/node-api package found to read the trace store');
  return createRequire(join(found, 'package.json'))('@duckdb/node-api');
}

// DuckDB sizes its buffer pool at 85% of the machine's memory, which on this server is
// 6 GB of 7 GB. The kernel killed a run that read every session at 6.15 GB, before it
// deleted a row. A budget the machine can hold, with anything that does not fit spilling
// to the temp directory beside the store, keeps a deep read of a big file from deciding
// how much memory the process needs.
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

const gb = bytes => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export function alarmComment(answer) {
  const deleted = DETAIL_TABLES.map(table => `${answer.deleted[table]} ${table} rows`).join(' and ');
  return [
    `The trace store is ${gb(answer.bytesAfter)} after the ${answer.card} cleanup, over the ${gb(ALARM_BYTES)} it is allowed to reach. The round was too big.`,
    '',
    `- Store: ${answer.store}`,
    `- Kept ${answer.kept} \`metric_events\` rows and deleted ${deleted}, then checkpointed.`,
    `- This round: ${gb(answer.bytesBefore)} → ${gb(answer.bytesAfter)}.`,
    '- Nothing failed and nothing was left out: a checkpoint rewrites blocks in place, so the room a cleanup gives back can be less than the round added.',
  ].join('\n');
}

// The wrapper runs its argument through `op run`, and the client is not executable in a
// fresh checkout, so the client is named as a program for this same node.
export function commentArgs(card, file) {
  return [join(REPO, 'scripts', 'julia-agents.mjs'), '--', process.execPath, join(REPO, 'scripts', 'linear-cli.mjs'), 'comment', card, '--file', file];
}

// A comment on the card is how a size reaches Todd: it is the channel he reads, and a body
// written to a file that was never posted notifies nobody, so the spawn's own answer says
// whether it landed.
function postCardComment(body, card) {
  mkdirSync(stateDir(), { recursive: true });
  const file = join(stateDir(), `trace-alarm-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  writeFileSync(file, body);
  const run = spawnSync(process.execPath, commentArgs(card, file), { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  return { posted: run.status === 0, card, file, said: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-1)[0]?.slice(0, 200) ?? '' };
}

// One session's detail goes, its cost rows stay, and the file is checkpointed afterwards.
// `post` is a seam: a test never posts to Linear.
export async function cleanSession(thread, { store = storeFile(), card = ALARM_CARD, post = postCardComment, alarmBytes = ALARM_BYTES } = {}) {
  if (!THREAD_ID.test(String(thread))) throw new Error(`"${thread}" is not a session id: clean needs the UUID of the session the slice ran in`);
  if (!existsSync(store)) return { status: 'missing', store, thread };
  const bytesBefore = storeBytes(store);
  const opened = await openStore(store);
  if (opened.busy) return { status: 'busy', ...opened.busy, store, thread, bytes: bytesBefore };
  const kept = {};
  const deleted = {};
  try {
    const connection = await opened.instance.connect();
    const id = `'${thread}'`;
    const count = async table => Number((await connection.runAndReadAll(`select count(*) as n from ${table} where threadId = ${id}`)).getRowObjectsJson()[0].n);
    kept.metric_events = await count('metric_events');
    await connection.run('set threads = 1');
    for (const table of DETAIL_TABLES) {
      deleted[table] = await count(table);
      await connection.run(`delete from ${table} where threadId = ${id}`);
    }
    await connection.run('checkpoint');
  } finally {
    opened.instance.closeSync?.();
  }
  const answer = {
    status: 'ok',
    store,
    thread,
    card,
    kept: kept.metric_events,
    deleted,
    bytesBefore,
    bytesAfter: storeBytes(store),
    freeAfter: freeBytes(dirname(store)),
  };
  if (!answer.kept) answer.note = 'this session left no metric_events rows, so nothing about its cost is kept by this cleanup';
  if (answer.bytesAfter > alarmBytes) answer.comment = post(alarmComment(answer), card);
  return answer;
}

export async function status() {
  const file = storeFile();
  const bytes = storeBytes(file);
  const opened = await openStore(file, 'READ_ONLY');
  const answer = { store: file, bytes, size: gb(bytes), free: gb(freeBytes(dirname(file))), busy: Boolean(opened.busy), holderPid: opened.busy?.pid ?? null };
  if (!opened.busy) {
    try {
      const connection = await opened.instance.connect();
      const tables = (await connection.runAndReadAll('select table_name from duckdb_tables() order by table_name')).getRowObjectsJson().map(r => r.table_name);
      const rows = {};
      for (const table of tables) rows[table] = Number((await connection.runAndReadAll(`select count(*) as n from ${table}`)).getRowObjectsJson()[0].n);
      answer.tables = rows;
    } finally {
      opened.instance.closeSync?.();
    }
  }
  return answer;
}

function usage() {
  return [
    'usage: node scripts/trace-store.mjs status',
    '       node scripts/trace-store.mjs clean <session id> [--card JUL-284]',
  ].join('\n');
}

// `clean <id>` with no `--card` shipped reading its own session id as a flag value and
// refusing the call, so the shape of the command is read in one place a test can call.
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const words = [];
  while (rest.length) {
    const arg = rest.shift();
    if (arg.startsWith('--')) {
      if (arg !== '--card') throw new Error(`${arg} is not an option.\n${usage()}`);
      if (!rest.length) throw new Error('--card needs a card, such as JUL-284');
      flags.card = rest.shift();
    } else words.push(arg);
  }
  return { command, flags, words };
}

async function main(argv) {
  const { command, flags, words } = parseArgs(argv);
  let answer;
  if (command === 'status') answer = await status();
  else if (command === 'clean') {
    if (words.length !== 1) throw new Error('clean needs one session id');
    answer = await cleanSession(words[0], flags.card ? { card: flags.card } : {});
    const notes = [answer.note].filter(Boolean);
    if (answer.status === 'busy') notes.push(`a Mastra Code session holds the trace store${answer.pid ? ` (PID ${answer.pid})` : ''}; nothing was changed`);
    if (answer.status === 'ok') notes.push(`${gb(answer.bytesBefore)} → ${gb(answer.bytesAfter)} on disk`);
    if (notes.length) answer.note = notes.join('; ');
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
