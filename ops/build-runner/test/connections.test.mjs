import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStorage } from '@mastra/code-sdk/auth/storage';
import { stockSubscriptionOffers } from '../connections.mjs';

const openaiPrice = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const anthropicPrice = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.2 };

function stockModels() {
  return {
    'openai/gpt-6-sol': {
      endpoint: 'https://chatgpt.com/backend-api/codex/responses',
      wireModel: 'gpt-6-sol',
      name: 'Sol',
      protocol: 'responses',
      maxInputTokens: 1050000,
      maxOutputTokens: 4096,
      price: openaiPrice,
    },
    'anthropic/claude-haiku-5-5': {
      endpoint: 'https://api.anthropic.com/v1/messages',
      wireModel: 'claude-haiku-5-5',
      protocol: 'messages',
      maxInputTokens: 1000000,
      maxOutputTokens: 8192,
      price: anthropicPrice,
    },
    'openai/gpt-unpriced': {
      wireModel: 'gpt-unpriced',
      protocol: 'responses',
      maxInputTokens: 100000,
      maxOutputTokens: 1024,
    },
    'anthropic/claude-unbounded': {
      wireModel: 'claude-unbounded',
      protocol: 'messages',
      maxOutputTokens: 1024,
      price: anthropicPrice,
    },
    'anthropic/claude-unavailable': {
      protocol: 'messages',
    },
    'commandcode/deepseek/deepseek-v4.1-flash': {
      wireModel: 'deepseek/deepseek-v4.1-flash',
      protocol: 'chat',
      maxInputTokens: 1000000,
      maxOutputTokens: 8192,
      price: { input: 0.3, output: 1.2, cacheRead: 0.003, cacheWrite: 0 },
    },
  };
}

async function fixture(t, signedInProviders) {
  const directory = await mkdtemp(join(tmpdir(), 'jul253-connections-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const authPath = join(directory, 'auth.json');
  const auth = new AuthStorage(authPath);
  for (const provider of signedInProviders) {
    auth.set(provider, {
      type: 'oauth',
      access: `${provider}-synthetic-access`,
      refresh: `${provider}-synthetic-refresh`,
      expires: Date.now() + 3600000,
    });
  }
  const settingsPath = join(directory, 'machine-settings.json');
  await writeFile(settingsPath, JSON.stringify({ authPath, roles: { orchestrator: 'openai/gpt-6-sol' }, models: stockModels() }));
  return { authPath, settingsPath };
}

test('a logged-out stock AuthStorage offers no subscription models', async t => {
  const { settingsPath } = await fixture(t, []);
  assert.deepEqual(await stockSubscriptionOffers(settingsPath), []);
});

test('signed-in stock subscriptions offer literal native model metadata without tokens', async t => {
  const { settingsPath } = await fixture(t, ['openai-codex', 'anthropic']);
  const offers = await stockSubscriptionOffers(settingsPath);
  assert.deepEqual(offers, [
    {
      route: 'openai-codex',
      modelId: 'gpt-6-sol',
      name: 'Sol',
      company: 'OpenAI',
      service: 'ChatGPT plan',
      codingCapable: true,
      supportedEfforts: ['low', 'medium', 'high'],
      wire: 'responses',
    },
    {
      route: 'claude',
      modelId: 'claude-haiku-5-5',
      name: 'claude-haiku-5-5',
      company: 'Anthropic',
      service: 'Claude subscription',
      codingCapable: true,
      supportedEfforts: ['low', 'medium', 'high'],
      wire: 'messages',
    },
  ]);
  const serialized = JSON.stringify(offers);
  assert.doesNotMatch(serialized, /synthetic-access|synthetic-refresh/);
});

test('only the signed-in provider contributes stock offers', async t => {
  const { settingsPath } = await fixture(t, ['anthropic']);
  assert.deepEqual((await stockSubscriptionOffers(settingsPath)).map(offer => [offer.route, offer.modelId]), [
    ['claude', 'claude-haiku-5-5'],
  ]);
});

test('settings without a shared authPath offer nothing', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul253-connections-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, 'machine-settings.json');
  await writeFile(settingsPath, JSON.stringify({ roles: {}, models: stockModels() }));
  assert.deepEqual(await stockSubscriptionOffers(settingsPath), []);
});

test('a missing settings file fails visibly instead of inventing availability', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul253-connections-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(stockSubscriptionOffers(join(directory, 'absent.json')), /ENOENT/);
});

test('an explicitly unavailable or invalidly priced configured model is not advertised', async t => {
  const { settingsPath } = await fixture(t, ['anthropic']);
  for (const change of [{ unavailable: 'temporarily disabled' }, { price: { ...anthropicPrice, input: -1 } }, { maxInputTokens: 1.5 }, { protocol: 'chat' }]) {
    const models = stockModels();
    Object.assign(models['anthropic/claude-haiku-5-5'], change);
    const { readFile } = await import('node:fs/promises');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    await writeFile(settingsPath, JSON.stringify({ ...settings, models }));
    assert.deepEqual(await stockSubscriptionOffers(settingsPath), []);
  }
});
