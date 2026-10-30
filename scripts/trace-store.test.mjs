import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanSession, openStore } from './trace-store.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const duckdbDir = [
  join(REPO, 'node_modules', '@duckdb', 'node-api'),
  join(process.env.HOME ?? '', '.local', 'lib', 'mastracode-program', 'node_modules', '@duckdb', 'node-api'),
].find(dir => existsSync(join(dir, 'package.json')));
// The DuckDB client is a dev dependency, so CI opens a real store. A green run that
// skipped every store test is how an unreviewed script deleted live sessions, so a
// missing client fails the file in CI instead of skipping it.
if (!duckdbDir && process.env.CI) {
  throw new Error('the trace-store tests cannot skip in CI: run npm ci so @duckdb/node-api is installed');
}
const { DuckDBInstance } = duckdbDir ? createRequire(join(duckdbDir, 'package.json'))('@duckdb/node-api') : {};

const SCHEMA = [
  `create table span_events (timestamp timestamp not null, traceId varchar, spanId varchar, entityName varchar, threadId varchar,
     spanType varchar, name varchar, endedAt timestamp, attributes json, input json, output json, primary key (spanId))`,
  `create table metric_events (timestamp timestamp not null, metricId varchar primary key, threadId varchar, entityName varchar,
     provider varchar, model varchar, name varchar, value double, estimatedCost double)`,
  `create table log_events (timestamp timestamp not null, logId varchar primary key, level varchar, message varchar, threadId varchar)`,
];

const SLICE = '13351dad-0d36-42f1-a43b-6e1d016cfa3e';
const OTHER = '22222222-2222-4222-8222-222222222222';

async function withStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'trace-clean-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'observability.duckdb');
  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  for (const sql of SCHEMA) await connection.run(sql);
  const span = (id, thread) =>
    `insert into span_events (timestamp, spanId, entityName, threadId, spanType, input)
     values (timestamp '2026-10-30 03:00:00', '${id}', 'Code Agent', '${thread}', 'processor_run', '{"body":"a prompt"}')`;
  const metric = (id, value, thread) =>
    `insert into metric_events (timestamp, metricId, threadId, entityName, provider, model, name, value, estimatedCost)
     values (timestamp '2026-10-30 03:00:00', '${id}', '${thread}', 'Code Agent', 'commandcode.chat',
       'deepseek/deepseek-v4.1-flash-1017-cm', 'mastra_model_total_input_tokens', ${value}, 0.15)`;
  const log = (id, thread) =>
    `insert into log_events (timestamp, logId, level, message, threadId)
     values (timestamp '2026-10-30 03:00:00', '${id}', 'error', 'read ECONNRESET', '${thread}')`;
  for (const row of [span('s1', SLICE), span('s2', SLICE), span('s3', OTHER), metric('m1', 1000, SLICE), metric('m2', 200, SLICE), metric('m3', 7, OTHER), log('l1', SLICE), log('l2', SLICE), log('l3', OTHER)]) {
    await connection.run(row);
  }
  instance.closeSync();
  return { dir, file };
}

const rowsFor = async (file, table, thread) => {
  const opened = await openStore(file, 'READ_ONLY');
  try {
    const connection = await opened.instance.connect();
    return (await connection.runAndReadAll(`select * from ${table} where threadId = '${thread}'`)).getRowObjectsJson();
  } finally {
    opened.instance.closeSync?.();
  }
};

// The retro's last step: the slice's detail goes, its cost rows stay, the file is
// checkpointed, and another session's rows are not touched. With the delete broken the
// span count below stays 2, which is the failure this test exists to catch.
test('a retro cleanup deletes its slice detail and keeps its metric rows', { skip: duckdbDir ? false : 'no @duckdb/node-api on this machine' }, async t => {
  const { file } = await withStore(t);
  const answer = await cleanSession(SLICE, { store: file, post: () => assert.fail('a small store must not comment on a card') });

  assert.equal(answer.status, 'ok');
  assert.equal(answer.kept, 2, 'both of the slice’s cost rows are kept');
  assert.deepEqual(answer.deleted, { span_events: 2, log_events: 2 });
  assert.ok(answer.bytesBefore > 0 && answer.bytesAfter > 0, 'the cleanup reports the file before and after');
  assert.equal(await rowsFor(file, 'span_events', SLICE).then(rows => rows.length), 0, 'the slice’s prompt payloads are gone');
  assert.equal(await rowsFor(file, 'log_events', SLICE).then(rows => rows.length), 0, 'the slice’s log rows are gone');
  assert.deepEqual(await rowsFor(file, 'metric_events', SLICE).then(rows => rows.map(r => r.value)), [1000, 200], 'the cost rows survive with their numbers');
  assert.equal(await rowsFor(file, 'span_events', OTHER).then(rows => rows.length), 1, 'another session keeps its detail');
  assert.equal(await rowsFor(file, 'metric_events', OTHER).then(rows => rows.length), 1, 'another session keeps its cost row');

  await assert.rejects(cleanSession('not-a-session', { store: file }), /is not a session id/);
});
