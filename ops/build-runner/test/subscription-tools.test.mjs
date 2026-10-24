import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

test('stock subscription requests can dispatch without unpriced hosted search', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul253-tools-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'workspace');
  await mkdir(cwd);
  const authPath = join(directory, 'auth.json');
  await writeFile(authPath, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh', expires: Date.now() + 3600000, accountId: 'synthetic-account' } }));
  const settingsPath = join(directory, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ authPath, memory: false, roles: { builder: 'openai/gpt-6-sol' }, models: { 'openai/gpt-6-sol': { endpoint: 'https://chatgpt.com/backend-api/codex/responses', wireModel: 'gpt-6-sol', protocol: 'responses', maxInputTokens: 100000, maxOutputTokens: 128, price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } } } }));
  const inputPath = join(directory, 'input.json');
  await writeFile(inputPath, JSON.stringify({ card: 'JUL-253', cwd, stateDir: join(directory, 'state'), settingsPath }));
  const { stdout } = await execute(process.execPath, ['ops/build-runner/test/subscription-tools-driver.mjs', inputPath], { timeout: 60000 });
  assert.match(stdout, /stock subscription dispatch contains local function tools only/);
});
