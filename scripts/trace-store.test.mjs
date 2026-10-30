import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { foldTraces, parseArgs, status } from './trace-store.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const duckdbDir = [
  join(REPO, 'node_modules', '@duckdb', 'node-api'),
  join(process.env.HOME ?? '', '.local', 'lib', 'mastracode-program', 'node_modules', '@duckdb', 'node-api'),
].find(dir => existsSync(join(dir, 'package.json')));
// The DuckDB client is a dev dependency, so CI opens real files. A green run that skipped
// every store test is how an unreviewed script deleted live sessions, so a missing client
// fails the file in CI instead of skipping it.
if (!duckdbDir && process.env.CI) {
  throw new Error('the trace-store tests cannot skip in CI: run npm ci so @duckdb/node-api is installed');
}
const { DuckDBInstance } = duckdbDir ? createRequire(join(duckdbDir, 'package.json'))('@duckdb/node-api') : {};

const SCHEMA = [
  `create table span_events (timestamp timestamp not null, traceId varchar, spanId varchar, threadId varchar,
     spanType varchar, name varchar, endedAt timestamp, input json, primary key (spanId))`,
  `create table metric_events (timestamp timestamp not null, metricId varchar primary key, threadId varchar, entityName varchar,
     provider varchar, model varchar, name varchar, value double, estimatedCost double)`,
];
const SLICE = '13351dad-0d36-42f1-a43b-6e1d016cfa3e';
const OTHER = '22222222-2222-4222-8222-222222222222';

// One session's own trace file: the prompt payloads a scorecard never needs, and the token
// rows it prices a card from.
async function writeSession(file, metrics, spans) {
  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  try {
    for (const sql of SCHEMA) await connection.run(sql);
    for (const [id, value, thread] of metrics) {
      await connection.run(`insert into metric_events values (timestamp '2026-10-30 03:00:00', '${id}', '${thread}', 'Code Agent',
        'commandcode.chat', 'deepseek/deepseek-v4.1-flash', 'mastra_model_total_input_tokens', ${value}, 0.15)`);
    }
    for (const [id, thread] of spans) {
      await connection.run(`insert into span_events values (timestamp '2026-10-30 03:00:00', '${id}', '${id}', '${thread}',
        'processor_run', 'observe', null, '{"body":"a prompt nobody needs after the retro"}')`);
    }
  } finally {
    // The connection holds the file open, so closing only the instance leaves the lock behind.
    connection.closeSync();
    instance.closeSync();
  }
}

async function rows(file, sql) {
  const instance = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' });
  const connection = await instance.connect();
  try {
    return (await connection.runAndReadAll(sql)).getRowObjectsJson();
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'traces-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const traces = join(dir, 'traces');
  mkdirSync(traces);
  return { dir, traces, legacy: join(dir, 'observability.duckdb'), archive: join(traces, 'archive.duckdb') };
}

// Every session gets a file of its own, so a fold is what keeps the disk bounded: the cost
// rows of a finished file land in the archive, the file goes, and its prompt payloads go with
// it. Folding the same file twice must not count its cost twice.
test('a fold keeps the cost rows of finished sessions and deletes their files', { skip: duckdbDir ? false : 'no @duckdb/node-api on this machine' }, async t => {
  const { traces, legacy, archive } = await scratch(t);
  const session = join(traces, '20261030T011719Z-123088.duckdb');
  await writeSession(session, [['m1', 1000, SLICE], ['m2', 200, SLICE]], [['s1', SLICE], ['s2', OTHER]]);
  await writeSession(legacy, [['m3', 7, OTHER]], []);

  const answer = await foldTraces({ dir: traces, legacy });

  assert.equal(answer.status, 'ok');
  assert.deepEqual(answer.folded, [{ file: '20261030T011719Z-123088.duckdb', metrics: 2 }, { file: 'observability.duckdb', metrics: 1 }]);
  assert.deepEqual(answer.skipped, []);
  assert.equal(existsSync(session), false, 'the finished session file is gone, and with it its prompt payloads');
  assert.equal(existsSync(legacy), false, 'the single file every session used before this is emptied the same way');
  assert.deepEqual(await rows(archive, 'select source_file, metricId, value from metric_events order by metricId'), [
    { source_file: '20261030T011719Z-123088.duckdb', metricId: 'm1', value: 1000 },
    { source_file: '20261030T011719Z-123088.duckdb', metricId: 'm2', value: 200 },
    { source_file: 'observability.duckdb', metricId: 'm3', value: 7 },
  ], 'the archive keeps the tokens and the cost, and no span rows');

  // The same session name folded again replaces its rows instead of adding a second copy.
  await writeSession(session, [['m1', 1000, SLICE]], []);
  await foldTraces({ dir: traces, legacy });
  const copies = (await rows(archive, `select count(*) as n from metric_events where source_file = '20261030T011719Z-123088.duckdb'`))[0].n;
  assert.equal(Number(copies), 1, 'a fold is idempotent');

  const again = await foldTraces({ dir: traces, legacy });
  assert.deepEqual(again.folded, [], 'nothing is left to fold');
  assert.ok(statSync(archive).size > 0, 'the archive holds the cost rows');
});

// A file a running session still holds is the one thing a fold must not touch: renaming it
// would take the session's own rows with it. DuckDB takes its lock per process, so the only
// honest holder is a second process. It keeps the file open until its stdin closes.
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
  enfant: {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { errors += chunk; });
  }
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

test('a fold leaves a file a session still holds', { skip: duckdbDir ? false : 'no @duckdb/node-api on this machine' }, async t => {
  const { traces, legacy } = await scratch(t);
  const live = join(traces, '20261030T120000Z-999.duckdb');
  await writeSession(live, [['m1', 5, SLICE]], []);
  const holder = holdOpen(live);
  await holder.ready;
  try {
    const answer = await foldTraces({ dir: traces, legacy });
    assert.deepEqual(answer.folded, []);
    assert.equal(answer.skipped.length, 1, 'the held file is reported, not silently ignored');
    assert.equal(answer.skipped[0].file, '20261030T120000Z-999.duckdb');
    assert.equal(existsSync(live), true, 'the running session keeps its file');
  } finally {
    await holder.stop();
  }
  const later = await foldTraces({ dir: traces, legacy });
  assert.equal(later.folded.length, 1, 'the next fold takes it once the session has gone');
  assert.equal(existsSync(live), false);
});

// `status` answers while a session holds the store, so it asks the filesystem and nothing else.
test('status reports every trace file and the alarm without opening one', t => {
  const dir = mkdtempSync(join(tmpdir(), 'traces-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'archive.duckdb'), 'x'.repeat(10));
  writeFileSync(join(dir, '20261030T011719Z-123088.duckdb'), 'x'.repeat(20));
  writeFileSync(join(dir, 'half.folding'), 'x'.repeat(40));
  const answer = status({ dir, legacy: join(dir, 'missing.duckdb') });
  assert.deepEqual(answer.files.map(f => f.name), ['20261030T011719Z-123088.duckdb', 'archive.duckdb'], 'the live session file and the archive');
  assert.deepEqual(answer.pending, ['20261030T011719Z-123088.duckdb', 'half.folding'], 'the fold takes the half-finished file too');
  assert.equal(answer.bytes, 30);
  assert.equal(answer.overAlarm, false);
});

// `clean <id>` with no `--card` once read its own session id as a flag's value and refused
// the call, so the shape of the command is read in one place a test can call.
test('fold takes no argument but --quiet', () => {
  assert.deepEqual(parseArgs(['fold']), { command: 'fold', words: [], flags: {} });
  assert.deepEqual(parseArgs(['fold', '--quiet']), { command: 'fold', words: [], flags: { quiet: true } });
  assert.deepEqual(parseArgs(['status']), { command: 'status', words: [], flags: {} });
  assert.throws(() => parseArgs(['fold', '--card']), /--card is not an option/);
});
