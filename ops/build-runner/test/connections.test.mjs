import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthStorage } from '@mastra/code-sdk/auth/storage'
import { stockSubscriptionOffers } from '../connections.mjs'

const modelsDev = {
  anthropic: {
    models: {
      'claude-opus-5-5': {
        name: 'Claude Opus 5.5', tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1000000, output: 128000 },
        cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
      },
      'claude-unpriced': {
        name: 'Claude Unpriced', tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 200000, output: 64000 },
      },
    },
  },
  openai: {
    models: {
      'gpt-6-sol': {
        name: 'GPT-6 Sol', tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1050000, input: 922000, output: 128000 },
        cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
      },
    },
  },
  commandcode: {
    models: {
      'deepseek/deepseek-v4.1-flash': {
        name: 'DeepSeek V4.1 Flash', tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1000000, output: 384000 },
        cost: { input: 0.15, output: 0.6, cache_read: 0.003, cache_write: 0 },
      },
    },
  },
}
const commandCodeModels = [{ id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', context_length: 1000000, supported_endpoints: ['/chat/completions'] }]
const commandCodePricing = []
const sources = { modelsDev, commandCodeModels, commandCodePricing }

async function fixture(t, signedInProviders) {
  const directory = await mkdtemp(join(tmpdir(), 'jul-catalogue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const authPath = join(directory, 'auth.json')
  const auth = new AuthStorage(authPath)
  for (const provider of signedInProviders) {
    auth.set(provider, {
      type: 'oauth',
      access: `${provider}-synthetic-access`,
      refresh: `${provider}-synthetic-refresh`,
      expires: Date.now() + 3600000,
    })
  }
  const settingsPath = join(directory, 'machine-settings.json')
  await writeFile(settingsPath, JSON.stringify({ authPath }))
  return { authPath, settingsPath }
}

test('a logged-out stock AuthStorage offers no subscription models', async t => {
  const { settingsPath } = await fixture(t, [])
  assert.deepEqual(await stockSubscriptionOffers(settingsPath, sources), [])
})

test('signed-in stock subscriptions offer catalogue metadata without tokens', async t => {
  const { settingsPath } = await fixture(t, ['openai-codex', 'anthropic'])
  const offers = await stockSubscriptionOffers(settingsPath, sources)
  assert.deepEqual(offers.map(offer => [offer.route, offer.modelId]), [
    ['claude', 'claude-opus-5-5'],
    ['openai-codex', 'gpt-6-sol'],
  ])
  const serialized = JSON.stringify(offers)
  assert.doesNotMatch(serialized, /synthetic-access|synthetic-refresh/)
  assert.deepEqual(offers[0], {
    route: 'claude', modelId: 'claude-opus-5-5', name: 'Claude Opus 5.5', company: 'Anthropic',
    service: 'Claude subscription', codingCapable: true, supportedEfforts: ['low', 'medium', 'high'], wire: 'messages',
  })
})

test('subscription offers do not depend on a settings.models block', async t => {
  const { settingsPath } = await fixture(t, ['openai-codex', 'anthropic'])
  const offers = await stockSubscriptionOffers(settingsPath, sources)
  assert.deepEqual(offers.map(offer => offer.route), ['claude', 'openai-codex'])
})

test('only the signed-in provider contributes stock offers', async t => {
  const { settingsPath } = await fixture(t, ['anthropic'])
  assert.deepEqual((await stockSubscriptionOffers(settingsPath, sources)).map(offer => [offer.route, offer.modelId]), [
    ['claude', 'claude-opus-5-5'],
  ])
})

test('a missing settings file fails visibly instead of inventing availability', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul-catalogue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(stockSubscriptionOffers(join(directory, 'absent.json'), sources), /ENOENT/)
})

test('an unpriced catalogue model is not advertised', async t => {
  const { settingsPath } = await fixture(t, ['anthropic'])
  const offers = await stockSubscriptionOffers(settingsPath, sources)
  assert.equal(offers.some(offer => offer.modelId === 'claude-unpriced'), false)
})
