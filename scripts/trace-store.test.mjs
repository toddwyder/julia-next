import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  approvedWithoutRetro,
  compactStore,
  compactionFits,
  deletePayloads,
  deletionRefusal,
  exportLedger,
  isLockedMessage,
  ledgerFile,
  lockOwnerFromError,
  mergeLedger,
  mineSession,
  readLedger,
  retroExists,
  retroFile,
  status,
  storeFile,
  storeBytes,
  sweep,
  sweepPlan,
} from './trace-store.mjs';

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
     spanType varchar, name varchar, endedAt timestamp, attributes json, input json, output json, primary key (spanId))`,
  `create table metric_events (timestamp timestamp not null, metricId varchar primary key, threadId varchar, entityName varchar,
     provider varchar, model varchar, name varchar, value double, estimatedCost double)`,
  `create table log_events (timestamp timestamp not null, logId varchar primary key, level varchar, message varchar, threadId varchar)`,
];

const daysAgo = days => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

const span = (at, id, megabytes = 1, thread = 'thread-1') =>
  `insert into span_events (timestamp, spanId, entityName, threadId, spanType, input, output)
   values (timestamp '${at}', '${id}', 'Code Agent', '${thread}', 'processor_run', '{"body":"${'x'.repeat(Math.round(megabytes * 1024 * 1024))}"}', null)`;
const metric = (at, id, name, value, cost, thread = 'thread-1') =>
  `insert into metric_events (timestamp, metricId, threadId, entityName, provider, model, name, value, estimatedCost)
   values (timestamp '${at}', '${id}', '${thread}', 'Code Agent', 'commandcode.chat', 'deepseek/deepseek-v4.1-flash', '${name}', ${value}, ${cost})`;
// The provider writes the same model two ways: the span says how it was asked
// for, the metric row says who answered. That difference is what mining reports.
const modelMetric = (at, id, name, value, cost, thread = 'thread-1') =>
  `insert into metric_events (timestamp, metricId, threadId, entityName, provider, model, name, value, estimatedCost)
   values (timestamp '${at}', '${id}', '${thread}', 'Code Agent', 'openai', 'gpt-6-1-sol', '${name}', ${value}, ${cost})`;
const modelSpan = (at, id, model, provider, thread = 'thread-1') =>
  `insert into span_events (timestamp, spanId, entityName, threadId, spanType, name, endedAt, attributes, input)
   values (timestamp '${at}', '${id}', 'Code Agent', '${thread}', 'model_generation', 'llm: ''${model}''', null,
     '{"model":"${model}","provider":"${provider}"}', '{"messages":[]}')`;
const toolSpan = (at, id, tool, thread = 'thread-1') =>
  `insert into span_events (timestamp, spanId, entityName, threadId, spanType, name, input)
   values (timestamp '${at}', '${id}', 'Code Agent', '${thread}', 'tool_call', 'tool: ''${tool}''', '{"path":"/tmp/x"}')`;
const logRow = (at, id, message, thread = 'thread-1') =>
  `insert into log_events (timestamp, logId, level, message, threadId) values (timestamp '${at}', '${id}', 'error', '${message}', '${thread}')`;

async function runChild(code) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`fixture script exited with ${code}`))));
  });
}

const ENV = ['XDG_STATE_HOME', 'MASTRA_OBSERVABILITY_DB_PATH', 'MASTRA_TRACE_LEDGER', 'JULIA_RETROS_DIR', 'JULIA_NO_CARD_APPROVALS'];
const APPROVAL_HEADING = '## Approved to delete without a retro: they name no card. Todd approved, 29 Oct 2026.';

async function withStore(t, rows, { retros = [], approved = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'trace-store-'));
  const saved = Object.fromEntries(ENV.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const retrosDir = join(dir, 'retros');
  mkdirSync(retrosDir, { recursive: true });
  for (const card of retros) writeFileSync(join(retrosDir, `${card}.md`), '# retro\n');
  const approvals = join(dir, 'census.md');
  const body = [APPROVAL_HEADING, '', ...approved.map(thread => `- \`${thread}\` 2026-10-26`), ''].join('\n');
  writeFileSync(approvals, body);
  process.env.XDG_STATE_HOME = join(dir, 'state');
  process.env.JULIA_RETROS_DIR = retrosDir;
  process.env.JULIA_NO_CARD_APPROVALS = approvals;
  const file = join(dir, 'observability.duckdb');
  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  for (const sql of SCHEMA) await connection.run(sql);
  for (const row of rows) await connection.run(row);
  instance.closeSync();
  process.env.MASTRA_OBSERVABILITY_DB_PATH = file;
  return { dir, file, retrosDir, approvals, ledger: join(dir, 'state', 'julia', 'trace-costs.json'), stops: join(dir, 'state', 'julia', 'stops.jsonl') };
}

const countOf = async (file, table, where = 'true') => {
  const instance = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' });
  const connection = await instance.connect();
  const rows = (await connection.runAndReadAll(`select count(*) as n from ${table} where ${where}`)).getRowObjectsJson();
  instance.closeSync();
  return Number(rows[0].n);
};

test('the ledger and the retro sit where the next run looks for them', () => {
  assert.equal(ledgerFile({ XDG_STATE_HOME: '/x' }), '/x/julia/trace-costs.json');
  assert.equal(ledgerFile({ MASTRA_TRACE_LEDGER: '/tmp/l.json' }), '/tmp/l.json');
  assert.equal(storeFile({ MASTRA_OBSERVABILITY_DB_PATH: '/tmp/o.duckdb' }), '/tmp/o.duckdb');
  assert.match(storeFile({ MASTRA_APP_DATA_DIR: '/data' }), /^\/data\/observability\.duckdb$/);
  const retrosDir = mkdtempSync(join(tmpdir(), 'retros-'));
  writeFileSync(join(retrosDir, 'jul-231.md'), '# retro\n');
  assert.equal(retroExists('JUL-231', { retrosDir }), true, 'the file on disk is lower case and still counts');
  assert.equal(retroExists('JUL-999', { retrosDir }), false);
  assert.equal(retroFile('JUL-999', { retrosDir }), join(retrosDir, 'JUL-999.md'));
  rmSync(retrosDir, { recursive: true, force: true });
});

test('a lock refusal names the process holding the store', () => {
  const refusal = 'IO Error: Could not set lock on file "/home/ubuntu/.local/share/mastracode/observability.duckdb": Conflicting lock is held in /opt/node-v24.14.1/bin/node (PID 38968). See also https://duckdb.org/docs/stable/connect/concurrency';
  assert.deepEqual(lockOwnerFromError(refusal), { pid: 38968 });
  assert.equal(isLockedMessage(refusal), true);
  assert.equal(lockOwnerFromError('Catalog Error: Table with name t does not exist'), null);
});

test('compaction needs room for the rows that survive, not the whole file', () => {
  const store = 20 * 1024 ** 3;
  assert.equal(compactionFits(store, 11 * 1024 ** 3), true);
  assert.equal(compactionFits(store, 9 * 1024 ** 3), false);
});

test('merging a second export keeps one row per bucket and keeps the mined sessions', () => {
  const first = { rows: [{ threadId: 't', at: 1, entityName: 'Code Agent', provider: 'p', model: 'm', name: 'mastra_model_total_input_tokens', value: 10, estimatedCost: 0.1 }], requested: [{ threadId: 't', at: 5, entityName: 'Code Agent' }], sessions: { t: { thread: 't', card: 'JUL-1' } } };
  const merged = mergeLedger(first, [{ threadId: 't', at: 1, entityName: 'Code Agent', provider: 'p', model: 'm', name: 'mastra_model_total_input_tokens', value: 12, estimatedCost: 0.12 }]);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.rows[0].value, 12);
  assert.equal(merged.requested.length, 1);
  assert.equal(merged.sessions.t.card, 'JUL-1', 'a fresh export must not throw away what mining kept');
});

test('a mining pass saves the session numbers and says what the store does not hold', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const minedAt = '2026-10-29T20:00:00.000Z';
  const { file, ledger, stops } = await withStore(t, [
    span(at, 's1', 0.05),
    modelSpan(at, 'm1', 'gpt-6.1-sol', 'openai.responses'),
    toolSpan(at, 't1', 'view'),
    toolSpan(at, 't2', 'view'),
    toolSpan(at, 't3', 'execute_command'),
    modelMetric(at, 'k1', 'mastra_model_total_input_tokens', 1000, 0.5),
    modelMetric(at, 'k2', 'mastra_model_input_cache_read_tokens', 800, 0.08),
    modelMetric(at, 'k3', 'mastra_model_total_output_tokens', 200, 0.02),
    metric(at, 'd1', 'mastra_model_duration_ms', 32000, null),
    metric(at, 'd2', 'mastra_tool_duration_ms', 137, null),
    logRow(at, 'l1', 'Workspace not found'),
  ]);
  mkdirSync(join(stops, '..'), { recursive: true });
  writeFileSync(stops, `${JSON.stringify({ at, thread: 'thread-1', card: 'JUL-1', reason: 'ask_question' })}\n`);

  const answer = await mineSession('thread-1', { card: 'JUL-1', stops, minedAt });

  assert.equal(answer.status, 'ok');
  const { record } = answer;
  assert.equal(record.card, 'JUL-1');
  assert.equal(record.totals.tokens, 2000);
  assert.equal(record.tokens.total_input, 1000);
  assert.equal(record.tokens.input_cache_read, 800);
  assert.equal(record.models.length, 1);
  assert.equal(record.models[0].asked, 'openai.responses/gpt-6.1-sol');
  assert.equal(record.models[0].answered, 'openai/gpt-6-1-sol');
  assert.equal(record.models[0].calls, 1);
  assert.ok(Math.abs(record.totals.usd - 0.6) < 1e-9);
  assert.deepEqual(record.tools, { 'tool: \'view\'': 2, 'tool: \'execute_command\'': 1 });
  assert.equal(record.toolCalls, 3);
  assert.deepEqual(record.stages.map(s => s.stage).sort(), ['model_duration', 'tool_duration']);
  assert.equal(record.stops.count, 1);
  assert.equal(record.stops.reasons.ask_question, 1);
  assert.equal(record.compactions, 0);
  assert.equal(record.handoffs, 0);
  assert.equal(record.holds['stops'], 'the stop log, not the store');
  assert.ok(record.notHeld.some(miss => miss.fact === 'compactions'), 'a zero compaction count is reported as the store being silent');
  assert.ok(record.notHeld.some(miss => miss.fact === 'handoffs'));
  assert.equal(record.modelChanges.count, 0);

  const saved = readLedger(ledger);
  assert.equal(saved.sessions['thread-1'].card, 'JUL-1');
  assert.equal(saved.sessions['thread-1'].minedAt, minedAt);
});

test('a session whose payload rows were already mined keeps its numbers when the rows go', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file, ledger, retrosDir } = await withStore(t, [span(at, 's1', 0.05), modelSpan(at, 'm1', 'gpt-6.1-sol', 'openai.responses'), modelMetric(at, 'k1', 'mastra_model_total_input_tokens', 1000, 0.5), logRow(at, 'l1', 'boom')], { retros: ['JUL-1'] });
  await mineSession('thread-1', { card: 'JUL-1' });

  const answer = await deletePayloads('thread-1', { retrosDir });

  assert.equal(answer.status, 'ok');
  assert.deepEqual(answer.deleted, { span_events: 2, log_events: 1 });
  assert.equal(await countOf(file, 'span_events'), 0);
  assert.equal(await countOf(file, 'log_events'), 0);
  assert.equal(await countOf(file, 'metric_events'), 1, 'the cost row stays: it is the reason the payloads could go');
  assert.equal(readLedger(ledger).sessions['thread-1'].totals.tokens, 1000);
});

test('deleting the payloads of a session that was never mined is refused', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file, retrosDir } = await withStore(t, [span(at, 's1', 0.05)], { retros: ['JUL-1'] });

  const answer = await deletePayloads('thread-1', { card: 'JUL-1', retrosDir });

  assert.equal(answer.status, 'refused');
  assert.equal(answer.code, 'not-mined');
  assert.match(answer.message, /never mined/);
  assert.equal(await countOf(file, 'span_events'), 1, 'nothing is deleted without the numbers being kept');
});

test('deleting the payloads of a mined session with no retro is refused', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file, retrosDir } = await withStore(t, [span(at, 's1', 0.05)]);
  await mineSession('thread-1', { card: 'JUL-1' });

  const answer = await deletePayloads('thread-1', { retrosDir });

  assert.equal(answer.status, 'refused');
  assert.equal(answer.code, 'no-retro');
  assert.match(answer.message, /JUL-1 has no retro/);
  assert.equal(await countOf(file, 'span_events'), 1, 'the payloads wait until the lesson is written');
});

test('a session that names no card is deleted only because Todd approved it', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file, retrosDir, approvals } = await withStore(t, [span(at, 's1', 0.05), logRow(at, 'l1', 'boom')], { approved: ['thread-1'] });
  await mineSession('thread-1', {});

  const answer = await deletePayloads('thread-1', { retrosDir, approvals });

  assert.equal(answer.status, 'ok');
  assert.equal(answer.approved, true);
  assert.equal(answer.retro, null, 'no retro is claimed for a session that never named a card');
  assert.deepEqual(answer.deleted, { span_events: 1, log_events: 1 });
  assert.equal(await countOf(file, 'span_events'), 0);
});

test('a mined session on neither the retro list nor the approved list is refused', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file, retrosDir, approvals } = await withStore(t, [
    span(at, 'a1', 0.05, 'thread-a'),
    span(at, 'b1', 0.05, 'thread-b'),
    span(at, 'c1', 0.05, 'thread-c'),
  ], { approved: ['thread-b'] });
  await mineSession('thread-a', { card: 'JUL-1' });
  await mineSession('thread-b', {});
  await mineSession('thread-c', {});

  const noRetro = await deletePayloads('thread-a', { retrosDir, approvals });
  assert.equal(noRetro.status, 'refused');
  assert.equal(noRetro.code, 'no-retro');

  const noCard = await deletePayloads('thread-c', { retrosDir, approvals });
  assert.equal(noCard.status, 'refused');
  assert.equal(noCard.code, 'no-card');
  assert.match(noCard.message, /not on the approved list/);

  assert.equal(await countOf(file, 'span_events'), 3, 'a session on neither list keeps every payload row');
});

test('only the ids written under the approval heading count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'approvals-'));
  const file = join(dir, 'census.md');
  const approvedId = 'b934e198-2a7b-4c0e-9208-9022c1d79942';
  const strayId = '13351dad-0d36-42f1-a43b-6e1d016cfa3e';
  writeFileSync(file, `# census\n\n- \`${strayId}\` 2026-10-29\n\n${APPROVAL_HEADING}\n\n- \`${approvedId}\` 2026-10-21\n\n## Another list\n\n- \`${strayId}\` 2026-10-29\n`);

  assert.deepEqual([...approvedWithoutRetro(file)], [approvedId], 'an id quoted outside the approved section is not an approval');
  assert.equal(approvedWithoutRetro(join(dir, 'missing.md')).size, 0, 'no file means no approval, so every session still waits');
  rmSync(dir, { recursive: true, force: true });
});

test('a dry run says what would go and leaves every row in place', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file, retrosDir } = await withStore(t, [span(at, 's1', 0.05), logRow(at, 'l1', 'boom')], { retros: ['JUL-1'] });
  await mineSession('thread-1', { card: 'JUL-1' });

  const answer = await deletePayloads('thread-1', { retrosDir, dryRun: true });

  assert.equal(answer.status, 'dry-run');
  assert.deepEqual(answer.deleted, { span_events: 1, log_events: 1 });
  assert.equal(await countOf(file, 'span_events'), 1);
  assert.equal(await countOf(file, 'log_events'), 1);
});

test('compaction gives back the room a deleted payload was using, and deletes nothing else', { skip: noDuckdb }, async (t) => {
  const { file, retrosDir, ledger } = await withStore(t, [
    span(daysAgo(20), 'old-1', 2, 'thread-a'),
    span(daysAgo(20), 'old-2', 2, 'thread-a'),
    span(daysAgo(1), 'new-1', 0.01, 'thread-b'),
    logRow(daysAgo(20), 'log-old', 'old', 'thread-a'),
    logRow(daysAgo(1), 'log-new', 'new', 'thread-b'),
    metric(daysAgo(20), 'metric-old', 'mastra_model_total_input_tokens', 1000, 0.5, 'thread-a'),
  ], { retros: ['JUL-1'] });
  await mineSession('thread-a', { card: 'JUL-1' });
  const beforeDelete = storeBytes(file);

  const deleted = await deletePayloads('thread-a', { retrosDir });
  assert.deepEqual(deleted.deleted, { span_events: 2, log_events: 1 });
  const afterDelete = storeBytes(file);
  assert.ok(afterDelete >= beforeDelete * 0.9, 'a delete marks the rows dead; the file does not shrink by itself');

  const answer = await compactStore();

  assert.equal(answer.status, 'ok');
  assert.ok(answer.bytesAfter < afterDelete, `expected the file to shrink from ${afterDelete}, got ${answer.bytesAfter}`);
  assert.equal(statSync(file).size, answer.bytesAfter);
  assert.equal(existsSync(`${file}.compact`), false, 'the copy is renamed into place, not left behind');

  // Age is not a reason to delete: the live session is untouched and the cost stays.
  assert.equal(await countOf(file, 'span_events'), 1);
  assert.equal(await countOf(file, 'log_events'), 1);
  assert.equal(await countOf(file, 'metric_events'), 1);
  const report = JSON.parse(readFileSync(answer.report, 'utf8'));
  assert.equal(report.runs.at(-1).bytesAfter, answer.bytesAfter);
  const ledgerAfter = readLedger(ledger);
  assert.equal(ledgerAfter.sessions['thread-a'].card, 'JUL-1');
  const priced = ledgerAfter.rows.filter(row => row.threadId === 'thread-a' && row.name === 'mastra_model_total_input_tokens');
  assert.equal(priced.length, 1, 'mining keeps the cost row the scorecard prices from, so the ledger can price the card without the payloads');
  assert.equal(priced[0].estimatedCost, 0.5);
});

test('a sweep cleans only sessions that were mined, have a retro and whose card is Complete', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file, retrosDir, ledger } = await withStore(t, [
    span(at, 'a1', 0.05, 'thread-a'),
    span(at, 'b1', 0.05, 'thread-b'),
    span(at, 'c1', 0.05, 'thread-c'),
    metric(at, 'ka', 'mastra_model_total_input_tokens', 10, 0.01, 'thread-a'),
    metric(at, 'kb', 'mastra_model_total_input_tokens', 20, 0.02, 'thread-b'),
    metric(at, 'kc', 'mastra_model_total_input_tokens', 30, 0.03, 'thread-c'),
  ], { retros: ['JUL-1'] });
  await mineSession('thread-a', { card: 'JUL-1' });
  await mineSession('thread-b', { card: 'JUL-2' });
  await mineSession('thread-c', { card: 'JUL-3' });

  const plan = sweepPlan(readLedger(ledger), { retrosDir, completeCards: ['JUL-1', 'JUL-2'] });
  assert.deepEqual(plan.clean, [{ thread: 'thread-a', card: 'JUL-1' }]);
  assert.deepEqual(plan.kept.map(entry => entry.why), ['no retro record', 'its card is not Complete']);

  const answer = await sweep({ retrosDir, completeCards: ['JUL-1', 'JUL-2', 'JUL-3'] });

  assert.equal(answer.status, 'ok');
  assert.equal(await countOf(file, 'span_events', "threadId = 'thread-a'"), 0);
  assert.equal(await countOf(file, 'span_events', "threadId = 'thread-b'"), 1, 'a mined session with no retro keeps its payloads');
  assert.equal(await countOf(file, 'span_events', "threadId = 'thread-c'"), 1, 'a session whose card has no retro keeps its payloads');
  assert.equal(await countOf(file, 'metric_events'), 3);
  assert.equal(Object.keys(readLedger(ledger).sessions).length, 3);
});

test('a sweep cleans an approved no-card session and keeps everything else held', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file, retrosDir, ledger, approvals } = await withStore(t, [
    span(at, 'a1', 0.05, 'thread-a'),
    span(at, 'b1', 0.05, 'thread-b'),
    span(at, 'c1', 0.05, 'thread-c'),
    span(at, 'd1', 0.05, 'thread-d'),
    metric(at, 'ka', 'mastra_model_total_input_tokens', 10, 0.01, 'thread-a'),
    metric(at, 'kb', 'mastra_model_total_input_tokens', 20, 0.02, 'thread-b'),
    metric(at, 'kc', 'mastra_model_total_input_tokens', 30, 0.03, 'thread-c'),
    metric(at, 'kd', 'mastra_model_total_input_tokens', 40, 0.04, 'thread-d'),
  ], { retros: ['JUL-1'], approved: ['thread-b'] });
  await mineSession('thread-a', { card: 'JUL-276' });
  await mineSession('thread-b', {});
  await mineSession('thread-c', {});
  await mineSession('thread-d', { card: 'JUL-1' });

  const plan = sweepPlan(readLedger(ledger), { retrosDir, approvals, completeCards: ['JUL-1'], keep: { 'thread-d': 'its second half has no retro' } });
  assert.deepEqual(plan.clean, [{ thread: 'thread-b', card: null, approved: true }]);
  assert.deepEqual(plan.kept.map(entry => entry.why), ['its card is not Complete', 'no card, no retro, not on the approved list', 'kept on purpose: its second half has no retro']);

  const answer = await sweep({ retrosDir, approvals, completeCards: ['JUL-1'], keep: { 'thread-d': 'its second half has no retro' } });
  assert.equal(answer.status, 'ok');
  assert.equal(await countOf(file, 'span_events', "threadId = 'thread-b'"), 0, 'the approved no-card session loses its payloads');
  assert.equal(await countOf(file, 'span_events', "threadId = 'thread-a'"), 1, 'a JUL-276 session keeps its payloads while that card is open');
  assert.equal(await countOf(file, 'span_events', "threadId = 'thread-c'"), 1, 'a no-card session nobody approved keeps its payloads');
  assert.equal(await countOf(file, 'span_events', "threadId = 'thread-d'"), 1, 'a keep entry outranks a complete card with a retro');
  assert.equal(await countOf(file, 'metric_events'), 4, 'every cost row stays');
  assert.equal(Object.keys(readLedger(ledger).sessions).length, 4);
});

test('a sweep with no Complete list cleans nothing, and a keep entry outranks a retro', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file, retrosDir, ledger } = await withStore(t, [
    span(at, 'a1', 0.05, 'thread-a'),
    span(at, 'b1', 0.05, 'thread-b'),
    metric(at, 'ka', 'mastra_model_total_input_tokens', 10, 0.01, 'thread-a'),
  ], { retros: ['JUL-1'] });
  await mineSession('thread-a', { card: 'JUL-1' });
  await mineSession('thread-b', { card: 'JUL-1' });

  const nothing = await sweep({ retrosDir });
  assert.equal(nothing.plan.clean.length, 0, 'an empty list means no card is known Complete, not every card');
  assert.equal(await countOf(file, 'span_events'), 2);

  const kept = sweepPlan(readLedger(ledger), { retrosDir, completeCards: ['JUL-1'], keep: { 'thread-a': 'half of this session has no retro' } });
  assert.deepEqual(kept.clean, [{ thread: 'thread-b', card: 'JUL-1' }]);
  assert.equal(kept.kept[0].why, 'kept on purpose: half of this session has no retro');
  assert.equal(await countOf(file, 'span_events'), 2, 'a plan alone deletes nothing');
});

test('the age rule is gone, so nothing is deleted by a date', { skip: noDuckdb }, async (t) => {
  const { file } = await withStore(t, [span(daysAgo(400), 'ancient-1')]);
  const answer = await compactStore({ dryRun: true });
  assert.equal(answer.status, 'dry-run');
  assert.equal(await countOf(file, 'span_events'), 1);
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
    const mined = await mineSession('thread-1');
    assert.equal(mined.status, 'busy');
    assert.equal(mined.pid, holder.pid);
  } finally {
    holder.kill();
    await new Promise(resolve => holder.once('exit', resolve));
  }

  const again = await exportLedger(file);
  assert.equal(again.status, 'ok');
  assert.equal(again.rows, 1);
  assert.equal(readLedger(ledger).rows[0].value, 100);
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

test('a store that is not there is reported missing instead of crashing', async () => {
  const answer = await compactStore({ dryRun: true, store: '/tmp/no-such-trace-store.duckdb' });
  assert.equal(answer.status, 'missing');
});

test('the guard order is mined first, card second, retro third', () => {
  const retrosDir = mkdtempSync(join(tmpdir(), 'retros-'));
  const ledger = { sessions: {} };
  assert.equal(deletionRefusal('thread-1', { ledger, retrosDir }).code, 'not-mined');
  ledger.sessions['thread-1'] = { thread: 'thread-1', card: null };
  assert.equal(deletionRefusal('thread-1', { ledger, retrosDir }).code, 'no-card');
  ledger.sessions['thread-1'].card = 'JUL-1';
  assert.equal(deletionRefusal('thread-1', { ledger, retrosDir }).code, 'no-retro');
  writeFileSync(join(retrosDir, 'JUL-1.md'), '# retro\n');
  assert.equal(deletionRefusal('thread-1', { ledger, retrosDir }), null);
  rmSync(retrosDir, { recursive: true, force: true });
});
