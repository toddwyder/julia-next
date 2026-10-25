import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalogue } from '../catalogue.mjs'

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const outputPath = process.argv[2] ?? join(root, 'docs/agents/model-catalogue-2026-10-24/proof/catalogue-offers.json')
const catalogue = await loadCatalogue()
const routes = [...new Set(catalogue.offers.map(offer => offer.route))].sort()
assert.deepEqual(routes, ['claude', 'commandcode', 'openai-codex'])
assert.ok(catalogue.offers.length > 0)

const perRoute = Object.fromEntries(routes.map(route => [route, catalogue.offers.filter(offer => offer.route === route).length]))
for (const offer of catalogue.offers) {
  const key = offer.route === 'claude' ? `anthropic/${offer.modelId}`
    : offer.route === 'openai-codex' ? `openai/${offer.modelId}`
      : `commandcode/${offer.modelId}`
  const spec = catalogue.models[key]
  assert(spec, `${offer.route}:${offer.modelId} must have a priced model entry`)
  assert.ok(spec.price.input >= 0 && spec.price.output >= 0)
  assert.ok(spec.maxInputTokens > 0 && spec.maxOutputTokens > 0)
}

const evidence = {
  generatedAt: new Date().toISOString(),
  sources: catalogue.sources,
  connected: catalogue.connected,
  routes,
  perRoute,
  offerCount: catalogue.offers.length,
  modelCount: Object.keys(catalogue.models).length,
  commandCodeProviderModelCount: catalogue.commandCodeProviderModels.length,
  refused: catalogue.refused,
  claudeProofModels: ['claude-opus-5-5', 'claude-sonnet-5-5'].map(modelId => ({
    offer: catalogue.offers.find(offer => offer.route === 'claude' && offer.modelId === modelId),
    model: catalogue.models[`anthropic/${modelId}`],
  })),
  offers: catalogue.offers,
}
await mkdir(join(outputPath, '..'), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify({ ...evidence, offers: undefined }, null, 2))
