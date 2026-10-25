import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import {
  buildCatalogue,
  hydrateSettings,
  parseCommandCodePricingPage,
} from '../catalogue.mjs'
import { CardLedger } from '../ledger.mjs'
import { createTransport } from '../transport.mjs'

const modelsDev = {
  anthropic: {
    models: {
      'claude-opus-5-5': {
        id: 'claude-opus-5-5',
        name: 'Claude Opus 5.5',
        tool_call: true,
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        limit: { context: 1000000, output: 128000 },
        cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
        reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
      },
      'claude-sonnet-5-5': {
        id: 'claude-sonnet-5-5',
        name: 'Claude Sonnet 5.5',
        tool_call: true,
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        limit: { context: 1000000, output: 128000 },
        cost: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
        reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
      },
      'claude-unpriced': {
        id: 'claude-unpriced',
        name: 'Claude Unpriced',
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 200000, output: 64000 },
      },
    },
  },
  openai: {
    models: {
      'gpt-6-sol': {
        id: 'gpt-6-sol',
        name: 'GPT-6 Sol',
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1050000, input: 922000, output: 128000 },
        cost: {
          input: 2,
          output: 10,
          cache_read: 0.2,
          cache_write: 2.5,
          tiers: [{ input: 4, output: 15, cache_read: 0.4, cache_write: 5, tier: { type: 'context', size: 272000 } }],
        },
      },
      'gpt-5.3': {
        id: 'gpt-5.3',
        name: 'GPT-5.3',
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 400000, input: 272000, output: 128000 },
        cost: { input: 1.75, output: 14, cache_read: 0.175 },
      },
      'gpt-image-2': {
        id: 'gpt-image-2',
        name: 'GPT Image 2',
        tool_call: false,
        modalities: { input: ['text'], output: ['image'] },
        limit: { context: 0, output: 0 },
        cost: { input: 5, output: 30, cache_read: 1.25 },
      },
    },
  },
  commandcode: {
    models: {
      'deepseek/deepseek-v4.1-flash': {
        id: 'deepseek/deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1000000, output: 384000 },
        cost: { input: 0.15, output: 0.6, cache_read: 0.003, cache_write: 0 },
      },
    },
  },
  antigravity: {
    models: {
      'gemini-pro': {
        id: 'gemini-pro',
        name: 'Gemini Pro',
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1000000, output: 65536 },
        cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0 },
      },
    },
  },
}

const commandCodeModels = [
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash (latest)', context_length: 1000000, supported_endpoints: ['/chat/completions', '/responses'] },
  { id: 'reflection/beam:free', name: 'Beam 1.0', context_length: 1048576, supported_endpoints: ['/chat/completions', '/responses'] },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', context_length: 1000000, supported_endpoints: ['/messages'] },
  { id: 'unpriced/model', name: 'Unpriced Model', context_length: 1000, supported_endpoints: ['/chat/completions'] },
]

const commandCodePricing = [
  { id: 'beam:free', contextWindow: 1048576, caps: { text: true, reasoning: true }, tiers: [{ rates: { input: 0, output: 0, cacheRead: 0 } }] },
  { id: 'claude-sonnet-5-5', contextWindow: 1000000, caps: { text: true }, tiers: [{ rates: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } }] },
]

const connected = { anthropic: true, 'openai-codex': true, commandcode: true }

function catalogue() {
  return buildCatalogue({ modelsDev, commandCodeModels, commandCodePricing, connected })
}

test('the catalogue offers every priced model from exactly Claude, ChatGPT and CommandCode', () => {
  const result = catalogue()
  assert.deepEqual([...new Set(result.offers.map(offer => offer.route))].sort(), ['claude', 'commandcode', 'openai-codex'])
  assert.equal(result.offers.some(offer => offer.route === 'antigravity'), false)
  assert.deepEqual(result.offers.filter(offer => offer.route === 'claude').map(offer => offer.modelId).sort(), ['claude-opus-5-5', 'claude-sonnet-5-5'])
  assert.deepEqual(result.offers.filter(offer => offer.route === 'openai-codex').map(offer => offer.modelId).sort(), ['gpt-5.3', 'gpt-6-sol'])
  assert.deepEqual(result.offers.filter(offer => offer.route === 'commandcode').map(offer => offer.modelId).sort(), ['deepseek/deepseek-v4.1-flash', 'reflection/beam:free'])
  const opus = result.offers.find(offer => offer.modelId === 'claude-opus-5-5')
  assert.deepEqual(opus, {
    route: 'claude', modelId: 'claude-opus-5-5', name: 'Claude Opus 5.5', company: 'Anthropic',
    service: 'Claude subscription', codingCapable: true,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], wire: 'messages',
  })
})

test('prices, bounds and wire endpoints come from the published catalogue', () => {
  const result = catalogue()
  const opus = result.models['anthropic/claude-opus-5-5']
  assert.deepEqual(opus.price, { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 })
  assert.equal(opus.maxInputTokens, 1000000)
  assert.equal(opus.maxOutputTokens, 8192)
  assert.equal(opus.publishedMaxOutputTokens, 128000)
  assert.equal(opus.endpoint, 'https://api.anthropic.com/v1/messages')
  assert.equal(opus.protocol, 'messages')
  assert.equal(opus.cacheWriteTtl, '1h')
  assert.deepEqual(opus.inputTokenEstimate, { method: 'o200k_base', multiplier: 2, framingTokens: 4096 })
  assert.match(opus.source, /^https:\/\/models\.dev\/api\.json#/)

  const sol = result.models['openai/gpt-6-sol']
  assert.equal(sol.endpoint, 'https://chatgpt.com/backend-api/codex/responses')
  assert.equal(sol.protocol, 'responses')
  assert.equal(sol.maxInputTokens, 922000)
  assert.equal(sol.maxOutputTokens, 8192)
  assert.deepEqual(sol.inputTokenEstimate, { method: 'o200k_base', multiplier: 2, framingTokens: 4096 })
  assert.deepEqual(sol.priceTiers, [{ aboveInputTokens: 272000, price: { input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 } }])

  assert.equal(result.models['openai/gpt-5.3'].wireModel, 'gpt-5.3-codex')

  const deepseek = result.models['commandcode/deepseek/deepseek-v4.1-flash']
  assert.equal(deepseek.endpoint, 'https://api.commandcode.ai/provider/v1/chat/completions')
  assert.equal(deepseek.protocol, 'chat')
  assert.equal(deepseek.maxInputTokens, 1000000)
  assert.equal(deepseek.maxOutputTokens, 8192)
  assert.deepEqual(deepseek.price, { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 })
})

const buildNarrative = 'The evidence review starts from unproven and tries to break every claim in the saved proof. It reads the card outcome, each acceptance criterion, the candidate commit and the proof folder, then records one verdict per criterion. A review that cannot be reproduced from the saved evidence is unproven. A review that tests something other than the named criterion is wrong thing tested. The reviewer never edits the candidate and never opens a pull request. The orchestrator delegates the review to a model from a different company, waits for the handoff to end, and records the result without a human pressing anything. '

test('a real-sized Claude build request reserves below the two-dollar card after planning', async t => {
  const result = catalogue()
  const opus = result.models['anthropic/claude-opus-5-5']
  const arrivals = []
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    arrivals.push(JSON.parse(text))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ usage: { input_tokens: 28000, output_tokens: 2, cache_read_input_tokens: 12000, cache_creation_input_tokens: 1000 } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/messages`
  const ledger = new CardLedger({ path: ':memory:', card: 'JUL-252' })
  t.after(() => ledger.close())
  const planning = ledger.reserve({ model: 'anthropic/claude-opus-5-5', role: 'orchestrator', maximumNano: 763984000, price: opus.price, bounds: { maxInputTokens: 75018, maxOutputTokens: 8192 } })
  ledger.settle(planning.id, { usage: { input: 4, output: 1945, cacheRead: 0, cacheWrite: 12640 }, costNano: 140036000 })
  const guarded = createTransport({ ledger, role: 'orchestrator', settings: { models: { 'anthropic/claude-opus-5-5': { ...opus, endpoint, wireModel: 'claude-opus-5-5' } } } })
  let content = ''
  while (Buffer.byteLength(JSON.stringify({ model: 'claude-opus-5-5', messages: [{ role: 'user', content }] })) < 113059) content += buildNarrative
  const body = JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 8192, messages: [{ role: 'user', content }] })
  assert.ok(Buffer.byteLength(body) >= 113059)
  const response = await guarded(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  assert.equal(response.status, 200)
  assert.equal(arrivals.length, 1)
  const reservation = ledger.snapshot().requests.at(-1)
  assert.ok(reservation.maximumNano < 1000000000, `reserved ${reservation.maximumNano} nano`)
  assert.ok(ledger.snapshot().spentNano + reservation.maximumNano <= 2000000000)
})

test('a model missing from models.dev uses the provider published list and price', () => {
  const result = catalogue()
  const beam = result.models['commandcode/reflection/beam:free']
  assert.ok(beam)
  assert.deepEqual(beam.price, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  assert.equal(beam.maxInputTokens, 1048576)
  assert.equal(beam.maxOutputTokens, 8192)
  assert.equal(beam.endpoint, 'https://api.commandcode.ai/provider/v1/chat/completions')
  assert.match(beam.source, /^https:\/\/commandcode\.ai\/docs\/resources\/pricing-limits#/)
  assert.match(beam.boundsSource, /^https:\/\/api\.commandcode\.ai\/provider\/v1\/models#/)
})

test('a preview alias uses its published base price and an unknown model is refused', () => {
  const result = buildCatalogue({
    modelsDev: {},
    commandCodeModels: [
      { id: 'qwen/qwen3.6-max-preview', name: 'Qwen 3.6 Max Preview', context_length: 1000000, supported_endpoints: ['/chat/completions'] },
      { id: 'unknown/model-preview', name: 'Unknown', context_length: 1000, supported_endpoints: ['/chat/completions'] },
    ],
    commandCodePricing: [{ id: 'qwen-3.6-max', contextWindow: 1000000, tiers: [{ rates: { input: 1, output: 2, cacheRead: 0.1 } }] }],
    connected: { anthropic: false, 'openai-codex': false, commandcode: true },
  })
  assert.equal(result.models['commandcode/qwen/qwen3.6-max-preview'].price.input, 1)
  assert.deepEqual(result.refused, [{ provider: 'commandcode', modelId: 'unknown/model-preview', reason: 'no published price' }])
})

test('an unpriceable or undispatchable model is refused before it can be offered', () => {
  const result = catalogue()
  assert.equal(result.offers.some(offer => offer.modelId === 'claude-unpriced'), false)
  assert.equal(result.models['anthropic/claude-unpriced'], undefined)
  assert.equal(result.models['commandcode/claude-sonnet-5-5'], undefined)
  assert.deepEqual(result.refused, [
    { provider: 'anthropic', modelId: 'claude-unpriced', reason: 'no published price' },
    { provider: 'commandcode', modelId: 'claude-sonnet-5-5', reason: 'runtime does not dispatch messages' },
    { provider: 'commandcode', modelId: 'unpriced/model', reason: 'no published price' },
  ])
})

test('offers follow the signed-in providers while the catalogue still carries every price', () => {
  const signedOut = buildCatalogue({ modelsDev, commandCodeModels, commandCodePricing, connected: { anthropic: false, 'openai-codex': false, commandcode: false } })
  assert.deepEqual(signedOut.offers, [])
  assert.ok(signedOut.models['anthropic/claude-opus-5-5'])
  assert.ok(signedOut.models['openai/gpt-6-sol'])
  assert.ok(signedOut.models['commandcode/deepseek/deepseek-v4.1-flash'])

  const claudeOnly = buildCatalogue({ modelsDev, commandCodeModels, commandCodePricing, connected: { anthropic: true, 'openai-codex': false, commandcode: false } })
  assert.deepEqual([...new Set(claudeOnly.offers.map(offer => offer.route))], ['claude'])
})

test('hydration fills the runner settings and the CommandCode provider models', () => {
  const result = catalogue()
  const settings = hydrateSettings({
    roles: { orchestrator: 'anthropic/claude-opus-5-5', coder: 'commandcode/deepseek/deepseek-v4.1-flash' },
    providers: [{ name: 'CommandCode', url: 'https://api.commandcode.ai/provider/v1', credentialEnv: 'COMMANDCODE_API_KEY', models: ['stale/model'] }],
  }, result)
  assert.deepEqual(Object.keys(settings.models).sort(), Object.keys(result.models).sort())
  assert.deepEqual(settings.providers[0].models, result.commandCodeProviderModels)
  assert.equal(settings.providers[0].models.includes('stale/model'), false)
  assert.ok(settings.providers[0].models.includes('reflection/beam:free'))
  assert.equal(settings.providers[0].models.includes('deepseek/deepseek-v4.1-flash'), true)
})

test('the CommandCode pricing page publishes parseable model rows', () => {
  const rows = [{ id: 'beam:free', contextWindow: 1048576, tiers: [{ rates: { input: 0, output: 0, cacheRead: 0 } }] }]
  const flight = `36:${JSON.stringify(['$', '$L55', null, { rows }])}`
  const html = `<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`
  assert.deepEqual(parseCommandCodePricingPage(html), rows)
  assert.throws(() => parseCommandCodePricingPage('<html>no rows</html>'), /did not publish model rows/)
})
