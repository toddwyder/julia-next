import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { CardLedger } from '../ledger.mjs';

const input = (maximumNano = 0) => ({ model: 'model-a', role: 'builder', maximumNano, price: { input: maximumNano ? '1' : '0' }, bounds: { inputTokens: 100, outputTokens: 100 } });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'card-ledger-'));
  const path = join(directory, 'ledger.sqlite');
  const ledgers = [];
  t.after(() => {
    for (const ledger of ledgers) { try { ledger.close(); } catch {} }
    rmSync(directory, { recursive: true, force: true });
  });
  return { path, open(card = 'JUL-test') { const ledger = new CardLedger({ path, card }); ledgers.push(ledger); return ledger; } };
}

test('spend is recorded per card and per model across reopen without ever stopping the card', (t) => {
  const files = fixture(t);
  let ledger = files.open();
  const first = ledger.reserve({ ...input(6_000_000_000), model: 'openai/gpt-6-sol', role: 'orchestrator' });
  const usage = { inputTokens: 10, outputTokens: 20 };
  ledger.settle(first.id, { usage, costNano: 6_000_000_000 });
  assert.deepEqual(ledger.settle(first.id, { costNano: 6_000_000_000, usage: { outputTokens: 20, inputTokens: 10 } }).usage, usage);
  assert.throws(() => ledger.settle(first.id, { usage, costNano: 1 }), /differs/);
  ledger.close();
  ledger = files.open();
  const second = ledger.reserve({ ...input(8_000_000_000), model: 'deepseek/deepseek-v4.1-flash', role: 'coder' });
  ledger.settle(second.id, { usage, costNano: 8_000_000_000 });
  assert.equal(ledger.snapshot().spentNano, 14_000_000_000);
  assert.equal(ledger.snapshot().stopped, false);
  assert.deepEqual(ledger.snapshot().spendByModel, {
    'openai/gpt-6-sol': 6_000_000_000,
    'deepseek/deepseek-v4.1-flash': 8_000_000_000,
  });
  const over = ledger.reserve({ ...input(1), role: 'proof' });
  ledger.settle(over.id, { usage, costNano: 1 });
  assert.equal(ledger.snapshot().stopped, false);
  assert.equal(ledger.reserve(input(1)).maximumNano, 1);
  assert.equal(files.open('different-card').snapshot().spentNano, 0);
});

test('simultaneous cross-role reservations are visible while actual settlements accumulate', (t) => {
  const files = fixture(t);
  const orchestrator = files.open();
  const coder = files.open();
  const sol = orchestrator.reserve({ ...input(6_000_000_000), model: 'openai/gpt-6-sol', role: 'orchestrator' });
  const deepseek = coder.reserve({ ...input(8_000_000_000), model: 'deepseek/deepseek-v4.1-flash', role: 'coder' });
  assert.equal(orchestrator.snapshot().heldNano, 14_000_000_000);
  coder.settle(deepseek.id, { usage: { tokens: 1 }, costNano: 5_000_000_000 });
  assert.equal(orchestrator.snapshot().heldNano, 6_000_000_000);
  const review = coder.reserve({ ...input(300_000_000), role: 'reviewer' });
  orchestrator.settle(sol.id, { usage: { tokens: 1 }, costNano: 5_000_000_000 });
  coder.settle(review.id, { usage: { tokens: 1 }, costNano: 1 });
  assert.equal(files.open().snapshot().spentNano, 10_000_000_001);
  assert.equal(files.open().snapshot().heldNano, 0);
  assert.equal(files.open().reserve(input(1)).maximumNano, 1);
});

test('unresolved priced accounting no longer blocks a later priced request', (t) => {
  const ledger = fixture(t).open();
  const paid = ledger.reserve(input(20));
  assert.throws(() => ledger.settle(paid.id, { costNano: 1 }), /usage/);
  ledger.unknown(paid.id, 'connection lost');
  const free = ledger.reserve(input());
  assert.equal(ledger.settle(free.id, { costNano: 0 }).state, 'settled');
  assert.equal(ledger.snapshot().spentNano, 0);
  assert.equal(ledger.snapshot().heldNano, 20);
  assert.equal(ledger.reserve(input(1)).maximumNano, 1);
  ledger.settle(paid.id, { usage: { tokens: 1 }, costNano: 1 });
  assert.equal(ledger.snapshot().spentNano, 1);
});

test('a legacy stop row from an earlier run neither blocks nor reports a stop', (t) => {
  const files = fixture(t);
  files.open().close();
  const legacy = new DatabaseSync(files.path);
  legacy.exec('CREATE TABLE IF NOT EXISTS stops (card TEXT PRIMARY KEY, reason TEXT NOT NULL)');
  legacy.prepare('INSERT INTO stops (card, reason) VALUES (?, ?)').run('JUL-test', 'Card cost ceiling exceeded');
  legacy.close();
  const ledger = files.open();
  assert.equal(ledger.snapshot().stopped, false);
  const request = ledger.reserve(input(1));
  ledger.settle(request.id, { usage: { tokens: 1 }, costNano: 1 });
  assert.equal(ledger.snapshot().spentNano, 1);
});

test('charging an unknown request at its full maximum records cost without stopping the card', t => {
  const ledger = fixture(t).open();
  const request = ledger.reserve(input(300000000));
  ledger.unknown(request.id, 'review timed out');
  assert.equal(ledger.snapshot().heldNano, 300000000);
  const charged = ledger.chargeUnknownMaximum(request.id);
  assert.equal(charged.state, 'unknown');
  assert.equal(charged.usage, null);
  assert.equal(charged.costNano, 300000000);
  assert.equal(charged.costBasis, 'reservation maximum; actual usage unknown');
  assert.throws(() => ledger.settle(request.id, { usage: { input: 1 }, costNano: 1 }), /final/);
  assert.equal(ledger.chargeUnknownMaximum(request.id).costNano, 300000000);
  assert.equal(ledger.snapshot().heldNano, 0);
  assert.equal(ledger.snapshot().spentNano, 300000000);
  assert.equal(ledger.reserve(input(9_700_000_000)).maximumNano, 9_700_000_000);
});

test('reopening retains unresolved holds, snapshots, and settled costs per card', (t) => {
  const files = fixture(t);
  const ledger = files.open();
  const first = ledger.reserve(input(50));
  ledger.settle(first.id, { usage: { tokens: 1 }, costNano: 25 });
  const second = ledger.reserve(input(75));
  ledger.unknown(second.id, 'interrupted');
  const expected = ledger.snapshot();
  ledger.close();
  const restarted = files.open();
  assert.deepEqual(restarted.snapshot(), expected);
  assert.equal(restarted.reserve(input(1)).maximumNano, 1);
  assert.equal(files.open('other-card').snapshot().spentNano, 0);
  assert.throws(() => files.open('other-card').settle(second.id, { usage: {}, costNano: 0 }), /Unknown/);
});

test('a settled cost above its recorded maximum is durable across reopen and does not block', (t) => {
  const files = fixture(t);
  const ledger = files.open();
  const reserved = ledger.reserve(input(10));
  assert.equal(ledger.settle(reserved.id, { usage: { tokens: 10 }, costNano: 12 }).state, 'settled');
  ledger.close();
  const snapshot = files.open().snapshot();
  assert.equal(snapshot.spentNano, 12);
  assert.equal(snapshot.heldNano, 0);
  assert.equal(files.open().reserve(input(1)).maximumNano, 1);
});

test('invalid monetary inputs cannot change durable accounting', (t) => {
  const ledger = fixture(t).open();
  for (const bad of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1']) {
    assert.throws(() => ledger.reserve(input(bad)), /safe integer/);
  }
  assert.throws(() => ledger.reserve({ ...input(), model: ' ' }), /nonempty/);
  const free = ledger.reserve(input());
  assert.throws(() => ledger.settle(free.id, { costNano: -1 }), /safe integer/);
  assert.equal(ledger.snapshot().spentNano, 0);
  assert.equal(ledger.snapshot().requests.length, 1);
});

function child(source, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', source, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let errors = '';
    process.stdout.on('data', (chunk) => { output += chunk; });
    process.stderr.on('data', (chunk) => { errors += chunk; });
    process.on('error', reject);
    process.on('exit', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
  });
}

test('separate processes record their settled costs on one card without refusal', async (t) => {
  const files = fixture(t);
  files.open().close();
  const module = new URL('../ledger.mjs', import.meta.url).href;
  const source = `import {CardLedger} from ${JSON.stringify(module)};
    const ledger = new CardLedger({path: process.argv[1], card: 'JUL-test'});
    try { const request = ledger.reserve(JSON.parse(process.argv[2])); ledger.settle(request.id, { usage: { tokens: 1 }, costNano: Number(process.argv[3]) }); console.log('settled'); }
    catch { console.log('refused'); } finally { ledger.close(); }`;
  const outcomes = await Promise.all([
    child(source, [files.path, JSON.stringify(input(6_000_000_000)), '6000000000']),
    child(source, [files.path, JSON.stringify(input(6_000_000_000)), '6000000000']),
  ]);
  assert.deepEqual(outcomes.sort(), ['settled', 'settled']);
  const snapshot = files.open().snapshot();
  assert.equal(snapshot.spentNano, 12_000_000_000);
  assert.equal(snapshot.stopped, false);
  assert.equal(files.open().reserve(input(1)).maximumNano, 1);
});

test('a process exit after reservation keeps its maximum visible without gating a later request', async (t) => {
  const files = fixture(t);
  const module = new URL('../ledger.mjs', import.meta.url).href;
  await child(`import {CardLedger} from ${JSON.stringify(module)};
    const ledger = new CardLedger({path: process.argv[1], card: 'JUL-test'});
    ledger.reserve(JSON.parse(process.argv[2])); process.exit(0);`, [files.path, JSON.stringify(input(9_000_000_000))]);
  const restarted = files.open();
  assert.equal(restarted.snapshot().heldNano, 9_000_000_000);
  const next = restarted.reserve(input(2_000_000_000));
  assert.equal(next.maximumNano, 2_000_000_000);
  restarted.settle(next.id, { usage: { tokens: 1 }, costNano: 0 });
});
