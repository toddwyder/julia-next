import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { CardLedger } from '../ledger.mjs';
import { createTransport } from '../transport.mjs';

const free = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const paid = { ...free, input: 1, output: 1 };
const endpoint = 'http://synthetic.invalid/infer';
const metadata = 'http://synthetic.invalid/catalog';
const model = price => ({ endpoint, wireModel: 'fixture', protocol: 'chat', maxInputTokens: 100, maxOutputTokens: 10, price });
const settings = price => ({ models: { fixture: model(price) }, networkAllow: [metadata] });
const send = fetch => fetch(endpoint, { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: 'fixture' }] }) });

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'jul251-review-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function transport(ledger, price, upstream) {
  return createTransport({ ledger, settings: settings(price), role: 'builder', fetch: upstream });
}

test('review durable stop survives reopen and blocks free and paid routes only for its card', async t => {
  const path = join(await directory(t), 'cards.sqlite');
  let arrivals = 0;
  const upstream = async () => {
    arrivals++;
    return Response.json(arrivals === 1 ? { usage: { cost: 0.01 } } : {});
  };
  let ledger = new CardLedger({ path, card: 'JUL-251' });
  await assert.rejects(send(transport(ledger, free, upstream)), /STOP WORK/);
  ledger.close();
  ledger = new CardLedger({ path, card: 'JUL-251' });
  t.after(() => ledger.close());
  assert.equal(ledger.snapshot().stopped, true);
  for (const price of [free, paid]) await assert.rejects(send(transport(ledger, price, upstream)));
  assert.equal(arrivals, 1);
  const other = new CardLedger({ path, card: 'JUL-252' });
  t.after(() => other.close());
  assert.equal((await send(transport(other, free, upstream))).status, 200);
  assert.equal(arrivals, 2);
  assert.equal(other.snapshot().stopped, false);
  assert.equal(other.snapshot().requests[0].state, 'settled');
});

test('review stopped card blocks allowlisted metadata GET', async t => {
  const ledger = new CardLedger({ path: ':memory:', card: 'JUL-251' });
  t.after(() => ledger.close());
  const arrivals = [];
  const fetch = transport(ledger, free, async request => {
    arrivals.push(request.url);
    return Response.json(request.url === endpoint ? { usage: { cost_usd: 0.01 } } : { models: [] });
  });
  assert.equal((await fetch(metadata)).status, 200);
  await assert.rejects(send(fetch), /STOP WORK/);
  await assert.rejects(fetch(metadata), /STOP WORK/);
  assert.deepEqual(arrivals, [metadata, endpoint]);
});

test('review oversized known usage records actual cost and refuses result', async t => {
  const ledger = new CardLedger({ path: ':memory:', card: 'JUL-251' });
  t.after(() => ledger.close());
  let arrivals = 0;
  const fetch = transport(ledger, paid, async () => {
    arrivals++;
    return Response.json({ result: 'must not escape', usage: { prompt_tokens: 101, completion_tokens: 10 } });
  });
  await assert.rejects(send(fetch));
  const receipt = ledger.snapshot();
  assert.equal(receipt.spentNano, 111000);
  assert.equal(receipt.requests[0].maximumNano, 110000);
  assert.equal(receipt.requests[0].costNano, 111000);
  assert.equal(receipt.requests[0].state, 'accounting_failure');
  assert.deepEqual(receipt.requests[0].usage, { input: 101, output: 10, cacheRead: 0, cacheWrite: 0 });
  assert.equal(receipt.pricedBlocked, true);
  await assert.rejects(send(fetch));
  assert.equal(arrivals, 1);
});

async function adapterFixture(t, scenario) {
  const root = await directory(t);
  const cwd = join(root, 'workspace');
  const stateDir = join(root, 'state');
  await mkdir(cwd);
  await mkdir(stateDir);
  const options = { card: 'JUL-251', cwd, stateDir, settingsPath: join(root, 'settings.json') };
  const config = { roles: { builder: 'fixture' }, models: { fixture: model(free) }, memory: false };
  if (scenario === 'state') {
    config.authPath = join(root, 'separate-auth.json');
    const target = join(cwd, 'private-state');
    await mkdir(target);
    options.stateDir = join(root, 'state-link');
    await symlink(target, options.stateDir);
  }
  if (scenario === 'auth-file' || scenario === 'auth-parent') {
    const target = join(cwd, 'private-auth');
    await mkdir(target);
    await writeFile(join(target, 'auth.json'), '{}');
    if (scenario === 'auth-file') {
      config.authPath = join(root, 'auth-link.json');
      await symlink(join(target, 'auth.json'), config.authPath);
    } else {
      const link = join(root, 'auth-parent-link');
      await symlink(target, link);
      config.authPath = join(link, 'new-auth.json');
    }
  }
  await writeFile(options.settingsPath, JSON.stringify(config));
  const input = join(root, 'input.json');
  await writeFile(input, JSON.stringify({ options, scenario }));
  const child = spawn(process.execPath, ['ops/build-runner/test/review-adapter-driver.mjs', input], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', value => { output += value; });
  child.stderr.on('data', value => { output += value; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  clearTimeout(timer);
  assert.equal(code, 0, output);
  assert.match(output, /review adapter proof passed/);
}

for (const scenario of ['state', 'auth-file', 'auth-parent']) {
  test(`review stock adapter rejects ${scenario} symlink into builder before runtime`, async t => adapterFixture(t, scenario));
}

test('review replacing builder home after boot cannot expose outside auth', async t => adapterFixture(t, 'mutable-home'));
