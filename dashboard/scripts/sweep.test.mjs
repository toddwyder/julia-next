import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweep, findSdkPath } from './sweep.mjs';

// Mastra Code lists the CommandCode models under two provider names. Every name an account
// answers to must reach models.json, or the person choosing sees a short list and no error.
const listed = [
  { id: 'anthropic/claude-opus-5-5', provider: 'anthropic', modelName: 'claude-opus-5-5' },
  { id: 'commandcode/deepseek/deepseek-v4.1-flash', provider: 'commandcode', modelName: 'deepseek/deepseek-v4.1-flash' },
  { id: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro', provider: 'mastracode/commandcode', modelName: 'moonshotai/Kimi-K3.1-Pro' },
  { id: 'not-an-account/model', provider: 'not-an-account', modelName: 'model' },
];

const swept = async () => {
  const directory = mkdtempSync(join(tmpdir(), 'julia-sweep-test-'));
  try {
    return await sweep({ directory, now: new Date('2026-10-29T05:00:00.000Z'), listModels: async () => listed });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('every provider name an account answers to reaches the saved models', async () => {
  const saved = await swept();
  const byId = new Map(saved.models.map(model => [model.id, model]));
  assert.equal(byId.get('commandcode/deepseek/deepseek-v4.1-flash')?.displayName, 'DeepSeek V4.1 Flash');
  assert.equal(byId.get('mastracode/commandcode/moonshotai/Kimi-K3.1-Pro')?.displayName, 'Kimi K3.1 Pro');
  assert.equal(byId.has('not-an-account/model'), false);
  const commandcode = saved.accounts.find(account => account.id === 'commandcode');
  assert.deepEqual(commandcode.providers, ['commandcode', 'mastracode/commandcode']);
  assert.equal(commandcode.modelCount, 2);
});

test('the sweep saves no price, because the picker asks the list on every load', async () => {
  const saved = await swept();
  for (const model of saved.models) assert.equal(model.inputPerMillion, undefined);
});

test('a provider no account claims stays out of the saved models', async () => {
  const saved = await swept();
  assert.equal(saved.models.find(model => model.provider === 'not-an-account'), undefined);
});
