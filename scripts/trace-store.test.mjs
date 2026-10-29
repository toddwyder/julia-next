import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compactionFits, exportLedger, isLockedMessage, ledgerFile, lockOwnerFromError, mergeLedger, prune, readLedger, retentionCutoff, status, storeFile, storeBytes } from './trace-store.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const duckdbDir = [
  join(REPO, 'node_modules', '@duckdb', 'node-api'),
  join(process.env.HOME ?? '', '.local', 'lib', 'mastracode-program', 'node_modules', '@duckdb', 'node-api'),
].find(dir => existsSync(join(dir, 'package.json')));
// The DuckDB client ships with the Mastra Code program, not this repo. CI has neither, so
// the tests that open a real store skip there instead of failing: the pure rules still run.
const noDuckdb = duckdbDir ? false : 'no @duckdb/node-api on this machine, so there is no store to open';
const { DuckDBInstance } = duckdbDir ? createRequire(join(duckdbDir, 'package.json'))('@duckdb/node-api') : {};

// The five tables Mastra Code's observability store creates, cut down to the
// columns this job touches. The real store is DuckDB's own schema; these tests
// run the same delete, export and copy statements against a real DuckDB file.
const SCHEMA = [
  `create table span_events (timestamp timestamp not null, traceId varchar, spanId varchar, entityName varchar, threadId varchar,
     spanType varchar, endedAt timestamp, attributes json, input json, output json, primary key (spanId))`,
  `create table metric_events (timestamp timestamp not null, metricId varchar primary key, threadId varchar, entityName varchar,
     provider varchar, model varchar, name varchar, value double, estimatedCost double)`,
  `create table log_events (timestamp timestamp not null, logId varchar primary key, level varchar, message varchar)`,
];

const daysAgo = days => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

const span = (at, id, megabytes = 1, thread = 'thread-1') =>
  `insert into span_events (timestamp, spanId, entityName, threadId, spanType, attributes, input, output)
   values (timestamp '${at}', '${id}', 'Code Agent', '${thread}', 'processor_run', null, '{"body":"${'x'.repeat(Math.round(megabytes * 1024 * 1024))}"}', null)`;
const metric = (at, id, name, value, cost, thread = 'thread-1') =>
  `insert into metric_events (timestamp, metricId, threadId, entityName, provider, model, name, value, estimatedCost)
   values (timestamp '${at}', '${id}', '${thread}', 'Code Agent', 'commandcode.chat', 'deepseek/deepseek-v4.1-flash', '${name}', ${value}, ${cost})`;

async function runChild(code) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`fixture script exited with ${code}`))));
  });
}

const ENV = ['XDG_STATE_HOME', 'MASTRA_OBSERVABILITY_DB_PATH', 'MASTRA_TRACE_LEDGER'];

async function withStore(t, rows) {
  const dir = mkdtempSync(join(tmpdir(), 'trace-store-'));
  const saved = Object.fromEntries(ENV.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.XDG_STATE_HOME = join(dir, 'state');
  const file = join(dir, 'observability.duckdb');
  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  for (const sql of SCHEMA) await connection.run(sql);
  for (const row of rows) await connection.run(row);
  instance.closeSync();
  process.env.MASTRA_OBSERVABILITY_DB_PATH = file;
  return { dir, file, ledger: join(dir, 'state', 'julia', 'trace-costs.json') };
}

test('the ledger sits beside the stop log and follows MASTRA_TRACE_LEDGER', () => {
  assert.equal(ledgerFile({ XDG_STATE_HOME: '/x' }), '/x/julia/trace-costs.json');
  assert.equal(ledgerFile({ MASTRA_TRACE_LEDGER: '/tmp/l.json' }), '/tmp/l.json');
  assert.equal(storeFile({ MASTRA_OBSERVABILITY_DB_PATH: '/tmp/o.duckdb' }), '/tmp/o.duckdb');
  assert.match(storeFile({ MASTRA_APP_DATA_DIR: '/data' }), /^\/data\/observability\.duckdb$/);
});

test('a lock refusal names the process holding the store', () => {
  const refusal = 'IO Error: Could not set lock on file "/home/ubuntu/.local/share/mastracode/observability.duckdb": Conflicting lock is held in /opt/node-v24.14.1/bin/node (PID 38968). See also https://duckdb.org/docs/stable/connect/concurrency';
  assert.deepEqual(lockOwnerFromError(refusal), { pid: 38968 });
  assert.equal(isLockedMessage(refusal), true);
  assert.equal(lockOwnerFromError('Catalog Error: Table with name t does not exist'), null);
});

test('the retention cutoff is keep-days back from now', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  assert.equal(retentionCutoff(now, 14).toISOString(), '2026-10-15T12:00:00.000Z');
  assert.equal(retentionCutoff(now, 0).toISOString(), now.toISOString());
});

test('compaction needs room for the rows that survive, not the whole file', () => {
  const store = 20 * 1024 ** 3;
  assert.equal(compactionFits(store, 11 * 1024 ** 3), true);
  assert.equal(compactionFits(store, 9 * 1024 ** 3), false);
});

test('merging a second export keeps one row per bucket and refreshes its value', () => {
  const first = { rows: [{ threadId: 't', at: 1, entityName: 'Code Agent', provider: 'p', model: 'm', name: 'mastra_model_total_input_tokens', value: 10, estimatedCost: 0.1 }], requested: [{ threadId: 't', at: 5, entityName: 'Code Agent' }] };
  const merged = mergeLedger(first, [{ threadId: 't', at: 1, entityName: 'Code Agent', provider: 'p', model: 'm', name: 'mastra_model_total_input_tokens', value: 12, estimatedCost: 0.12 }]);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.rows[0].value, 12);
  assert.equal(merged.requested.length, 1);
});

test('prune deletes aged spans and logs, keeps the cost rows, and gives the disk space back', { skip: noDuckdb }, async (t) => {
  const { file, ledger, dir } = await withStore(t, [
    span(daysAgo(20), 'old-1'),
    span(daysAgo(19), 'old-2', 2),
    span(daysAgo(1), 'new-1', 0.01),
    `insert into log_events (timestamp, logId, level, message) values (timestamp '${daysAgo(20)}', 'log-old', 'info', 'old')`,
    `insert into log_events (timestamp, logId, level, message) values (timestamp '${daysAgo(1)}', 'log-new', 'info', 'new')`,
    metric(daysAgo(20), 'metric-old', 'mastra_model_total_input_tokens', 1000, 0.5),
    metric(daysAgo(1), 'metric-new', 'mastra_model_total_output_tokens', 10, 0.01),
  ]);
  const before = storeBytes(file);

  const answer = await prune({ keepDays: 14 });

  assert.equal(answer.status, 'ok');
  assert.deepEqual(answer.deleted, { span_events: 2, log_events: 1 });
  assert.ok(answer.bytesAfter < before, `expected the file to shrink from ${before}, got ${answer.bytesAfter}`);
  assert.equal(statSync(file).size, answer.bytesAfter);
  assert.equal(existsSync(`${file}.compact`), false, 'the copy is renamed into place, not left behind');

  // The cost rows and the rows inside the window survive the delete and the copy.
  const instance = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' });
  const connection = await instance.connect();
  const rows = async sql => (await connection.runAndReadAll(sql)).getRowObjectsJson();
  assert.equal((await rows('select count(*) as n from span_events'))[0].n, '1');
  assert.equal((await rows('select count(*) as n from log_events'))[0].n, '1');
  assert.equal((await rows('select count(*) as n from metric_events'))[0].n, '2');
  assert.equal((await rows("select constraint_type from duckdb_constraints() where table_name = 'metric_events' and constraint_type = 'PRIMARY KEY'")).length, 1);
  instance.closeSync();

  // The cost survives the pruning in the ledger, with the minute it happened.
  const saved = readLedger(ledger);
  assert.deepEqual(saved.rows.map(r => [r.name, r.value, r.estimatedCost]).sort(), [
    ['mastra_model_total_input_tokens', 1000, 0.5],
    ['mastra_model_total_output_tokens', 10, 0.01],
  ]);
  assert.equal(new Date(Number(saved.rows[0].at)).getUTCSeconds(), 0, 'bucketed to the minute');

  const report = JSON.parse(readFileSync(join(dir, 'state', 'julia', 'trace-store-report.json'), 'utf8'));
  assert.equal(report.runs.at(-1).bytesAfter, answer.bytesAfter);
  assert.equal(report.runs.at(-1).deleted.span_events, 2);
});

test('a held store is reported busy and writes no ledger rather than a zero', { skip: noDuckdb }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trace-store-'));
  const saved = Object.fromEntries(ENV.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.XDG_STATE_HOME = join(dir, 'state');
  const file = join(dir, 'observability.duckdb');
  process.env.MASTRA_OBSERVABILITY_DB_PATH = file;
  const ledger = join(dir, 'state', 'julia', 'trace-costs.json');
  // The fixture is written by another process too: DuckDB keeps a handle on a
  // file this process has opened before, so the parent must never touch it.
  await runChild(`
    const { DuckDBInstance } = require(${JSON.stringify(duckdbDir)});
    (async () => {
      const instance = await DuckDBInstance.create(${JSON.stringify(file)});
      const connection = await instance.connect();
      for (const sql of ${JSON.stringify(SCHEMA)}) await connection.run(sql);
      await connection.run(\`${metric(daysAgo(1), 'm1', 'mastra_model_total_input_tokens', 100, 0.25)}\`);
      instance.closeSync();
    })();
  `);
  // A live Mastra Code session holds the store from its own process; only a
  // second process reproduces the refusal this job has to recognise.
  const holder = spawn(process.execPath, ['-e', `
    const { DuckDBInstance } = require(${JSON.stringify(duckdbDir)});
    (async () => {
      const instance = await DuckDBInstance.create(${JSON.stringify(file)});
      await instance.connect();
      console.log('holding');
      setInterval(() => {}, 1000);
    })();
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => holder.kill());
  await new Promise((resolve, reject) => {
    holder.stdout.once('data', resolve);
    holder.once('exit', code => reject(new Error(`the store holder exited early with ${code}`)));
  });
  try {
    const answer = await exportLedger(file);
    assert.equal(answer.status, 'busy');
    assert.equal(answer.pid, holder.pid);
    assert.equal(existsSync(ledger), false);
  } finally {
    holder.kill();
    await new Promise(resolve => holder.once('exit', resolve));
  }

  const again = await exportLedger(file);
  assert.equal(again.status, 'ok');
  assert.equal(again.rows, 1);
  assert.equal(readLedger(ledger).rows[0].value, 100);
});

test('dry-run counts what would go without touching the file', { skip: noDuckdb }, async (t) => {
  const { file } = await withStore(t, [span(daysAgo(20), 'old-1')]);
  const before = statSync(file).size;
  const answer = await prune({ keepDays: 14, dryRun: true });
  assert.equal(answer.status, 'dry-run');
  assert.equal(answer.deleted.span_events, 1);
  assert.equal(statSync(file).size, before);
});

test('status says what is in the store before anything is deleted', { skip: noDuckdb }, async (t) => {
  const { file } = await withStore(t, [span(daysAgo(20), 'old-1'), span(daysAgo(1), 'new-1')]);
  const snapshot = await status();
  assert.equal(snapshot.store, file);
  assert.equal(snapshot.busy, false);
  assert.equal(snapshot.holderPid, null);
  assert.ok(snapshot.freeBytes > 0, 'the free space is reported so a prune can decide before it starts');
  assert.equal(snapshot.tables.span_events, 2);
});

test('a store that is not there is reported, not created', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trace-store-'));
  process.env.MASTRA_OBSERVABILITY_DB_PATH = join(dir, 'missing.duckdb');
  try {
    assert.deepEqual(await prune({ keepDays: 14 }), { status: 'missing', store: join(dir, 'missing.duckdb') });
    assert.equal(existsSync(join(dir, 'missing.duckdb')), false);
  } finally {
    delete process.env.MASTRA_OBSERVABILITY_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});
