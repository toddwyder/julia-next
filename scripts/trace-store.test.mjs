import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  approvedWithoutRetro,
  compactStore,
  compactionFits,
  copyOptions,
  deletePayloads,
  deletionRefusal,
  exportLedger,
  heldOnPurpose,
  isLockedMessage,
  ledgerFile,
  listSessions,
  lockOwnerFromError,
  mergeLedger,
  mineSession,
  mineSessions,
  openStore,
  readCensus,
  readLedger,
  retroExists,
  retroFile,
  status,
  storeFile,
  storeBytes,
  sweep,
  sweepComment,
  sweepPlan,
} from './trace-store.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const duckdbDir = [
  join(REPO, 'node_modules', '@duckdb', 'node-api'),
  join(process.env.HOME ?? '', '.local', 'lib', 'mastracode-program', 'node_modules', '@duckdb', 'node-api'),
].find(dir => existsSync(join(dir, 'package.json')));
// The DuckDB client is a dev dependency here, so CI opens a real store too. On a
// machine that never ran `npm ci`, the pure rules still run. In CI a missing
// client fails the file instead: a green run that skipped every store test is how
// the deletion guards went unchecked while an unreviewed script did the deleting.
const duckdbMissing = 'no @duckdb/node-api on this machine, so there is no store to open';
if (!duckdbDir && process.env.CI) {
  throw new Error(`the trace-store tests cannot skip in CI: ${duckdbMissing}; run npm ci so @duckdb/node-api is installed`);
}
const noDuckdb = duckdbDir ? false : duckdbMissing;
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

// A census doc names real session ids, so a test that reads one must too.
const session = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ENV = ['XDG_STATE_HOME', 'MASTRA_OBSERVABILITY_DB_PATH', 'MASTRA_TRACE_LEDGER', 'JULIA_RETROS_DIR', 'JULIA_CENSUS'];
const APPROVAL_HEADING = '## Approved to delete without a retro: they name no card. Todd approved, 29 Oct 2026.';
const OPEN_CARD_HEADING = '## Sessions on a card that is not Complete';
const HOLD_HEADING = '## Held back on purpose';

// The census doc is the reviewed list a sweep decides from, so the tests build
// one in the same shape as docs/retros/census-2026-10-29.md: a table of Complete
// cards with their sessions, a list of sessions whose card is still open, the
// Complete cards with no session, Todd's approvals, and the holds.
function censusDoc({ cards = {}, open = {}, complete = [], approved = [], hold = {} } = {}) {
  return [
    '# census',
    '',
    '## Cards with a session',
    '',
    '| Card | Complete | Session | Started | Maps by | Retro record |',
    '| --- | --- | --- | --- | --- | --- |',
    ...Object.entries(cards).map(([thread, card]) => `| ${card} | 2026-10-29 | \`${thread}\` "a session" | 2026-10-29 | first request | none |`),
    '',
    OPEN_CARD_HEADING,
    '',
    ...Object.entries(open).map(([thread, card]) => `- ${card} \`${thread}\` 2026-10-29 (first request)`),
    '',
    '## Complete cards with no session',
    '',
    complete.join(', '),
    '',
    APPROVAL_HEADING,
    '',
    ...approved.map(thread => `- \`${thread}\` 2026-10-26`),
    '',
    HOLD_HEADING,
    '',
    ...Object.entries(hold).map(([thread, why]) => `- \`${thread}\` — ${why}`),
    '',
  ].join('\n');
}

async function withStore(t, rows, { retros = [], ...facts } = {}) {
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
  const census = join(dir, 'census.md');
  writeFileSync(census, censusDoc(facts));
  process.env.XDG_STATE_HOME = join(dir, 'state');
  process.env.JULIA_RETROS_DIR = retrosDir;
  process.env.JULIA_CENSUS = census;
  const file = join(dir, 'observability.duckdb');
  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  for (const sql of SCHEMA) await connection.run(sql);
  for (const row of rows) await connection.run(row);
  instance.closeSync();
  process.env.MASTRA_OBSERVABILITY_DB_PATH = file;
  return { dir, file, retrosDir, census, ledger: join(dir, 'state', 'julia', 'trace-costs.json'), stops: join(dir, 'state', 'julia', 'stops.jsonl') };
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
  const one = session(1);
  const minedAt = '2026-10-29T20:00:00.000Z';
  const { file, ledger, stops } = await withStore(t, [
    span(at, 's1', 0.05, one),
    modelSpan(at, 'm1', 'gpt-6.1-sol', 'openai.responses', one),
    toolSpan(at, 't1', 'view', one),
    toolSpan(at, 't2', 'view', one),
    toolSpan(at, 't3', 'execute_command', one),
    modelMetric(at, 'k1', 'mastra_model_total_input_tokens', 1000, 0.5, one),
    modelMetric(at, 'k2', 'mastra_model_input_cache_read_tokens', 800, 0.08, one),
    modelMetric(at, 'k3', 'mastra_model_total_output_tokens', 200, 0.02, one),
    metric(at, 'd1', 'mastra_model_duration_ms', 32000, null, one),
    metric(at, 'd2', 'mastra_tool_duration_ms', 137, null, one),
    logRow(at, 'l1', 'Workspace not found', one),
  ], { cards: { [one]: 'JUL-1' } });
  mkdirSync(join(stops, '..'), { recursive: true });
  writeFileSync(stops, `${JSON.stringify({ at, thread: one, card: 'JUL-1', reason: 'ask_question' })}\n`);

  const answer = await mineSession(one, { stops, minedAt });

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
  assert.equal(saved.sessions[one].card, 'JUL-1');
  assert.equal(saved.sessions[one].minedAt, minedAt);
});

test('one pass mines every session through one read-only connection', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const [a, b, c] = [1, 2, 3].map(session);
  const { file, ledger } = await withStore(t, [
    span(at, 'a1', 0.05, a),
    span(at, 'b1', 0.05, b),
    metric(at, 'ka', 'mastra_model_total_input_tokens', 10, 0.01, a),
    metric(at, 'kb', 'mastra_model_total_input_tokens', 20, 0.02, b),
  ], { cards: { [a]: 'JUL-1', [b]: 'JUL-2' } });
  const first = statSync(file).ino;

  const answer = await mineSessions([a, b, c], { cards: readCensus().cards });

  assert.equal(answer.status, 'ok');
  assert.equal(answer.records.length, 3);
  assert.equal(answer.costRows, 2);
  // Not the byte count: DuckDB folds its write-ahead log into the file the first time
  // another process opens it, so the size moves while nothing was written. A store that
  // was rewritten to compact it gets a new inode.
  assert.equal(statSync(file).ino, first, 'mining reads the store and never writes to it');
  const saved = readLedger(ledger);
  assert.equal(saved.sessions[a].card, 'JUL-1', 'the card comes from the census doc');
  assert.equal(saved.sessions[c].card, null, 'a session the store never saw still gets a record, so a sweep may skip it on purpose');
  assert.equal(saved.sessions[c].totals.calls, 0);
});

test('mining drops a card the census no longer gives', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const one = session(1);
  const { ledger } = await withStore(t, [span(at, 's1', 0.05, one)], { cards: { [one]: 'JUL-1' } });

  await mineSession(one, {});
  assert.equal(readLedger(ledger).sessions[one].card, 'JUL-1', 'the census names this session, so the card is kept');

  const dir = mkdtempSync(join(tmpdir(), 'stale-card-'));
  const census = join(dir, 'census.md');
  writeFileSync(census, censusDoc({ complete: ['JUL-1'] }));

  const answer = await mineSession(one, { census });

  assert.equal(answer.record.card, null, 'a card left in the ledger by an older census must not outlive it');
  assert.equal(readLedger(ledger).sessions[one].card, null, 'the ledger is rewritten without the stale card');
  rmSync(dir, { recursive: true, force: true });
});

test('a card only the ledger remembers does not delete a session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stale-plan-'));
  const retrosDir = join(dir, 'retros');
  mkdirSync(retrosDir, { recursive: true });
  writeFileSync(join(retrosDir, 'JUL-1.md'), '# JUL-1\n\nThe lesson is written.\n');
  const census = join(dir, 'census.md');
  const one = session(1);
  writeFileSync(census, censusDoc({ complete: ['JUL-1'] }));

  const ledger = { version: 2, sessions: { [one]: { thread: one, card: 'JUL-1', minedAt: '2026-10-29T20:00:00.000Z' } } };
  const plan = sweepPlan(ledger, { retrosDir, census });

  assert.deepEqual(plan.clean, [], 'JUL-1 is Complete and has a retro, but the census gives this session no card');
  assert.equal(plan.kept.length, 1);
  assert.match(plan.kept[0].why, /no card/);
  rmSync(dir, { recursive: true, force: true });
});

test('a session whose payload rows were already mined keeps its numbers when the rows go', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const one = session(1);
  const { file, ledger } = await withStore(t, [span(at, 's1', 0.05, one), modelSpan(at, 'm1', 'gpt-6.1-sol', 'openai.responses', one), modelMetric(at, 'k1', 'mastra_model_total_input_tokens', 1000, 0.5, one), logRow(at, 'l1', 'boom', one)], { retros: ['JUL-1'], cards: { [one]: 'JUL-1' } });
  await mineSession(one, {});

  const answer = await deletePayloads(one, {});

  assert.equal(answer.status, 'ok');
  assert.deepEqual(answer.deleted, { span_events: 2, log_events: 1 });
  assert.equal(await countOf(file, 'span_events'), 0);
  assert.equal(await countOf(file, 'log_events'), 0);
  assert.equal(await countOf(file, 'metric_events'), 1, 'the cost row stays: it is the reason the payloads could go');
  assert.equal(readLedger(ledger).sessions[one].totals.tokens, 1000);
});

test('deleting the payloads of a session that was never mined is refused', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file } = await withStore(t, [span(at, 's1', 0.05)], { retros: ['JUL-1'] });

  const answer = await deletePayloads('thread-1', {});

  assert.equal(answer.status, 'refused');
  assert.equal(answer.code, 'not-mined');
  assert.match(answer.message, /never mined/);
  assert.doesNotMatch(answer.message, /--card/, 'nothing tells a person to hand a session a card that the census does not give it');
  assert.equal(await countOf(file, 'span_events'), 1, 'nothing is deleted without the numbers being kept');
});

test('deleting the payloads of a mined session with no retro is refused', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const one = session(1);
  const { file } = await withStore(t, [span(at, 's1', 0.05, one)], { cards: { [one]: 'JUL-1' } });
  await mineSession(one, {});

  const answer = await deletePayloads(one, {});

  assert.equal(answer.status, 'refused');
  assert.equal(answer.code, 'no-retro');
  assert.match(answer.message, /JUL-1 has no retro/);
  assert.equal(await countOf(file, 'span_events'), 1, 'the payloads wait until the lesson is written');
});

test('a session that names no card is deleted only because Todd approved it', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file } = await withStore(t, [span(at, 's1', 0.05), logRow(at, 'l1', 'boom')], { approved: ['thread-1'] });
  await mineSession('thread-1', {});

  const answer = await deletePayloads('thread-1', {});

  assert.equal(answer.status, 'ok');
  assert.equal(answer.approved, true);
  assert.equal(answer.retro, null, 'no retro is claimed for a session that never named a card');
  assert.deepEqual(answer.deleted, { span_events: 1, log_events: 1 });
  assert.equal(await countOf(file, 'span_events'), 0);
});

test('an approval never stands in for the retro of a card the session itself named', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const one = session(1);
  const { file } = await withStore(t, [span(at, 's1', 0.05, one)], { approved: [one], cards: { [one]: 'JUL-1' } });
  await mineSession(one, {});

  const answer = await deletePayloads(one, {});

  assert.equal(answer.status, 'refused');
  assert.equal(answer.code, 'no-retro', 'the approval covers sessions with no card, not a card whose lesson is unwritten');
  assert.equal(await countOf(file, 'span_events'), 1);
});

test('a card handed to the delete cannot open the gate', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file } = await withStore(t, [span(at, 's1', 0.05)], { retros: ['JUL-1'] });
  await mineSession('thread-1', {});

  const answer = await deletePayloads('thread-1', { card: 'JUL-1' });

  assert.equal(answer.status, 'refused');
  assert.equal(answer.code, 'no-card', 'a card passed in from outside is ignored: the session names none, so its lesson cannot be claimed');
  assert.equal(await countOf(file, 'span_events'), 1);
});

test('a mined session on neither the retro list nor the approved list is refused', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const [a, b, c] = [1, 2, 3].map(session);
  const { file } = await withStore(t, [
    span(at, 'a1', 0.05, a),
    span(at, 'b1', 0.05, b),
    span(at, 'c1', 0.05, c),
  ], { approved: [b], cards: { [a]: 'JUL-1' } });
  await mineSession(a, {});
  await mineSession(b, {});
  await mineSession(c, {});

  const noRetro = await deletePayloads(a, {});
  assert.equal(noRetro.status, 'refused');
  assert.equal(noRetro.code, 'no-retro');

  const noCard = await deletePayloads(c, {});
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
  const prose = 'the file `scripts/trace-store.mjs` explains it, and the hold on `';
  writeFileSync(file, `# census\n\n- \`${strayId}\` 2026-10-29\n\n${APPROVAL_HEADING}\n\n${prose}${strayId}\` lines.\n\n- \`${approvedId}\` 2026-10-21\n\n## Another list\n\n- \`${strayId}\` 2026-10-29\n`);

  assert.deepEqual([...approvedWithoutRetro(file)], [approvedId], 'an id quoted outside the approved section, or named in prose inside it, is not an approval');
  assert.equal(approvedWithoutRetro(join(dir, 'missing.md')).size, 0, 'no file means no approval, so every session still waits');
  rmSync(dir, { recursive: true, force: true });
});

test('a hold is read from its own heading, with the reason written beside it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holds-'));
  const file = join(dir, 'census.md');
  const held = '13351dad-0d36-42f1-a43b-6e1d016cfa3e';
  const other = '5d5df123-2d91-4268-8c69-4a6676a5d209';
  writeFileSync(file, [
    '# census', '',
    `- \`${held}\` — a hold in the preamble is prose, not a list`, '',
    HOLD_HEADING, '',
    `- \`${held}\` — jul-284.md covers this session's first half only`, '',
    `- \`${other}\``, '',
    'The paragraph below the list names `13351dad-0d36-42f1-a43b-6e1d016cfa3e` again.',
    '', '## Another list', '', `- \`${other}\` — this hold belongs to no session list`, '',
  ].join('\n'));

  const holds = heldOnPurpose(file);
  assert.deepEqual([...holds.keys()], [held, other], 'only the hold section counts, and a bullet in another section is not a hold');
  assert.equal(holds.get(held), "jul-284.md covers this session's first half only");
  assert.equal(holds.get(other), 'held back on purpose, with no reason written', 'a hold with no reason still holds');
  assert.equal(heldOnPurpose(join(dir, 'missing.md')).size, 0, 'no file holds nothing back');
  rmSync(dir, { recursive: true, force: true });
});

test('the census doc gives the sweep every fact it needs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'census-'));
  const file = join(dir, 'census.md');
  const completeThread = '72c42b39-e67d-45de-8900-4e43562c13e7';
  const openThread = '1ed0e477-12d4-44fe-bd96-7c77b307346c';
  writeFileSync(file, censusDoc({
    cards: { [completeThread]: 'JUL-1' },
    open: { [openThread]: 'JUL-276' },
    complete: ['JUL-9', 'JUL-10'],
    approved: ['b934e198-2a7b-4c0e-9208-9022c1d79942'],
    hold: { '9e4bfa9d-de5b-4ba3-b7b8-e8704c3798e8': 'half of it has no retro' },
  }));

  const facts = readCensus(file);
  assert.deepEqual([...facts.complete].sort(), ['JUL-1', 'JUL-10', 'JUL-9']);
  assert.equal(facts.cards.get(completeThread), 'JUL-1');
  assert.equal(facts.cards.get(openThread), 'JUL-276', 'a session on an open card still reports its card in the plan');
  assert.equal(facts.complete.has('JUL-276'), false, 'the card an open session names is not Complete');
  assert.equal(facts.approved.size, 1);
  assert.equal(facts.hold.size, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('a dry run says what would go and leaves every row in place', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const one = session(1);
  const { file } = await withStore(t, [span(at, 's1', 0.05, one), logRow(at, 'l1', 'boom', one)], { retros: ['JUL-1'], cards: { [one]: 'JUL-1' } });
  await mineSession(one, {});

  const answer = await deletePayloads(one, { dryRun: true });

  assert.equal(answer.status, 'dry-run');
  assert.deepEqual(answer.deleted, { span_events: 1, log_events: 1 });
  assert.equal(await countOf(file, 'span_events'), 1);
  assert.equal(await countOf(file, 'log_events'), 1);
});

test('a sweep hands one open store to every session it cleans', { skip: noDuckdb }, async (t) => {
  const [a, b] = [1, 2].map(session);
  const { file } = await withStore(t, [
    span(daysAgo(1), 's1', 0.05, a),
    span(daysAgo(1), 's2', 0.05, b),
    logRow(daysAgo(1), 'l1', 'boom', a),
    logRow(daysAgo(1), 'l2', 'boom', b),
  ], { retros: ['JUL-1'], cards: { [a]: 'JUL-1', [b]: 'JUL-1' } });
  await mineSession(a, {});
  await mineSession(b, {});
  const { instance } = await openStore(file, 'READ_ONLY');
  t.after(() => instance.closeSync?.());
  const first = await deletePayloads(a, { dryRun: true, instance });
  // Reading the second session through the same open is the point: opening the
  // 22 GB store once per session left 3.1 GB of caches behind after 42 of them,
  // and closing a handle the caller opened stops the sweep after the first.
  const second = await deletePayloads(b, { dryRun: true, instance });
  assert.equal(first.status, 'dry-run');
  assert.equal(second.status, 'dry-run');
  const [row] = (await (await instance.connect()).runAndReadAll('select count(*) as n from span_events')).getRowObjectsJson();
  assert.equal(Number(row.n), 2);
});

test('compaction gives back the room a deleted payload was using, and deletes nothing else', { skip: noDuckdb }, async (t) => {
  const [a, b] = [1, 2].map(session);
  const { file, ledger } = await withStore(t, [
    span(daysAgo(20), 'old-1', 2, a),
    span(daysAgo(20), 'old-2', 2, a),
    span(daysAgo(1), 'new-1', 0.01, b),
    logRow(daysAgo(20), 'log-old', 'old', a),
    logRow(daysAgo(1), 'log-new', 'new', b),
    metric(daysAgo(20), 'metric-old', 'mastra_model_total_input_tokens', 1000, 0.5, a),
  ], { retros: ['JUL-1'], cards: { [a]: 'JUL-1' } });
  await mineSession(a, {});
  const beforeDelete = storeBytes(file);

  const deleted = await deletePayloads(a, {});
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
  assert.equal(ledgerAfter.sessions[a].card, 'JUL-1');
  const priced = ledgerAfter.rows.filter(row => row.threadId === a && row.name === 'mastra_model_total_input_tokens');
  assert.equal(priced.length, 1, 'mining keeps the cost row the scorecard prices from, so the ledger can price the card without the payloads');
  assert.equal(priced[0].estimatedCost, 0.5);
});

test('the copy that shrinks the store keeps a budget of its own', () => {
  const big = copyOptions('/tmp/store.duckdb', 64 * 1024 ** 3);
  assert.equal(big.threads, '1', 'two threads hold two rows at a time, and a row here carries a whole prompt');
  assert.equal(big.preserve_insertion_order, 'false');
  const bytes = value => Number(value.replace(/MB$/, '')) * 1024 ** 2;
  assert.ok(bytes(big.max_temp_directory_size) <= 512 * 1024 ** 2, `a copy may spill at most half a gigabyte, not ${big.max_temp_directory_size}`);
  const cramped = copyOptions('/tmp/store.duckdb', 400 * 1024 ** 2);
  assert.ok(bytes(cramped.max_temp_directory_size) <= 400 * 1024 ** 2 / 4, 'a full disk shrinks the spill budget with it');
  assert.ok(bytes(cramped.max_temp_directory_size) >= 64 * 1024 ** 2, 'the budget never reaches zero, or every copy fails');
});

test('a copy that cannot run leaves the store as it is and says why', { skip: noDuckdb }, async (t) => {
  const one = session(1);
  const { file } = await withStore(t, [
    span(daysAgo(20), 'old-1', 2, one),
    span(daysAgo(1), 'new-1', 0.01, one),
    metric(daysAgo(20), 'metric-old', 'mastra_model_total_input_tokens', 1000, 0.5, one),
  ], { retros: ['JUL-1'], cards: { [one]: 'JUL-1' } });
  await mineSession(one, {});
  await deletePayloads(one, {});
  const before = storeBytes(file);

  // A directory that cannot take a new file is how a full disk shows up here.
  chmodSync(dirname(file), 0o500);
  try {
    const answer = await compactStore();
    assert.equal(answer.status, 'no-room');
    assert.ok(answer.failure && answer.failure.length > 0, 'the reason is reported, not swallowed');
    assert.equal(answer.bytesAfter, before, 'the store the delete wrote is still the store on disk');
  } finally {
    chmodSync(dirname(file), 0o700);
  }
  assert.equal(existsSync(`${file}.compact`), false, 'a half-written copy is removed, not left beside the store');
  assert.equal(await countOf(file, 'metric_events'), 1, 'the store still answers after the copy that could not run');
});

test('a sweep cleans only sessions that were mined, have a retro and whose card is Complete', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const [a, b, c] = [1, 2, 3].map(session);
  const { file, ledger } = await withStore(t, [
    span(at, 'a1', 0.05, a),
    span(at, 'b1', 0.05, b),
    span(at, 'c1', 0.05, c),
    metric(at, 'ka', 'mastra_model_total_input_tokens', 10, 0.01, a),
    metric(at, 'kb', 'mastra_model_total_input_tokens', 20, 0.02, b),
    metric(at, 'kc', 'mastra_model_total_input_tokens', 30, 0.03, c),
  ], { retros: ['JUL-1'], cards: { [a]: 'JUL-1', [b]: 'JUL-2' }, open: { [c]: 'JUL-3' } });

  const answer = await sweep({ sessions: [a, b, c] });

  assert.equal(answer.status, 'ok');
  assert.deepEqual(answer.plan.clean, [{ thread: a, card: 'JUL-1' }]);
  assert.deepEqual(answer.plan.kept.map(entry => entry.why), ['no retro record', 'its card is not Complete']);
  assert.equal(await countOf(file, 'span_events', `threadId = '${a}'`), 0);
  assert.equal(await countOf(file, 'span_events', `threadId = '${b}'`), 1, 'a mined session with no retro keeps its payloads');
  assert.equal(await countOf(file, 'span_events', `threadId = '${c}'`), 1, 'a session whose card is still open keeps its payloads');
  assert.equal(await countOf(file, 'metric_events'), 3);
  assert.equal(Object.keys(readLedger(ledger).sessions).length, 3);
});

test('a sweep cleans an approved no-card session and keeps everything else held', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(session);
  const sessions = [a, b, c, d, e];
  const rows = [
    ...sessions.map((thread, n) => span(at, `s${n}`, 0.05, thread)),
    ...sessions.map((thread, n) => metric(at, `k${n}`, 'mastra_model_total_input_tokens', 10 * (n + 1), 0.01, thread)),
  ];
  const { file, ledger } = await withStore(t, rows, {
    retros: ['JUL-1'],
    cards: { [d]: 'JUL-1', [e]: 'JUL-2' },
    open: { [a]: 'JUL-276' },
    approved: [b, e],
    hold: { [d]: 'its second half has no retro' },
  });

  const answer = await sweep({ sessions });

  assert.equal(answer.status, 'ok');
  assert.deepEqual(answer.plan.clean, [{ thread: b, card: null, approved: true }]);
  assert.deepEqual(answer.plan.kept.map(entry => entry.why), [
    'its card is not Complete',
    'no card, no retro, not on the approved list',
    'kept on purpose: its second half has no retro',
    'no retro record',
  ]);
  assert.equal(await countOf(file, 'span_events', `threadId = '${b}'`), 0, 'the approved no-card session loses its payloads');
  assert.equal(await countOf(file, 'span_events', `threadId = '${a}'`), 1, 'a JUL-276 session keeps its payloads while that card is open');
  assert.equal(await countOf(file, 'span_events', `threadId = '${c}'`), 1, 'a no-card session nobody approved keeps its payloads');
  assert.equal(await countOf(file, 'span_events', `threadId = '${d}'`), 1, 'a hold outranks a Complete card with a retro');
  assert.equal(await countOf(file, 'span_events', `threadId = '${e}'`), 1, 'an approval cannot stand in for the retro of a card the session named');
  assert.equal(await countOf(file, 'metric_events'), 5, 'every cost row stays');
  assert.equal(Object.keys(readLedger(ledger).sessions).length, 5);
});

test('a sweep with no Complete card cleans nothing and does not compact', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { file } = await withStore(t, [
    span(at, 'a1', 1, 'thread-a'),
    span(at, 'b1', 1, 'thread-b'),
    metric(at, 'ka', 'mastra_model_total_input_tokens', 10, 0.01, 'thread-a'),
  ], { retros: ['JUL-1'], open: { 'thread-a': 'JUL-1' } });
  const inode = statSync(file).ino;

  const answer = await sweep({ sessions: ['thread-a', 'thread-b'] });

  assert.equal(answer.status, 'ok');
  assert.equal(answer.plan.clean.length, 0, 'an empty Complete list means no card is known Complete, not every card');
  assert.equal(answer.compact, null, 'a run that deletes nothing does not spend an hour copying the store');
  assert.equal(statSync(file).ino, inode);
  assert.equal(await countOf(file, 'span_events'), 2);
});

test('a dry-run sweep plans from every session and writes nothing', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const [a, b] = [1, 2].map(session);
  const { file, ledger } = await withStore(t, [span(at, 'a1', 0.05, a)], { retros: ['JUL-1'], cards: { [a]: 'JUL-1' } });
  const inode = statSync(file).ino;

  const answer = await sweep({ dryRun: true, sessions: [a, b] });

  assert.equal(answer.status, 'ok');
  assert.deepEqual(answer.plan.clean, [{ thread: a, card: 'JUL-1' }]);
  assert.equal(answer.mined.written, false);
  assert.equal(answer.mined.sessions, 2);
  // The sweep mines in memory on a dry run, so the deletion step must be handed those
  // rows: reading the ledger file would find it empty and refuse every planned session.
  assert.deepEqual(answer.deleted.map(entry => entry.status), ['dry-run'], 'a dry run counts what would go instead of refusing it');
  assert.equal(answer.deleted[0].deleted.span_events, 1);
  assert.equal(existsSync(ledger), false, 'a dry run leaves no ledger behind');
  assert.equal(await countOf(file, 'span_events'), 1);
  assert.equal(statSync(file).ino, inode);
});

test('the sessions a sweep mines come from the thread store, not from the spans', { skip: noDuckdb }, async (t) => {
  const at = daysAgo(1);
  const { dir, ledger } = await withStore(t, [span(at, 'a1', 0.05, 'thread-a')], {});
  const dbPath = join(dir, 'mastra.db');
  const db = new DatabaseSync(dbPath);
  db.exec('create table mastra_threads (id varchar primary key, title varchar, updatedAt timestamp)');
  db.prepare('insert into mastra_threads values (?, ?, ?)').run('thread-a', 'a session with spans', '2026-10-29T10:00:00Z');
  db.prepare('insert into mastra_threads values (?, ?, ?)').run('thread-b', 'a session with no spans at all', '2026-10-29T11:00:00Z');
  db.close();

  assert.deepEqual(listSessions(dbPath).map(session => session.thread), ['thread-a', 'thread-b']);
  assert.deepEqual(listSessions(join(dir, 'no-such.db')), [], 'a missing thread store is an empty list, not a crash');

  const answer = await sweep({ dbPath });

  assert.equal(answer.mined.sessions, 2, 'the session that produced no spans is still mined, so the plan can say why it was kept');
  assert.equal(Object.keys(readLedger(ledger).sessions).length, 2);
});

test('the sweep comment names what was kept and why', () => {
  const answer = {
    status: 'ok',
    store: '/tmp/observability.duckdb',
    mined: { sessions: 3, mined: 3, written: true },
    plan: {
      clean: [{ thread: 'thread-a', card: 'JUL-1' }],
      kept: [
        { thread: '13351dad-0d36-42f1-a43b-6e1d016cfa3e', card: 'JUL-284', why: 'kept on purpose: its second half has no retro' },
        { thread: 'thread-c', card: null, why: 'no card, no retro, not on the approved list' },
      ],
    },
    deleted: [{ thread: 'thread-a', card: 'JUL-1', status: 'ok', deleted: { span_events: 12, log_events: 3 } }],
    compact: { bytesBefore: 900 * 1024 ** 2, bytesAfter: 300 * 1024 ** 2, compactedBytes: 300 * 1024 ** 2, freeBefore: 16 * 1024 ** 3, freeAfter: 16 * 1024 ** 3 },
  };
  const body = sweepComment(answer);
  assert.match(body, /3 session\(s\) mined, 1 cleaned, 2 kept/);
  assert.match(body, /Rows deleted: 15 across span_events and log_events/);
  assert.match(body, /`13351dad-0d36-42f1-a43b-6e1d016cfa3e` \(JUL-284\) — kept on purpose/);
  assert.match(body, /`thread-c` — no card, no retro/);
  const nothing = sweepComment({ ...answer, plan: { clean: [], kept: [] }, deleted: [], compact: null });
  assert.match(nothing, /nothing was deleted, so nothing was compacted/);
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

test('a store is opened with a memory budget the machine can hold', { skip: noDuckdb }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'budget-'));
  const file = join(dir, 'store.duckdb');
  const { instance } = await openStore(file);
  t.after(() => {
    instance.closeSync?.();
    rmSync(dir, { recursive: true, force: true });
  });
  const connection = await instance.connect();
  const [row] = (await connection.runAndReadAll("select current_setting('memory_limit') as budget, current_setting('temp_directory') as spill")).getRowObjectsJson();
  const bytes = text => {
    const [size, unit] = String(text).split(' ');
    const scale = /GiB/i.test(unit) ? 1024 ** 3 : /MiB/i.test(unit) ? 1024 ** 2 : /KiB/i.test(unit) ? 1024 : 1;
    return Number(size) * scale;
  };
  assert.ok(bytes(row.budget) <= totalmem() * 0.4, `DuckDB's own default is 85% of this machine, which is 6 GB of the 7 GB it has: the kernel killed the sweep at 6.15 GB before it deleted a row (budget was ${row.budget})`);
  assert.equal(row.spill, `${file}.tmp`, 'what does not fit in the budget spills beside the store instead of asking the kernel for more');
});

test('a store that is not there is reported missing instead of crashing', async () => {
  const answer = await compactStore({ dryRun: true, store: '/tmp/no-such-trace-store.duckdb' });
  assert.equal(answer.status, 'missing');
});

test('the guard order is mined first, held second, card third, retro last', () => {
  const held = session(9);
  const dir = mkdtempSync(join(tmpdir(), 'guards-'));
  const retrosDir = join(dir, 'retros');
  mkdirSync(retrosDir, { recursive: true });
  const census = join(dir, 'census.md');
  writeFileSync(census, '# census\n');
  const ledger = { sessions: {} };
  assert.equal(deletionRefusal('thread-1', { ledger, retrosDir, census }).code, 'not-mined');
  ledger.sessions['thread-1'] = { thread: 'thread-1', card: null };
  assert.equal(deletionRefusal('thread-1', { ledger, retrosDir, census }).code, 'no-card');
  ledger.sessions['thread-1'].card = 'JUL-1';
  assert.equal(deletionRefusal('thread-1', { ledger, retrosDir, census }).code, 'no-retro');
  writeFileSync(join(retrosDir, 'JUL-1.md'), '# retro\n');
  assert.equal(deletionRefusal('thread-1', { ledger, retrosDir, census }), null);
  ledger.sessions[held] = { thread: held, card: 'JUL-1' };
  writeFileSync(census, censusDoc({ hold: { [held]: 'half of it has no retro' } }));
  const guard = deletionRefusal(held, { ledger, retrosDir, census });
  assert.equal(guard.code, 'held', 'a hold outranks the retro that is already written');
  assert.match(guard.message, /half of it has no retro/);
  rmSync(dir, { recursive: true, force: true });
});
