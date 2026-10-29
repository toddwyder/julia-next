import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweep } from './sweep.mjs';

// Mastra Code lists the CommandCode models under two provider names. Every name an account
// answers to must reach models.json, or the person choosing sees a short list and no error.
const listed = [
  { id: 'anthropic/claude-opus-5-5', provider: 'anthropic', modelName: 'claude-opus-5-5' },
  { id: 'commandcode/deepseek/deepseek-v4.1-flash', provider: 'commandcode', modelName: 'deepseek/deepseek-v4.1-flash' },
  { id: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro', provider: 'mastracode/commandcode', modelName: 'moonshotai/Kimi-K3.1-Pro' },
  { id: 'not-an-account/model', provider: 'not-an-account', modelName: 'model' },
];

const fixture = name => readFileSync(new URL(`../lib/fixtures/${name}`, import.meta.url), 'utf8');
const pages = new Map([
  ['https://claude.com/pricing', fixture('anthropic-pricing.html')],
  ['https://developers.openai.com/api/docs/pricing', fixture('openai-pricing.html')],
  ['https://commandcode.ai/docs/resources/pricing-limits', fixture('commandcode-pricing.html')],
]);
const fetchImpl = async url => {
  const body = pages.get(String(url));
  if (!body) throw new Error(`the test asked for an unknown page: ${url}`);
  return { ok: true, status: 200, text: async () => body };
};

const swept = async () => {
  const directory = mkdtempSync(join(tmpdir(), 'julia-sweep-test-'));
  try {
    return await sweep({ directory, fetchImpl, now: new Date('2026-10-29T09:00:00.000Z'), listModels: async () => listed });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('every provider name an account answers to reaches the saved models', async () => {
  const saved = await swept();
  const byId = new Map(saved.models.map(model => [model.id, model]));
  assert.equal(byId.get('commandcode/deepseek/deepseek-v4.1-flash')?.inputPerMillion, 0.15);
  assert.equal(byId.get('mastracode/commandcode/moonshotai/Kimi-K3.1-Pro')?.outputPerMillion, 10);
  assert.equal(byId.has('not-an-account/model'), false);
  const commandcode = saved.accounts.find(account => account.id === 'commandcode');
  assert.deepEqual(commandcode.providers, ['commandcode', 'mastracode/commandcode']);
  assert.equal(commandcode.modelCount, 2);
});

test('a provider no account claims stays out of the saved models', async () => {
  const saved = await swept();
  assert.equal(saved.models.find(model => model.provider === 'not-an-account'), undefined);
});
