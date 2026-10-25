import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildCatalogue, hydrateSettings } from '../catalogue.mjs'
import { createPstackSession } from '../pstack-session.mjs'
import { cardCeilingNano } from '../adapter.mjs'
import { CEILING_NANO } from '../ledger.mjs'

const rawSettings = JSON.parse(await readFile(new URL('../machine-settings.json', import.meta.url), 'utf8'))
const table = await readFile(new URL('../pstack-models.md', import.meta.url), 'utf8')

const profile = (name, context, input, output, cost) => ({
  name, tool_call: true,
  modalities: { input: ['text'], output: ['text'] },
  limit: { context, ...(input ? { input } : {}), output },
  cost,
})

const catalogue = buildCatalogue({
  modelsDev: {
    anthropic: {
      models: {
        'claude-haiku-5-5': profile('Claude Haiku 5.5', 1000000, undefined, 128000, { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 }),
      },
    },
    openai: {
      models: {
        'gpt-6-sol': profile('GPT-6 Sol', 1050000, 922000, 128000, {
          input: 2, output: 10, cache_read: 0.2, cache_write: 2.5,
          tiers: [{ input: 4, output: 15, cache_read: 0.4, cache_write: 5, tier: { type: 'context', size: 272000 } }],
        }),
      },
    },
    commandcode: {
      models: {
        'deepseek/deepseek-v4.1-flash': profile('DeepSeek V4.1 Flash', 1000000, undefined, 384000, { input: 0.15, output: 0.6, cache_read: 0.003, cache_write: 0 }),
      },
    },
  },
  commandCodeModels: [
    { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', context_length: 1000000, supported_endpoints: ['/chat/completions'] },
    { id: 'reflection/beam:free', name: 'Beam 1.0', context_length: 1048576, supported_endpoints: ['/chat/completions'] },
  ],
  commandCodePricing: [
    { id: 'beam:free', contextWindow: 1048576, tiers: [{ rates: { input: 0, output: 0, cacheRead: 0 } }] },
  ],
  connected: { anthropic: true, 'openai-codex': true, commandcode: true },
})

const settings = hydrateSettings(rawSettings, catalogue)

test('machine settings carry no hand-edited model list', () => {
  assert.equal(Object.hasOwn(rawSettings, 'models'), false)
  assert.equal(rawSettings.providers[0].models, undefined)
  assert.equal(rawSettings.modelCatalogue.modelsDev, 'https://models.dev/api.json')
  assert.equal(rawSettings.modelCatalogue.commandCodePricing, 'https://commandcode.ai/docs/resources/pricing-limits')
  assert.deepEqual(Object.keys(settings.models).sort(), Object.keys(catalogue.models).sort())
  assert.deepEqual(settings.providers[0].models, catalogue.commandCodeProviderModels)
  assert.ok(settings.authPath)
  assert.ok(settings.ledgerPath)
  assert.deepEqual(rawSettings.cardCeilings, { 'JUL-252': null })
})

test('a card can remove or move its money stop in settings', () => {
  assert.equal(cardCeilingNano({}, 'JUL-252'), CEILING_NANO)
  assert.equal(cardCeilingNano({ cardCeilings: { 'JUL-252': null } }, 'JUL-252'), null)
  assert.equal(cardCeilingNano({ cardCeilings: { 'JUL-252': 20_000_000_000 } }, 'JUL-252'), 20_000_000_000)
  assert.throws(() => cardCeilingNano({ cardCeilings: { 'JUL-252': 0 } }, 'JUL-252'), /Invalid card ceiling/)
})

test('normal machine sessions use Claude and DeepSeek and preserve the two-model panels', () => {
  const session = createPstackSession(settings, { roles: settings.roles, card: { identifier: 'JUL-253' } }, table)
  assert.equal(session.orchestratorModel, 'anthropic/claude-haiku-5-5')
  assert.equal(session.coderModel, 'commandcode/deepseek/deepseek-v4.1-flash')
  assert.equal(session.machineryProof, false)
  const entries = Object.fromEntries(session.pstackModels.split('\n').filter(line => line && !line.startsWith('#')).map(line => {
    const split = line.indexOf(':')
    return [line.slice(0, split), line.slice(split + 1).trim().split(', ')]
  }))
  assert.deepEqual(entries['main session'], ['anthropic/claude-haiku-5-5'])
  assert.deepEqual(entries['hardest tasks'], ['anthropic/claude-haiku-5-5'])
  assert.deepEqual(entries['swarm workers'], ['commandcode/deepseek/deepseek-v4.1-flash'])
  for (const role of ['how explorer', 'how explainer', 'why investigators']) {
    assert.deepEqual(entries[role], ['commandcode/deepseek/deepseek-v4.1-flash'])
  }
  assert.deepEqual(entries['why synthesizer'], ['anthropic/claude-haiku-5-5'])
  for (const role of ['arena runners', 'architect runners', 'interrogate reviewers']) {
    assert.deepEqual(entries[role], ['anthropic/claude-haiku-5-5', 'commandcode/deepseek/deepseek-v4.1-flash'])
  }
  for (const model of Object.values(settings.models)) {
    assert.ok(model.source.startsWith('https://'))
    assert.ok(model.boundsSource.startsWith('https://'))
    assert.ok(model.maxInputTokens > 0 && model.maxOutputTokens > 0)
    for (const category of ['input', 'output', 'cacheRead', 'cacheWrite']) assert.ok(Number.isFinite(model.price[category]))
  }
  assert.equal(settings.models['openai/gpt-6-sol'].price.input, 2)
  assert.equal(settings.models['openai/gpt-6-sol'].price.output, 10)
})

test('an explicit machinery drive uses Beam for the session and every helper', () => {
  const session = createPstackSession(settings, { roles: settings.roles, machineryProof: true }, table)
  assert.equal(session.orchestratorModel, 'commandcode/reflection/beam:free')
  assert.equal(session.coderModel, 'commandcode/reflection/beam:free')
  assert.deepEqual(session.helpers.map(helper => helper.defaultModelId), ['commandcode/reflection/beam:free'])
})
