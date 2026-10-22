import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('priced requests hold budget, settle once, and enforce the card ceiling', (t) => {
  const ledger = fixture(t).open();
  const first = ledger.reserve(input(600_000_000));
  assert.equal(ledger.snapshot().heldNano, 600_000_000);
  assert.throws(() => ledger.reserve(input(1)), /blocked/);
  const usage = { inputTokens: 10, outputTokens: 20 };
  ledger.settle(first.id, { usage, costNano: 600_000_000 });
  assert.deepEqual(ledger.settle(first.id, { costNano: 600_000_000, usage: { outputTokens: 20, inputTokens: 10 } }).usage, usage);
  assert.throws(() => ledger.settle(first.id, { usage, costNano: 1 }), /differs/);
  assert.throws(() => ledger.reserve(input(400_000_001)), /ceiling/);
  const last = ledger.reserve(input(400_000_000));
  ledger.settle(last.id, { usage, costNano: 400_000_000 });
  assert.equal(ledger.snapshot().spentNano, 1_000_000_000);
  assert.equal(ledger.snapshot().remainingNano, 0);
  assert.throws(() => ledger.reserve(input(1)), /ceiling/);
});

test('free requests remain usable without usage when priced accounting is unknown', (t) => {
  const ledger = fixture(t).open();
  const paid = ledger.reserve(input(20));
  assert.throws(() => ledger.settle(paid.id, { costNano: 1 }), /usage/);
  ledger.unknown(paid.id, 'connection lost');
  const free = ledger.reserve(input());
  assert.equal(ledger.settle(free.id, { costNano: 0 }).state, 'settled');
  assert.equal(ledger.snapshot().heldNano, 20);
  assert.equal(ledger.snapshot().pricedBlocked, true);
  assert.throws(() => ledger.reserve(input(1)), /blocked/);
  ledger.settle(paid.id, { usage: { tokens: 1 }, costNano: 1 });
  assert.equal(ledger.snapshot().pricedBlocked, false);
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
  assert.throws(() => restarted.reserve(input(1)), /blocked/);
  assert.equal(files.open('other-card').snapshot().spentNano, 0);
  assert.throws(() => files.open('other-card').settle(second.id, { usage: {}, costNano: 0 }), /Unknown/);
});

test('actual cost above a reservation is durable and blocks priced work', (t) => {
  const files = fixture(t);
  const ledger = files.open();
  const reserved = ledger.reserve(input(10));
  assert.equal(ledger.settle(reserved.id, { usage: { tokens: 10 }, costNano: 12 }).state, 'accounting_failure');
  ledger.close();
  const snapshot = files.open().snapshot();
  assert.equal(snapshot.spentNano, 12);
  assert.equal(snapshot.heldNano, 0);
  assert.equal(snapshot.pricedBlocked, true);
  assert.throws(() => files.open().reserve(input(1)), /blocked/);
  assert.equal(files.open().reserve(input()).maximumNano, 0);
});

test('invalid monetary inputs cannot change durable budget', (t) => {
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

test('separate processes cannot jointly reserve beyond the ceiling', async (t) => {
  const files = fixture(t);
  files.open().close();
  const module = new URL('../ledger.mjs', import.meta.url).href;
  const source = `import {CardLedger} from ${JSON.stringify(module)};
    const ledger = new CardLedger({path: process.argv[1], card: 'JUL-test'});
    try { ledger.reserve(JSON.parse(process.argv[2])); console.log('accepted'); }
    catch { console.log('refused'); } finally { ledger.close(); }`;
  const outcomes = await Promise.all([child(source, [files.path, JSON.stringify(input(600_000_000))]), child(source, [files.path, JSON.stringify(input(600_000_000))])]);
  assert.deepEqual(outcomes.sort(), ['accepted', 'refused']);
  assert.equal(files.open().snapshot().heldNano, 600_000_000);
});

test('a process exit after reservation never releases an uncertain request', async (t) => {
  const files = fixture(t);
  const module = new URL('../ledger.mjs', import.meta.url).href;
  await child(`import {CardLedger} from ${JSON.stringify(module)};
    const ledger = new CardLedger({path: process.argv[1], card: 'JUL-test'});
    ledger.reserve(JSON.parse(process.argv[2])); process.exit(0);`, [files.path, JSON.stringify(input(900_000_000))]);
  const restarted = files.open();
  assert.equal(restarted.snapshot().heldNano, 900_000_000);
  assert.throws(() => restarted.reserve(input(1)), /blocked/);
  restarted.settle(restarted.reserve(input()).id, { costNano: 0 });
});
