import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

test('different adapter runs and roles retain one card account and refuse beyond two dollars', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul253-shared-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let arrivals = 0;
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    arrivals++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { prompt_tokens: 6, completion_tokens: 0 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/infer`;
  const settingsPath = join(directory, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({
    ledgerPath: join(directory, 'cards.sqlite'),
    roles: { builder: 'fixture', reviewer: 'fixture' }, memory: false,
    models: { fixture: { endpoint, wireModel: 'fixture', protocol: 'chat', maxInputTokens: 10, maxOutputTokens: 1, price: { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0 }, source: 'local fixture' } },
  }));
  const receipts = [];
  for (let run = 0; run < 3; run++) {
    const cwd = join(directory, `workspace-${run}`);
    await mkdir(cwd);
    const inputPath = join(directory, `input-${run}.json`);
    await writeFile(inputPath, JSON.stringify({ card: 'JUL-253', cwd, stateDir: join(directory, `state-${run}`), role: run === 1 ? 'reviewer' : 'builder', settingsPath, endpoint }));
    const { stdout } = await execute(process.execPath, ['ops/build-runner/test/shared-ledger-driver.mjs', inputPath], { timeout: 60000 });
    receipts.push(JSON.parse(stdout.trim().split('\n').at(-1)));
  }
  assert.equal(receipts[0].spentNano, 600000000);
  assert.equal(receipts[1].spentNano, 1200000000);
  assert.equal(receipts[2].account.spentNano, 1200000000);
  assert.equal(receipts[2].account.remainingNano, 800000000);
  assert.match(receipts[2].error, /ledger refused/);
  assert.equal(arrivals, 2);
});
