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

test('all roles share the two-dollar card ceiling across reopen and settle once', (t) => {
  const files = fixture(t);
  let ledger = files.open();
  const first = ledger.reserve({ ...input(600_000_000), model: 'openai/gpt-6-sol', role: 'orchestrator' });
  assert.equal(ledger.snapshot().heldNano, 600_000_000);
  assert.equal(ledger.snapshot().pricedBlocked, false);
  const usage = { inputTokens: 10, outputTokens: 20 };
  ledger.settle(first.id, { usage, costNano: 600_000_000 });
  assert.deepEqual(ledger.settle(first.id, { costNano: 600_000_000, usage: { outputTokens: 20, inputTokens: 10 } }).usage, usage);
  assert.throws(() => ledger.settle(first.id, { usage, costNano: 1 }), /differs/);
  ledger.close();
  ledger = files.open();
  assert.equal(ledger.snapshot().remainingNano, 1_400_000_000);
  assert.throws(() => ledger.reserve({ ...input(1_400_000_001), role: 'reviewer' }), /ceiling/);
  const last = ledger.reserve({ ...input(1_400_000_000), model: 'deepseek/deepseek-v4.1-flash', role: 'coder' });
  ledger.settle(last.id, { usage, costNano: 1_400_000_000 });
  assert.equal(ledger.snapshot().spentNano, 2_000_000_000);
  assert.equal(ledger.snapshot().remainingNano, 0);
  assert.throws(() => ledger.reserve({ ...input(1), role: 'proof' }), /ceiling/);
  assert.deepEqual(ledger.snapshot().requests.map(request => request.role), ['orchestrator', 'coder']);
  assert.equal(files.open('different-card').snapshot().remainingNano, 2_000_000_000);
});

test('simultaneous cross-role reservations share held budget and settle in either order', (t) => {
  const files = fixture(t);
  const orchestrator = files.open();
  const coder = files.open();
  const sol = orchestrator.reserve({ ...input(1_200_000_000), model: 'openai/gpt-6-sol', role: 'orchestrator' });
  const deepseek = coder.reserve({ ...input(800_000_000), model: 'deepseek/deepseek-v4.1-flash', role: 'coder' });
  assert.equal(orchestrator.snapshot().heldNano, 2_000_000_000);
  assert.equal(orchestrator.snapshot().remainingNano, 0);
  assert.throws(() => coder.reserve({ ...input(1), role: 'reviewer' }), /ceiling/);
  coder.settle(deepseek.id, { usage: { tokens: 1 }, costNano: 500_000_000 });
  assert.equal(orchestrator.snapshot().heldNano, 1_200_000_000);
  assert.equal(orchestrator.snapshot().remainingNano, 300_000_000);
  const review = coder.reserve({ ...input(300_000_000), role: 'reviewer' });
  orchestrator.settle(sol.id, { usage: { tokens: 1 }, costNano: 1_200_000_000 });
  coder.settle(review.id, { usage: { tokens: 1 }, costNano: 300_000_000 });
  assert.equal(files.open().snapshot().spentNano, 2_000_000_000);
  assert.equal(files.open().snapshot().heldNano, 0);
  assert.throws(() => files.open().reserve(input(1)), /ceiling/);
});

test('free requests remain usable without usage when priced accounting is unknown', (t) => {
  const ledger = fixture(t).open();
  const paid = ledger.reserve(input(20));
  assert.throws(() => ledger.settle(paid.id, { costNano: 1 }), /usage/);
  ledger.unknown(paid.id, 'connection lost');
  const free = ledger.reserve(input());
  assert.equal(ledger.settle(free.id, { costNano: 0 }).state, 'settled');
  assert.equal(ledger.snapshot().spentNano, 0);
  assert.equal(ledger.snapshot().heldNano, 20);
  assert.equal(ledger.snapshot().pricedBlocked, true);
  assert.throws(() => ledger.reserve(input(1)), /blocked/);
  ledger.settle(paid.id, { usage: { tokens: 1 }, costNano: 1 });
  assert.equal(ledger.snapshot().pricedBlocked, false);
});

test('charging an unknown request at its full maximum never releases budget or invents usage', t => {
  const files = fixture(t);
  const ledger = files.open();
  const request = ledger.reserve(input(300000000));
  ledger.unknown(request.id, 'review timed out');
  assert.equal(ledger.snapshot().remainingNano, 1700000000);
  const charged = ledger.chargeUnknownMaximum(request.id);
  assert.equal(charged.state, 'unknown');
  assert.equal(charged.usage, null);
  assert.equal(charged.costNano, 300000000);
  assert.equal(charged.costBasis, 'reservation maximum; actual usage unknown');
  assert.throws(() => ledger.settle(request.id, { usage: { input: 1 }, costNano: 1 }), /final/);
  assert.equal(ledger.chargeUnknownMaximum(request.id).costNano, 300000000);
  assert.equal(files.open().snapshot().remainingNano, 1700000000);
  assert.equal(files.open().snapshot().heldNano, 0);
  const next = files.open().reserve(input(1700000000));
  ledger.settle(next.id, { usage: { input: 1 }, costNano: 1700000000 });
  assert.equal(ledger.snapshot().spentNano, 2000000000);
  assert.throws(() => ledger.reserve(input(1)), /ceiling/);
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
  const outcomes = await Promise.all([child(source, [files.path, JSON.stringify(input(1_200_000_000))]), child(source, [files.path, JSON.stringify(input(1_200_000_000))])]);
  assert.deepEqual(outcomes.sort(), ['accepted', 'refused']);
  assert.equal(files.open().snapshot().heldNano, 1_200_000_000);
});

test('a process exit after reservation never releases an uncertain request', async (t) => {
  const files = fixture(t);
  const module = new URL('../ledger.mjs', import.meta.url).href;
  await child(`import {CardLedger} from ${JSON.stringify(module)};
    const ledger = new CardLedger({path: process.argv[1], card: 'JUL-test'});
    ledger.reserve(JSON.parse(process.argv[2])); process.exit(0);`, [files.path, JSON.stringify(input(900_000_000))]);
  const restarted = files.open();
  assert.equal(restarted.snapshot().heldNano, 900_000_000);
  assert.equal(restarted.snapshot().remainingNano, 1_100_000_000);
  assert.throws(() => restarted.reserve(input(1_100_000_001)), /ceiling/);
  restarted.settle(restarted.reserve(input()).id, { costNano: 0 });
});
