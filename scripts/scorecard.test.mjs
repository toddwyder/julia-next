import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { buildScorecard, cardForThread, cardWindows, catalogueRates, findStops, priceThreadUsage, readPings, readThreads, readTracing, renderScorecard, threadEvents, threadProjectPath, traceCopyFits, tracedCost } from './scorecard.mjs';
import { stopComment } from './stop-ping.mjs';
import { checkForToddGuard } from './linear-cli.mjs';
import { appendFileSync } from 'node:fs';

const REPO = new URL('..', import.meta.url).pathname;
const duckdbDir = [
  join(REPO, 'node_modules', '@duckdb', 'node-api'),
  join(process.env.HOME ?? '', '.local', 'lib', 'mastracode-program', 'node_modules', '@duckdb', 'node-api'),
].find(dir => existsSync(join(dir, 'package.json')));
// Reading real trace files is the only way to test the one-file-per-session rule, so CI
// opens them: the client is a dev dependency, and a silently skipped read proves nothing.
if (!duckdbDir && process.env.CI) {
  throw new Error('the scorecard tests cannot skip in CI: run npm ci so @duckdb/node-api is installed');
}
const duckdb = duckdbDir ? createRequire(join(duckdbDir, 'package.json'))('@duckdb/node-api') : {};

const T = iso => `2026-10-26T${iso}:00.000Z`;
const ms = iso => Date.parse(T(iso));
const opus = { provider: 'anthropic.messages', modelId: 'claude-opus-5-5' };
const user = (at, text) => ({ role: 'user', type: 'v2', createdAt: T(at), content: JSON.stringify({ parts: [{ type: 'text', text }] }) });
const assistant = (at, parts, metadata = opus) => ({ role: 'assistant', type: 'v2', createdAt: T(at), content: JSON.stringify({ metadata, parts }) });
const step = at => ({ type: 'step-start', createdAt: ms(at) });
const say = (at, text) => ({ type: 'text', text, createdAt: ms(at) });

// Two cards in one thread, as JUL-272 and JUL-273 ran on 26 October.
const rows = [
  user('18:00', 'Card: JUL-272 (https://linear.app/x). Build it.'),
  assistant('18:00', [step('18:01'), say('18:02', 'Starting.'), step('18:05'),
    { type: 'tool-invocation', createdAt: ms('18:06'), updatedAt: ms('18:20'), toolInvocation: { toolName: 'ask_user', args: { question: 'Which colour?' } } }]),
  user('18:20', ''),
  assistant('18:20', [step('18:21'), say('18:30', 'PR is open.')], { mastra: {} }),
  user('18:40', 'Looks good, merged.'),
  user('19:00', 'Start JUL-273'),
  assistant('19:00', [step('19:01'), { type: 'tool-invocation', createdAt: ms('19:02'), updatedAt: ms('19:05'), toolInvocation: { toolName: 'subagent', args: { agentType: 'execute', modelId: 'openai/gpt-6.1-sol' } } }, say('19:10', 'Ready for you.')]),
];
const thread = { id: 'thread-1', title: 'JUL-273 merged', usage: { promptTokens: 1_000_000, cachedInputTokens: 900_000, cacheCreationInputTokens: 90_000, cacheCreationInputTokens1h: 90_000, completionTokens: 10_000 }, events: threadEvents(rows) };
const prices = { anthropic: { models: { 'claude-opus-5-5': { cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } } } } };

test('kickoff messages split one thread into card windows', () => {
  const windows = cardWindows(thread, thread.events);
  assert.deepEqual(windows.map(w => [w.card, w.start, w.end]), [['JUL-272', ms('18:00'), ms('19:00')], ['JUL-273', ms('19:00'), Infinity]]);
});

test('a thread with no kickoff falls back to the JUL id in its title', () => {
  const t = { id: 't', title: 'JUL-274 trace probe', events: threadEvents([user('10:00', 'Reply ok.')]) };
  assert.deepEqual(cardWindows(t, t.events).map(w => w.card), ['JUL-274']);
});

test('a chat that names the card in its opening message is that card run, and one that names none is not', () => {
  const named = { id: 't', title: 'Slice 3 handoff', events: threadEvents([user('10:00', 'Continue Slice 3 (JUL-283) from the branch.'), user('10:30', 'continue.')]) };
  assert.deepEqual(cardWindows(named, named.events).map(w => w.card), ['JUL-283']);
  const unnamed = { id: 't', title: 'Untitled', events: threadEvents([user('10:00', 'Reply ok.')]) };
  assert.deepEqual(cardWindows(unnamed, unnamed.events), []);
});

test('a chat started from the card address is that card run, and its window starts at that message', () => {
  // Mastra renames a thread as the work goes on, so the title stops naming the card and
  // the opening message is what is left. The first row can be a continue reminder.
  const t = {
    id: 't',
    title: 'Revoked key; ping card fix',
    events: threadEvents([
      user('10:00', 'Please continue naturally with the conversation so far.'),
      user('10:05', 'Read the skill and build the card at https://linear.app/julia-next/issue/JUL-307/remediation-a-fail-goes-back.'),
      user('11:00', 'Carry on.'),
    ]),
  };
  assert.deepEqual(cardWindows(t, t.events).map(w => [w.card, w.start]), [['JUL-307', ms('10:05')]]);
});

test('a chat whose opening turns name more than one card is not billed to one of them', () => {
  const t = {
    id: 't',
    title: 'Housekeeping',
    events: threadEvents([user('10:00', 'Compare JUL-307 with JUL-313 and tell me what differs.')]),
  };
  assert.deepEqual(cardWindows(t, t.events), []);
});

test('a stop lasts from the last agent activity to the reply; an ask_user answer is not agent activity, and back-to-back user messages are one stop', () => {
  const stops = findStops(thread.events);
  assert.deepEqual(stops.map(s => [s.kind, (s.resumed - s.since) / 60_000]), [['question', 14], ['turn ended', 10]]);
  assert.equal(stops[0].question, 'Which colour?');
  assert.equal(stops[1].question, 'PR is open.');
});

// JUL-272 on 26 October: the agent resumed one second after the answer, before the empty user row was written.
test('an ask_user wait ends at the answer, even when the agent resumes before the user row is written', () => {
  const at = s => Date.parse(`2026-10-26T${s}.000Z`);
  const events = threadEvents([
    { role: 'user', type: 'v2', createdAt: '2026-10-26T19:00:53.000Z', content: JSON.stringify({ parts: [{ type: 'text', text: 'continue' }] }) },
    { role: 'assistant', type: 'v2', createdAt: '2026-10-26T19:00:58.000Z', content: JSON.stringify({ metadata: opus, parts: [
      { type: 'text', text: 'PR is open.', createdAt: at('19:00:58') },
      { type: 'tool-invocation', createdAt: at('19:00:58'), updatedAt: at('19:30:18'), toolInvocation: { toolName: 'ask_user', args: { question: 'Merge it?' } } },
      { type: 'step-start', createdAt: at('19:30:19') - 400 },
    ] }) },
    { role: 'user', type: 'v2', createdAt: '2026-10-26T19:30:19.000Z', content: JSON.stringify({ parts: [{ type: 'text', text: '' }] }) },
  ]);
  const stops = findStops(events);
  assert.deepEqual(stops.map(s => [s.kind, s.question, Math.round((s.resumed - s.since) / 1000)]), [['question', 'Merge it?', 1760]]);
});

test('thread usage is split into fresh input, cache reads, cache writes and output, with 1-hour writes at 1.6x', () => {
  const priced = priceThreadUsage(thread.usage, prices.anthropic.models['claude-opus-5-5'].cost);
  assert.deepEqual(priced.tokens, { input: 10_000, cacheRead: 900_000, cacheWrite: 90_000, output: 10_000 });
  assert.equal(priced.usd.toFixed(4), (0.04 + 0.18 + 0.72 + 0.2).toFixed(4));
  assert.deepEqual(priceThreadUsage(thread.usage, undefined).parts, undefined);
});

test('traced cost sums only the two total metrics, so detail metrics are not counted twice', () => {
  const metric = (name, value, estimatedCost) => ({ entityName: 'Code Agent', provider: 'anthropic', model: 'claude-opus-5-5', name, value, estimatedCost });
  const rowsOut = tracedCost([
    metric('mastra_model_total_input_tokens', 100, 0.3), metric('mastra_model_total_output_tokens', 10, 0.2),
    metric('mastra_model_input_cache_read_tokens', 80, 0.1), metric('mastra_model_input_cache_write_tokens', 10, 0.2),
    { ...metric('mastra_model_total_input_tokens', 50, null), entityName: 'Explore Subagent', provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash' },
  ]);
  assert.equal(rowsOut[0].usd, 0.5);
  assert.deepEqual([rowsOut[1].agent, rowsOut[1].unpriced, rowsOut[1].usd], ['Explore Subagent', true, 0]);
});

test('a card scorecard prices its share of the thread, lists its subagents and judges success against Todd\'s UAT yes', () => {
  const pulls = [{ number: 358, headRefName: 'feat/jul-273-x', createdAt: T('19:20'), mergedAt: T('19:40') }];
  const s = buildScorecard({ card: 'JUL-273', threads: [thread], prices, tracing: { metrics: [], requested: [] }, pulls, pings: [], uat: { yesAt: T('19:30'), said: 'Yes.' } });
  assert.equal(s.cost[0].basis, '25% of thread total (1 of 4 model steps)');
  assert.equal(s.cost[0].usd.toFixed(4), (1.14 / 4).toFixed(4));
  assert.deepEqual(s.cost[1], { agent: 'Subagent execute x1', requested: 'openai/gpt-6.1-sol', answered: 'not recorded before tracing', tokens: {}, usd: 0, unpriced: true, basis: 'usage not recorded before tracing' });
  assert.deepEqual([s.stops.length, s.success], [0, true]);

  // JUL-272 as Todd ruled it: a stop before the yes counts, even with the PR already open.
  const card272 = uat => buildScorecard({ card: 'JUL-272', threads: [thread], prices, tracing: { metrics: [], requested: [] }, pulls: [{ ...pulls[0], headRefName: 'feat/jul-272-y', createdAt: T('18:05') }], pings: [], uat });
  const plain = card272({ yesAt: T('18:40'), said: 'Looks good, merged.' });
  assert.deepEqual(plain.stops.map(x => [x.counts, Boolean(x.isUatWait)]), [[true, false], [false, true]]);
  assert.deepEqual([plain.stopsBeforeUat, plain.success], [1, false]);
  assert.match(renderScorecard(plain, new Date(ms('20:00'))), /Success: \*\*no\*\*\. Stops before Todd's UAT yes: 1/);
  assert.match(renderScorecard(plain, new Date(ms('20:00'))), /1\. Asked at 2026-10-26 18:06:\n\n   > Which colour\?/);
  assert.equal(card272({ yesAt: T('18:40'), said: 'Yes', alsoAsked: 'for a secret' }).stopsBeforeUat, 2);
  assert.equal(card272(undefined).success, undefined);
});

test('missing run records cannot establish success or zero spend', () => {
  const s = buildScorecard({ card: 'JUL-272', threads: [], prices, tracing: { metrics: [], requested: [] }, pulls: [], pings: [], uat: { yesAt: T('18:40'), said: 'Yes' } });
  assert.equal(s.success, undefined);
  const markdown = renderScorecard(s);
  assert.match(markdown, /no matching run records/);
  assert.match(markdown, /Cost: \*\*unknown\*\*/);
  assert.doesNotMatch(markdown, /every row priced|\$0\.00/);
});

test('detailed stop replies retain their complete multiline text', () => {
  const reply = 'A long reply '.repeat(30) + '\nIMPORTANT_END_OF_REPLY';
  const events = threadEvents([user('18:00', 'Card: JUL-272'), assistant('18:01', [step('18:01'), say('18:02', 'Ready?')]), user('18:20', reply)]);
  const s = buildScorecard({ card: 'JUL-272', threads: [{ ...thread, events }], prices, tracing: { metrics: [], requested: [] }, pulls: [], pings: [] });
  assert.match(renderScorecard(s), /\n   > IMPORTANT_END_OF_REPLY/);
});

test('a stop takes only a ping recorded inside it, never one from just before', () => {
  const ping = at => ({ id: at, at: T(at), thread: 'thread-1', card: 'JUL-272', comment: `https://linear.app/${at}`, notified: true });
  const s = buildScorecard({ card: 'JUL-272', threads: [thread], prices, tracing: { metrics: [], requested: [] }, pulls: [], pings: [ping('18:03'), ping('18:31')] });
  assert.deepEqual(s.stops.map(x => x.ping?.id), [undefined, '18:31']);
});

test('mastra.db is read the way Mastra Code stores it, and a session maps to its card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-db-'));
  try {
    const db = new DatabaseSync(join(dir, 'mastra.db'));
    db.exec('create table mastra_threads (id text, title text, metadata text); create table mastra_messages (thread_id text, role text, type text, createdAt text, content text)');
    db.prepare('insert into mastra_threads values (?, ?, ?)').run('thread-1', 'Some title', JSON.stringify({ tokenUsage: thread.usage }));
    for (const r of rows) db.prepare('insert into mastra_messages values (?, ?, ?, ?, ?)').run('thread-1', r.role, r.type, r.createdAt, r.content);
    db.close();
    assert.equal(readThreads(join(dir, 'mastra.db'))[0].events.steps.length, 4);
    assert.equal(cardForThread(join(dir, 'mastra.db'), 'thread-1'), 'JUL-273');
    assert.equal(cardForThread(join(dir, 'mastra.db'), 'other'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a thread whose metadata is not JSON does not stop the scorecard reading the others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-blob-'));
  try {
    const db = new DatabaseSync(join(dir, 'mastra.db'));
    db.exec('create table mastra_threads (id text, title text, metadata text); create table mastra_messages (thread_id text, role text, type text, createdAt text, content text)');
    db.prepare('insert into mastra_threads values (?, ?, ?)').run('thread-1', 'Some title', JSON.stringify({ tokenUsage: thread.usage }));
    db.prepare('insert into mastra_threads values (?, ?, ?)').run('thread-2', 'A blob', Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    for (const r of rows) db.prepare('insert into mastra_messages values (?, ?, ?, ?, ?)').run('thread-1', r.role, r.type, r.createdAt, r.content);
    db.close();
    const threads = readThreads(join(dir, 'mastra.db'));
    assert.deepEqual(threads.map(t => t.title), ['Some title', 'A blob']);
    assert.equal(threads[1].usage, undefined);
    assert.equal(threadProjectPath(join(dir, 'mastra.db'), 'thread-2'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The libSQL store saves metadata with `jsonb()`, so a real thread row holds binary
// JSON. Reading only text JSON silently lost every session's token counts.
test('thread metadata written as binary JSON still gives up its token counts and its project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-jsonb-'));
  try {
    const db = new DatabaseSync(join(dir, 'mastra.db'));
    db.exec('create table mastra_threads (id text, title text, metadata blob); create table mastra_messages (thread_id text, role text, type text, createdAt text, content text)');
    const metadata = JSON.stringify({ projectPath: '/home/ubuntu/julia-builder', tokenUsage: thread.usage });
    db.prepare('insert into mastra_threads values (?, ?, jsonb(?))').run('thread-1', 'Some title', metadata);
    for (const r of rows) db.prepare('insert into mastra_messages values (?, ?, ?, ?, ?)').run('thread-1', r.role, r.type, r.createdAt, r.content);
    db.close();
    assert.deepEqual(readThreads(join(dir, 'mastra.db'))[0].usage, thread.usage);
    assert.equal(threadProjectPath(join(dir, 'mastra.db'), 'thread-1'), '/home/ubuntu/julia-builder');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stop and ping lines with one id merge into one record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-stops-'));
  try {
    const file = join(dir, 'stops.jsonl');
    appendFileSync(file, JSON.stringify({ id: 'a', at: T('18:06'), thread: 'thread-1', card: 'JUL-272', reason: 'ask_question' }) + '\n');
    appendFileSync(file, JSON.stringify({ id: 'a', comment: 'https://linear.app/c', notified: false }) + '\n');
    assert.deepEqual(readPings(file), [{ id: 'a', at: T('18:06'), thread: 'thread-1', card: 'JUL-272', reason: 'ask_question', comment: 'https://linear.app/c', notified: false }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every stop comment mentions Todd and passes the For-Todd guard', () => {
  for (const reason of ['ask_question', 'tool_approval', 'plan_approval', 'sandbox_access', 'agent_done', 'something_new']) {
    const body = stopComment({ reason, message: 'Which colour?\nRed or blue', thread: 'thread-1' });
    assert.match(body, /^https:\/\/linear\.app\/julia-next\/profiles\/toddwyder /);
    assert.match(body, /> Which colour\?\n> Red or blue/);
    assert.deepEqual(checkForToddGuard(body), { ok: true });
  }
});

test('the trace store is only copied when there is room left on the disk', () => {
  const gb = 1024 ** 3;
  assert.equal(traceCopyFits(22 * gb, 20 * gb), false);
  assert.equal(traceCopyFits(2 * gb, 20 * gb), true);
  assert.equal(traceCopyFits(19.6 * gb, 20 * gb), false);
});

test('a folded archive with no span rows still prices the cost rows it holds', async t => {
  const { DuckDBInstance } = duckdb;
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-fold-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const thread = '13351dad-0d36-42f1-a43b-6e1d016cfa3e';
  const make = async (file, statements) => {
    const instance = await DuckDBInstance.create(file);
    const connection = await instance.connect();
    try {
      for (const sql of statements) await connection.run(sql);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  };
  const metric = `create table metric_events (timestamp timestamp, threadId varchar, entityName varchar, provider varchar,
    model varchar, name varchar, value double, estimatedCost double)`;
  // A session file has both tables. The archive the fold builds keeps cost rows only.
  await make(join(dir, 'session.duckdb'), [
    metric,
    `create table span_events (timestamp timestamp, threadId varchar, entityName varchar, attributes json, spanType varchar, endedAt timestamp)`,
    `insert into metric_events values (timestamp '2026-10-30 03:00:00', '${thread}', 'Code Agent', 'commandcode.chat',
      'deepseek/deepseek-v4.1-flash', 'mastra_model_total_input_tokens', 1000, 0.15)`,
    `insert into span_events values (timestamp '2026-10-30 03:00:00', '${thread}', 'Code Agent',
      '{"provider":"commandcode.chat","model":"deepseek/deepseek-v4.1-flash"}', 'model_generation', null)`,
  ]);
  await make(join(dir, 'archive.duckdb'), [
    metric,
    `insert into metric_events values (timestamp '2026-10-30 18:00:00', '${thread}', 'Code Agent', 'commandcode.chat',
      'deepseek/deepseek-v4.1-flash', 'mastra_model_total_input_tokens', 2000, 0.30)`,
  ]);

  const tracing = await readTracing(REPO, [{ path: join(dir, 'session.duckdb'), name: 'session.duckdb' }, { path: join(dir, 'archive.duckdb'), name: 'archive.duckdb' }], [thread]);
  assert.equal(tracing.skipped, null, 'a file with no spans is not an unreadable file');
  assert.deepEqual(tracing.metrics.map(m => m.value), [1000, 2000], 'both files price the card');
  assert.equal(tracing.requested.length, 1, 'only the session file can name the model that answered');
});

// DuckDB takes its lock per process, so the only honest holder of a live trace file is a
// second process. It keeps the file open until its stdin closes.
function holdOpen(file) {
  const script = [
    "import { createRequire } from 'node:module';",
    `const { DuckDBInstance } = createRequire(${JSON.stringify(join(duckdbDir, 'package.json'))})('@duckdb/node-api');`,
    `const instance = await DuckDBInstance.create(${JSON.stringify(file)});`,
    'await instance.connect();',
    "process.stdin.on('end', () => process.exit(0));",
    'process.stdin.resume();',
    "console.log('holding');",
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { errors += chunk; });
  const ready = new Promise((ok, fail) => {
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { out += chunk; if (out.includes('holding')) ok(); });
    child.on('exit', code => fail(new Error(`the holder exited with ${code} before it held the file: ${errors.trim()}`)));
  });
  const stop = async () => {
    child.stdin.end();
    await new Promise(ok => child.on('exit', ok));
  };
  return { ready, stop };
}

// A session still running holds its file, so that one file is the only one worth copying.
// If the lock is not recognised the card's cost quietly loses those rows instead.
test('a trace file a running session holds is copied, and its cost still counts', { skip: duckdbDir ? false : 'no @duckdb/node-api on this machine' }, async t => {
  const { DuckDBInstance } = duckdb;
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-live-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const thread = '9f1c0a2e-0d36-42f1-a43b-6e1d016cfa3f';
  const file = join(dir, 'live.duckdb');
  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  await connection.run(`create table metric_events (timestamp timestamp, threadId varchar, entityName varchar, provider varchar,
    model varchar, name varchar, value double, estimatedCost double)`);
  await connection.run(`insert into metric_events values (timestamp '2026-10-30 03:00:00', '${thread}', 'Code Agent',
    'commandcode.chat', 'deepseek/deepseek-v4.1-flash', 'mastra_model_total_input_tokens', 1000, 0.15)`);
  connection.closeSync();
  instance.closeSync();

  const holder = holdOpen(file);
  await holder.ready;
  let tracing;
  try {
    tracing = await readTracing(REPO, [{ path: file, name: 'live.duckdb' }], [thread]);
  } finally {
    await holder.stop();
  }
  assert.equal(tracing.skipped, null, 'a held file is read, not reported as unreadable');
  assert.deepEqual(tracing.metrics.map(m => m.value), [1000]);
});

test('a trace file that is not a database is reported, not passed over in silence', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-junk-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'junk.duckdb'), 'this is not a database');
  const tracing = await readTracing(REPO, [{ path: join(dir, 'junk.duckdb'), name: 'junk.duckdb' }], ['some-thread']);
  assert.deepEqual(tracing.metrics, []);
  assert.match(tracing.skipped, /^junk\.duckdb could not be read \(/);
  assert.match(tracing.skipped, /this card’s cost is unknown$/);
});

// A trace a failed cleanup left on disk holds rows that never reached the archive, so a card
// whose threads it answers must say so. It is named rather than priced: a fold may already
// have copied its rows, and reading them again would count the card's cost twice.
test('a trace a failed cleanup left behind is named on the card it carries', { skip: duckdbDir ? false : 'no @duckdb/node-api on this machine' }, async t => {
  const { DuckDBInstance } = duckdb;
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-left-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const thread = '9f1c0a2e-0d36-42f1-a43b-6e1d016cfa3f';
  const metric = `create table metric_events (timestamp timestamp, threadId varchar, entityName varchar, provider varchar,
    model varchar, name varchar, value double, estimatedCost double)`;
  const write = async (file, rows) => {
    const instance = await DuckDBInstance.create(file);
    const connection = await instance.connect();
    try {
      await connection.run(metric);
      for (const [id, value] of rows) {
        await connection.run(`insert into metric_events values (timestamp '2026-10-30 03:00:00', '${id}', 'Code Agent',
          'commandcode.chat', 'deepseek/deepseek-v4.1-flash', 'mastra_model_total_input_tokens', ${value}, 0.15)`);
      }
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  };
  await write(join(dir, 'session.duckdb'), [[thread, 1000]]);
  await write(join(dir, 'left.duckdb.folding'), [[thread, 77]]);
  const files = [{ path: join(dir, 'session.duckdb'), name: 'session.duckdb' }];
  const leftBehind = [{ path: join(dir, 'left.duckdb.folding'), name: 'left.duckdb.folding', reason: 'could not fold left.duckdb: No space left on device' }];

  const tracing = await readTracing(REPO, files, [thread], leftBehind);
  assert.deepEqual(tracing.metrics.map(m => m.value), [1000], 'its rows are not counted a second time');
  assert.match(tracing.skipped, /^left\.duckdb\.folding is still on disk because its cleanup failed \(could not fold left\.duckdb: No space left on device\), so part of this card’s cost is missing$/);

  const unrelated = await readTracing(REPO, files, ['55555555-5555-4555-8555-555555555555'], leftBehind);
  assert.equal(unrelated.skipped, null, 'a card it does not carry is not told about it');
});

// The launcher is what gives each session its own trace file. A session started any other way
// records nothing at all, and nothing else on the machine notices, so the card has to say so.
test('a session that started after the launcher and recorded nothing makes the cost incomplete', () => {
  const scorecard = since => buildScorecard({
    card: 'JUL-273', threads: [thread], prices, tracing: { metrics: [], requested: [], launcher: since }, pulls: [], pings: [], uat: undefined,
  });
  const after = scorecard({ since: ms('18:30'), problem: null });
  assert.match(after.tracingSkipped, /^1 session of this card started after the launcher and recorded no trace rows$/);
  assert.match(renderScorecard(after), /^- Cost incomplete: 1 session of this card started after the launcher and recorded no trace rows\.$/m);

  // A run from before the launcher existed is history, not a loss this card can fix.
  assert.equal(scorecard({ since: ms('20:00'), problem: null }).tracingSkipped, undefined);

  // A replaced launcher is the other way a session loses its rows.
  const replaced = scorecard({ since: null, problem: 'the launcher runs something else' });
  assert.equal(replaced.tracingSkipped, 'the launcher runs something else');
  assert.match(renderScorecard(replaced), /^- Cost incomplete: the launcher runs something else\.$/m);
});

test('a card whose trace file was too large to copy says why its cost is unknown', () => {
  const skipped = 'the trace store is 21 GB and only 20 GB is free to copy it';
  const scorecard = buildScorecard({
    card: 'JUL-283',
    threads: [],
    prices: {},
    tracing: { metrics: [], requested: [], skipped },
    pulls: [],
    pings: [],
    uat: undefined,
  });
  assert.equal(scorecard.tracingSkipped, skipped);
  assert.match(renderScorecard(scorecard), /The trace store is 21 GB and only 20 GB is free to copy it/);
});

test('a card with no trace store at all still says no usage records were found', () => {
  const scorecard = buildScorecard({ card: 'JUL-283', threads: [], prices: {}, tracing: { metrics: [], requested: [], skipped: null }, pulls: [], pings: [], uat: undefined });
  assert.match(renderScorecard(scorecard), /No usage records found for this card/);
});

test('a slice card finds its PR even when the branch is named after the parent card', () => {
  const pull = { number: 378, headRefName: 'feat/jul-276-model-sweep', createdAt: T('19:20') };
  const s = buildScorecard({ card: 'JUL-283', threads: [], prices: {}, tracing: { metrics: [], requested: [] }, pulls: [pull], pings: [], uat: undefined });
  assert.equal(s.pull, pull);
  assert.match(renderScorecard(s), /PR #378, opened 2026-10-26 19:20/);
});

test('two PRs that mention the card are not guessed at', () => {
  const s = buildScorecard({ card: 'JUL-283', threads: [], prices: {}, tracing: { metrics: [], requested: [] }, pulls: [{ number: 378, headRefName: 'feat/jul-276-a' }, { number: 379, headRefName: 'feat/jul-276-b' }], pings: [], uat: undefined });
  assert.equal(s.pull, undefined);
});

test('rows with no token detail say unknown instead of claiming zero spend', () => {
  const scorecard = buildScorecard({ card: 'JUL-283', threads: [], prices: {}, tracing: { metrics: [], requested: [], skipped: null }, pulls: [], pings: [], uat: undefined });
  const priced = { ...scorecard, cost: [{ agent: 'Code Agent (main chat)', requested: 'commandcode/…', answered: 'not recorded', tokens: {}, usd: 0, unpriced: true, basis: 'thread total' }] };
  assert.match(renderScorecard(priced), /Cost: \*\*unknown\*\*\. Mastra kept no token detail for these runs\./);
  assert.doesNotMatch(renderScorecard(priced), /Cost: \*\*\$0\.00\*\*/);
});

// 30 October: JUL-283 read $0.04 for 65 million tokens because Mastra publishes no price
// for CommandCode. That was the scorecard's own doing, so it is checked here.
test('a traced row Mastra cannot price is priced from our own list', () => {
  const catalogue = { models: [{ provider: 'commandcode', name: 'deepseek/deepseek-v4.1-flash', inputPerMillion: 0.15, outputPerMillion: 0.6 }] };
  assert.deepEqual(catalogueRates(catalogue, 'commandcode.chat/deepseek/deepseek-v4.1-flash-1017-cm'), { input: 0.15, output: 0.6 });
  assert.equal(catalogueRates(catalogue, 'anthropic/claude-sonnet-5'), undefined, 'a provider our sweep never priced stays unpriced');

  const line = name => ({ threadId: 'thread-9', at: ms('10:05'), entityName: 'Code Agent', provider: 'commandcode.chat', model: 'deepseek/deepseek-v4.1-flash-1017-cm', name, value: 0, estimatedCost: null });
  const traced = [
    line('mastra_model_total_input_tokens'),
    line('mastra_model_total_output_tokens'),
    { ...line('mastra_model_input_text_tokens'), value: 1_000_000 },
    { ...line('mastra_model_input_cache_read_tokens'), value: 1_000_000 },
    { ...line('mastra_model_total_output_tokens'), value: 1_000_000 },
  ];
  const [priced] = tracedCost(traced, model => catalogueRates(catalogue, model));
  // Our list carries no cache-read rate for this model, so those tokens stay unpriced
  // rather than being charged at the input rate: the guess made 59 million tokens cost $8.94.
  assert.equal(priced.unpriced, false);
  assert.equal(priced.usd.toFixed(2), (0.15 + 0.6).toFixed(2));
  assert.equal(priced.cacheReadUnpriced, 1_000_000);

  const session = { id: 'thread-9', title: 'JUL-284 shrink the trace store', events: threadEvents([user('10:00', 'Card: JUL-284. Start.')]) };
  const card = buildScorecard({
    card: 'JUL-284', threads: [session], prices: {}, catalogue,
    tracing: { metrics: traced, requested: [{ threadId: 'thread-9', at: ms('10:05'), entityName: 'Code Agent', provider: null, model: null }], skipped: null },
    pulls: [], pings: [], uat: undefined,
  });
  assert.equal(card.windows, 1);
  assert.equal(card.usd.toFixed(2), (0.15 + 0.6).toFixed(2));
  assert.equal(card.cost[0].basis, 'our price list; cache read unpriced');
  assert.equal(card.cost[0].requested, 'not recorded', 'a span that names no model is not a model called null/null');
});

test('a scorecard with no UAT yes says where the yes is written down, instead of leaving the reader to grep', () => {
  // 1 November 2026: a slice scorecard read "not decided yet (no UAT yes recorded)" and nothing
  // said where a yes lives, so the answer cost a read of this script.
  const s = buildScorecard({ card: 'JUL-273', threads: [thread], prices, tracing: { metrics: [], requested: [] }, pulls: [], pings: [] });
  const markdown = renderScorecard(s, new Date(ms('20:00')));
  assert.match(markdown, /Success: \*\*not decided yet \(no UAT yes recorded\)\*\*/);
  assert.match(markdown, /- To record it: write `"JUL-273": \{"yesAt": "<UTC time>", "said": "<his words>"\}` into docs\/scorecards\/uat\.json/);
});

test('a scorecard that has its yes, or no run records to judge, gets no reminder', () => {
  const said = buildScorecard({ card: 'JUL-273', threads: [thread], prices, tracing: { metrics: [], requested: [] }, pulls: [], pings: [], uat: { yesAt: T('19:30'), said: 'approve it' } });
  assert.doesNotMatch(renderScorecard(said), /docs\/scorecards\/uat\.json/);
  const noRuns = buildScorecard({ card: 'JUL-301', threads: [], prices, tracing: { metrics: [], requested: [] }, pulls: [], pings: [] });
  assert.doesNotMatch(renderScorecard(noRuns), /docs\/scorecards\/uat\.json/);
});
