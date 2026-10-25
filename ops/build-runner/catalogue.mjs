import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuthStorage } from '@mastra/code-sdk/auth/storage'
import { normalizeAnthropicModelId, remapOpenAIModelForCodexOAuth } from '@mastra/code-sdk/providers/model-ids'

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const COMMANDCODE_MODELS_URL = 'https://api.commandcode.ai/provider/v1/models'
export const COMMANDCODE_PRICING_URL = 'https://commandcode.ai/docs/resources/pricing-limits'
export const REQUEST_MAX_OUTPUT_TOKENS = 8192
export const defaultSettingsPath = fileURLToPath(new URL('./machine-settings.json', import.meta.url))

const CACHE_MS = 5 * 60 * 1000
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const PROVIDERS = {
  anthropic: {
    route: 'claude',
    service: 'Claude subscription',
    company: 'Anthropic',
    authId: 'anthropic',
    wire: 'messages',
    protocol: 'messages',
    endpoint: 'https://api.anthropic.com/v1/messages',
    settingsKey: modelId => `anthropic/${modelId}`,
    wireModel: modelId => normalizeAnthropicModelId(modelId),
    cacheWriteTtl: '1h',
    inputTokenEstimate: { method: 'o200k_base', multiplier: 2, framingTokens: 4096 },
  },
  openai: {
    route: 'openai-codex',
    service: 'ChatGPT plan',
    company: 'OpenAI',
    authId: 'openai-codex',
    wire: 'responses',
    protocol: 'responses',
    endpoint: 'https://chatgpt.com/backend-api/codex/responses',
    settingsKey: modelId => `openai/${modelId}`,
    wireModel: modelId => stripProviderPrefix(remapOpenAIModelForCodexOAuth(`openai/${modelId}`)),
    inputTokenEstimate: { method: 'o200k_base', multiplier: 2, framingTokens: 4096 },
  },
  commandcode: {
    route: 'commandcode',
    service: 'CommandCode',
    authId: 'commandcode',
  },
}
const COMMANDCODE_ENDPOINTS = {
  chat: 'https://api.commandcode.ai/provider/v1/chat/completions',
  responses: 'https://api.commandcode.ai/provider/v1/responses',
  messages: 'https://api.commandcode.ai/provider/v1/messages',
}

let sourceCache

function stripProviderPrefix(modelId) {
  return modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function hasPrice(cost) {
  return cost && typeof cost === 'object' && finite(cost.input) && finite(cost.output)
}

function rate(value) {
  return finite(value) ? value : 0
}

function priceFromModelsDev(cost, { oneHourCache = false } = {}) {
  if (!hasPrice(cost)) return null
  const cacheWrite = oneHourCache ? cost.input * 2 : rate(cost.cache_write)
  const price = { input: cost.input, output: cost.output, cacheRead: rate(cost.cache_read), cacheWrite }
  const tiers = Array.isArray(cost.tiers) ? cost.tiers.flatMap(tier => {
    const size = tier?.tier?.type === 'context' ? tier.tier.size : undefined
    if (!Number.isSafeInteger(size) || size <= 0 || !hasPrice(tier)) return []
    return [{
      aboveInputTokens: size,
      price: { input: tier.input, output: tier.output, cacheRead: rate(tier.cache_read), cacheWrite: oneHourCache ? tier.input * 2 : rate(tier.cache_write) },
    }]
  }).sort((left, right) => left.aboveInputTokens - right.aboveInputTokens) : []
  return { price, tiers }
}

function priceFromCommandCode(row) {
  const rates = row?.tiers?.[0]?.rates
  if (!hasPrice(rates)) return null
  const price = { input: rates.input, output: rates.output, cacheRead: rate(rates.cacheRead), cacheWrite: rate(rates.cacheWrite) }
  const tiers = Array.isArray(row.tiers) ? row.tiers.slice(1).flatMap(tier => {
    const size = contextTierSize(tier?.context)
    if (!size || !hasPrice(tier?.rates)) return []
    return [{
      aboveInputTokens: size,
      price: { input: tier.rates.input, output: tier.rates.output, cacheRead: rate(tier.rates.cacheRead), cacheWrite: rate(tier.rates.cacheWrite) },
    }]
  }).sort((left, right) => left.aboveInputTokens - right.aboveInputTokens) : []
  return { price, tiers }
}

function contextTierSize(value) {
  if (typeof value !== 'string') return undefined
  const match = /^>\s*([\d.]+)\s*([KkMm])?/.exec(value.trim())
  if (!match) return undefined
  const multiplier = match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2] ? 1_000 : 1
  const size = Math.round(Number(match[1]) * multiplier)
  return Number.isSafeInteger(size) && size > 0 ? size : undefined
}

function modelCompany(modelId, name) {
  const value = `${modelId} ${name ?? ''}`.toLowerCase()
  if (value.includes('claude') || value.includes('fable')) return 'Anthropic'
  if (/gpt|codex|openai|\bo\d\b/.test(value)) return 'OpenAI'
  if (value.includes('gemini') || value.includes('gemma')) return 'Google'
  if (value.includes('deepseek')) return 'DeepSeek'
  if (value.includes('mistral')) return 'Mistral'
  if (value.includes('qwen')) return 'Alibaba'
  if (value.includes('kimi') || value.includes('moonshot')) return 'Moonshot'
  if (value.includes('glm') || value.includes('z-ai') || value.includes('zai')) return 'Z.AI'
  if (value.includes('minimax')) return 'MiniMax'
  if (value.includes('grok') || value.includes('xai')) return 'xAI'
  if (value.includes('llama') || value.includes('muse') || value.includes('meta')) return 'Meta'
  if (value.includes('nemotron') || value.includes('nvidia')) return 'NVIDIA'
  if (value.includes('inkling') || value.includes('thinkingmachines')) return 'Thinking Machines'
  if (value.includes('hy3') || value.includes('hy4') || value.includes('tencent')) return 'Tencent'
  if (value.includes('stepfun') || value.includes('step-')) return 'StepFun'
  if (value.includes('fugu') || value.includes('sakana')) return 'Sakana'
  if (value.includes('ling') || value.includes('inclusion')) return 'Inclusion AI'
  if (value.includes('beam') || value.includes('reflection')) return 'Reflection'
  if (value.includes('laguna') || value.includes('poolside')) return 'Poolside'
  if (value.includes('glyph') || value.includes('stealth')) return 'Stealth'
  if (value.includes('ornith')) return 'Ornith'
  if (value.includes('longcat') || value.includes('meituan')) return 'Meituan'
  if (value.includes('mimo') || value.includes('xiaomi')) return 'Xiaomi'
  return modelId.includes('/') ? modelId.split('/')[0] : 'CommandCode'
}

function supportedEfforts(model, route) {
  if (route === 'commandcode') return ['low', 'medium', 'high']
  const options = Array.isArray(model.reasoning_options) ? model.reasoning_options : []
  const effort = options.find(option => option?.type === 'effort')
  const values = Array.isArray(effort?.values) ? effort.values.filter(value => EFFORTS.includes(value)) : []
  return values.length ? values : ['low', 'medium', 'high']
}

function modelEligibility(model) {
  if (!model || typeof model !== 'object') return 'no model metadata'
  if (model.status === 'deprecated') return 'deprecated'
  if (model.tool_call !== true) return 'not a coding model'
  const input = Array.isArray(model.modalities?.input) ? model.modalities.input : []
  const output = Array.isArray(model.modalities?.output) ? model.modalities.output : []
  if (!input.includes('text')) return 'no text input'
  if (!output.includes('text')) return 'no text output'
  if (!(model.limit?.context > 0)) return 'no published context limit'
  if (!(model.limit?.output > 0)) return 'no published output limit'
  if (!hasPrice(model.cost)) return 'no published price'
  return null
}

function offerFor(provider, modelId, name, model) {
  return {
    route: provider.route,
    modelId,
    name: typeof name === 'string' && name.trim() ? name : modelId,
    company: modelCompany(modelId, name),
    service: provider.service,
    codingCapable: true,
    supportedEfforts: supportedEfforts(model, provider.route),
    wire: provider.wire,
  }
}

function settingsFor(provider, modelId, price, tiers, model, limits) {
  const wireModel = provider.wireModel ? provider.wireModel(modelId) : modelId
  return {
    endpoint: provider.endpoint,
    modelId,
    wireModel,
    protocol: provider.protocol,
    maxInputTokens: limits.input,
    maxOutputTokens: Math.min(limits.output, REQUEST_MAX_OUTPUT_TOKENS),
    publishedMaxOutputTokens: limits.output,
    price,
    ...(tiers.length ? { priceTiers: tiers } : {}),
    source: `${MODELS_DEV_URL}#${modelId}`,
    boundsSource: `${MODELS_DEV_URL}#${modelId}`,
    route: provider.route,
    service: provider.service,
    company: modelCompany(modelId, model?.name),
    wire: provider.wire,
    inputTokenEstimate: provider.inputTokenEstimate,
    inputTokenEstimateSource: 'https://developers.openai.com/api/docs/guides/token-counting',
    ...(provider.cacheWriteTtl ? { cacheWriteTtl: provider.cacheWriteTtl } : {}),
  }
}

function addModelsDevProvider(catalogue, providerId, modelsDev, connected) {
  const provider = PROVIDERS[providerId]
  const models = modelsDev?.[providerId]?.models
  if (!models || typeof models !== 'object') return
  for (const [modelId, model] of Object.entries(models)) {
    const reason = modelEligibility(model)
    if (reason) {
      if (reason === 'no published price') catalogue.refused.push({ provider: providerId, modelId, reason })
      continue
    }
    const pricing = priceFromModelsDev(model.cost, { oneHourCache: providerId === 'anthropic' })
    if (!pricing) {
      catalogue.refused.push({ provider: providerId, modelId, reason: 'no published price' })
      continue
    }
    const key = provider.settingsKey(modelId)
    const input = model.limit.input > 0 ? model.limit.input : model.limit.context
    const limits = { input, output: model.limit.output }
    catalogue.models[key] = settingsFor(provider, modelId, pricing.price, pricing.tiers, model, limits)
    if (connected[provider.authId]) {
      const offer = offerFor(provider, modelId, model.name, model)
      catalogue.offers.push(offer)
    }
  }
}

function pricingKey(modelId) {
  return modelId.split('/').pop().toLowerCase().replace(/[^a-z0-9.]+/g, '')
}

function pricingIndex(rows) {
  const index = new Map()
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue
    const key = pricingKey(row.id)
    if (key && !index.has(key)) index.set(key, row)
  }
  return index
}

function findPricingRow(index, modelId) {
  const key = pricingKey(modelId)
  if (index.has(key)) return index.get(key)
  for (const alias of ['preview', 'latest']) {
    if (key.length > alias.length && key.endsWith(alias) && index.has(key.slice(0, -alias.length))) return index.get(key.slice(0, -alias.length))
  }
  return undefined
}

function commandCodeWire(endpoints) {
  const values = Array.isArray(endpoints) ? endpoints.filter(value => typeof value === 'string') : []
  if (values.some(value => value.endsWith('/chat/completions'))) return 'chat'
  if (values.some(value => value.endsWith('/responses'))) return 'responses'
  return 'messages'
}

function addCommandCode(catalogue, modelsDev, liveModels, pricingRows, connected) {
  const provider = PROVIDERS.commandcode
  const rows = pricingIndex(pricingRows)
  const devModels = modelsDev?.commandcode?.models ?? {}
  for (const live of liveModels) {
    const modelId = live?.id
    if (typeof modelId !== 'string' || !modelId) continue
    const dev = devModels[modelId]
    const fromDev = priceFromModelsDev(dev?.cost)
    const fromCommandCode = priceFromCommandCode(findPricingRow(rows, modelId))
    const pricing = fromDev ?? fromCommandCode
    if (!pricing) {
      catalogue.refused.push({ provider: 'commandcode', modelId, reason: 'no published price' })
      continue
    }
    const context = live.context_length > 0 ? live.context_length : dev?.limit?.context
    if (!(context > 0)) {
      catalogue.refused.push({ provider: 'commandcode', modelId, reason: 'no published context limit' })
      continue
    }
    const devInput = dev?.limit?.input > 0 ? dev.limit.input : dev?.limit?.context
    const input = Math.min(context, devInput > 0 ? devInput : context)
    const devOutput = dev?.limit?.output
    const output = Math.min(devOutput > 0 ? devOutput : context, context)
    const wire = commandCodeWire(live.supported_endpoints)
    if (wire !== 'chat') {
      catalogue.refused.push({ provider: 'commandcode', modelId, reason: `runtime does not dispatch ${wire}` })
      continue
    }
    const spec = settingsFor(provider, modelId, pricing.price, pricing.tiers, dev ?? live, { input, output })
    spec.endpoint = COMMANDCODE_ENDPOINTS[wire]
    spec.protocol = wire
    spec.wire = wire
    spec.wireModel = modelId
    spec.source = fromDev ? `${MODELS_DEV_URL}#commandcode/${modelId}` : `${COMMANDCODE_PRICING_URL}#${modelId}`
    spec.boundsSource = live.context_length ? `${COMMANDCODE_MODELS_URL}#${modelId}` : spec.source
    spec.inputTokenEstimate = { method: 'utf8', multiplier: 2, framingTokens: 4096 }
    spec.inputTokenEstimateSource = 'https://developers.openai.com/api/docs/guides/token-counting'
    catalogue.models[`commandcode/${modelId}`] = spec
    catalogue.commandCodeProviderModels.push(modelId)
    if (connected.commandcode) catalogue.offers.push(offerFor(provider, modelId, live.name ?? dev?.name, dev ?? live))
  }
}

function assertNoAmbiguousRoutes(models) {
  const routes = new Map()
  for (const [key, spec] of Object.entries(models)) {
    const route = `${spec.endpoint}::${spec.wireModel}`
    if (routes.has(route)) throw new Error(`ambiguous model route for ${routes.get(route)} and ${key}`)
    routes.set(route, key)
  }
}

export function buildCatalogue({ modelsDev = {}, commandCodeModels = [], commandCodePricing = [], connected = {} } = {}) {
  const catalogue = { offers: [], models: {}, refused: [], commandCodeProviderModels: [] }
  addModelsDevProvider(catalogue, 'anthropic', modelsDev, connected)
  addModelsDevProvider(catalogue, 'openai', modelsDev, connected)
  addCommandCode(catalogue, modelsDev, commandCodeModels, commandCodePricing, connected)
  assertNoAmbiguousRoutes(catalogue.models)
  const routeOrder = { claude: 0, 'openai-codex': 1, commandcode: 2 }
  catalogue.offers.sort((left, right) => (routeOrder[left.route] - routeOrder[right.route]) || left.name.localeCompare(right.name))
  catalogue.refused.sort((left, right) => `${left.provider}/${left.modelId}`.localeCompare(`${right.provider}/${right.modelId}`))
  return catalogue
}

export function hydrateSettings(settings, catalogue) {
  if (!settings || typeof settings !== 'object') throw new TypeError('settings are required')
  if (!catalogue || typeof catalogue !== 'object' || !catalogue.models) throw new TypeError('catalogue models are required')
  const providers = (settings.providers ?? []).map(provider => provider?.name === 'CommandCode'
    ? { ...provider, models: [...new Set(catalogue.commandCodeProviderModels)] }
    : provider)
  return { ...settings, providers, models: { ...catalogue.models } }
}

export function parseCommandCodePricingPage(html) {
  if (typeof html !== 'string') throw new TypeError('CommandCode pricing page must be text')
  const pushes = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)]
  for (const [, literal] of pushes) {
    let text
    try { text = JSON.parse(literal) } catch { continue }
    if (!text.includes('"rows":')) continue
    let value
    try { value = JSON.parse(text.slice(text.indexOf(':') + 1)) } catch { continue }
    const rows = findPricingRows(value)
    if (rows) return rows
  }
  throw new Error('CommandCode pricing page did not publish model rows')
}

function findPricingRows(value) {
  if (Array.isArray(value)) {
    if (value.length && value.every(item => item && typeof item === 'object' && typeof item.id === 'string' && Array.isArray(item.tiers))) return value
    for (const item of value) {
      const found = findPricingRows(item)
      if (found) return found
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findPricingRows(item)
      if (found) return found
    }
  }
  return undefined
}

export async function fetchModelsDev(fetchImpl = fetch) {
  const response = await fetchImpl(MODELS_DEV_URL, { headers: { Accept: 'application/json' }, redirect: 'error' })
  if (!response.ok) throw new Error(`models.dev catalogue failed with HTTP ${response.status}`)
  return response.json()
}

export async function fetchCommandCodeModels(apiKey, fetchImpl = fetch) {
  if (!apiKey) throw new Error('COMMANDCODE_API_KEY is required to read CommandCode models')
  const response = await fetchImpl(COMMANDCODE_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`CommandCode model list failed with HTTP ${response.status}`)
  const body = await response.json()
  if (!Array.isArray(body?.data)) throw new Error('CommandCode model list did not publish a data array')
  return body.data
}

export async function fetchCommandCodePricing(fetchImpl = fetch) {
  const response = await fetchImpl(COMMANDCODE_PRICING_URL, { headers: { Accept: 'text/html' }, redirect: 'error' })
  if (!response.ok) throw new Error(`CommandCode pricing failed with HTTP ${response.status}`)
  return parseCommandCodePricingPage(await response.text())
}

function commandCodeKey(settings, override) {
  if (override) return override
  const provider = (settings.providers ?? []).find(candidate => candidate?.name === 'CommandCode')
  return provider?.credentialEnv ? process.env[provider.credentialEnv] : undefined
}

function connectedProviders(settings, commandCodeApiKey) {
  let anthropic = false
  let openai = false
  if (typeof settings.authPath === 'string' && settings.authPath) {
    const auth = new AuthStorage(resolve(settings.authPath))
    auth.allowEnvironmentFallback = false
    anthropic = auth.isLoggedIn('anthropic')
    openai = auth.isLoggedIn('openai-codex')
  }
  return { anthropic, 'openai-codex': openai, commandcode: Boolean(commandCodeApiKey) }
}

export function clearCatalogueSourceCache() {
  sourceCache = undefined
}

async function loadSources({ fetchImpl, commandCodeApiKey, modelsDev, commandCodeModels, commandCodePricing }) {
  if (modelsDev || commandCodeModels || commandCodePricing) {
    const [resolvedDev, resolvedModels, resolvedPricing] = await Promise.all([
      modelsDev ?? fetchModelsDev(fetchImpl),
      commandCodeModels ?? fetchCommandCodeModels(commandCodeApiKey, fetchImpl),
      commandCodePricing ?? fetchCommandCodePricing(fetchImpl),
    ])
    return { modelsDev: resolvedDev, commandCodeModels: resolvedModels, commandCodePricing: resolvedPricing }
  }
  const now = Date.now()
  if (sourceCache && sourceCache.key === commandCodeApiKey && now - sourceCache.at < CACHE_MS) return sourceCache.value
  const [resolvedDev, resolvedModels, resolvedPricing] = await Promise.all([
    fetchModelsDev(fetchImpl),
    fetchCommandCodeModels(commandCodeApiKey, fetchImpl),
    fetchCommandCodePricing(fetchImpl),
  ])
  const value = { modelsDev: resolvedDev, commandCodeModels: resolvedModels, commandCodePricing: resolvedPricing }
  sourceCache = { key: commandCodeApiKey, at: now, value }
  return value
}

export async function loadCatalogue({ settingsPath = defaultSettingsPath, settings, fetchImpl = fetch, commandCodeApiKey, modelsDev, commandCodeModels, commandCodePricing, connected } = {}) {
  const resolvedSettings = settings ?? JSON.parse(await readFile(settingsPath, 'utf8'))
  const key = commandCodeKey(resolvedSettings, commandCodeApiKey)
  const sources = await loadSources({ fetchImpl, commandCodeApiKey: key, modelsDev, commandCodeModels, commandCodePricing })
  const connections = connected ?? connectedProviders(resolvedSettings, key)
  const catalogue = buildCatalogue({ ...sources, connected: connections })
  return { ...catalogue, sources: { modelsDev: MODELS_DEV_URL, commandCodeModels: COMMANDCODE_MODELS_URL, commandCodePricing: COMMANDCODE_PRICING_URL }, connected: connections }
}

export async function discoverCatalogueOffers(options = {}) {
  const catalogue = await loadCatalogue(options)
  return catalogue.offers
}
