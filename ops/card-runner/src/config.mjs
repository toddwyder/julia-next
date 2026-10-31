// The models and limits one card run uses. Every memory-helper request runs on
// a free Command Code model, so memory adds nothing to a card's cost.

export const CUSTOM_PROVIDER_NAME = 'CommandCode'
export const CUSTOM_PROVIDER_URL = 'https://api.commandcode.ai/provider/v1'
export const CUSTOM_PROVIDER_PREFIX = 'mastracode/commandcode/'

// Free Command Code models, as listed on the provider's pricing page on
// 31 October 2026. They are named here so the isolated settings file can
// address them; none of them carries a price.
export const FREE_MODELS = [
  'stealth/glyph-cluster:free',
  'reflection/beam:free',
  'inclusionai/ling-3.1-flash-1019:free',
  'minimax/minimax-m3.1-flash',
]

export const DEFAULTS = {
  // Beam 1.0 has a 1M context and no daily request cap, so it is the free
  // default the helpers and the rehearsal build run on.
  build: 'mastracode/commandcode/reflection/beam:free',
  memory: 'mastracode/commandcode/reflection/beam:free',
  helper: 'mastracode/commandcode/reflection/beam:free',
  shippingFree: 'mastracode/commandcode/stealth/glyph-cluster:free',
  shippingFinal: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro',
  effort: 'large',
  freeAttempts: 6,
  // One build-back session to collect missing evidence is enough in practice;
  // a second run that still cannot show its work stops the run.
  evidenceAttempts: 2,
  timeoutMs: 90 * 60 * 1000,
}

export const THINKING_FOR_EFFORT = {
  small: 'low',
  medium: 'medium',
  large: 'high',
  unlimited: 'max',
}

export function thinkingForEffort(effort) {
  return THINKING_FOR_EFFORT[effort] ?? THINKING_FOR_EFFORT[DEFAULTS.effort]
}

// `mastracode/commandcode/reflection/beam:free` is how a session addresses a
// custom-provider model; the provider itself lists it as `reflection/beam:free`.
export function providerModelId(model) {
  return model.replace(/^mastracode\//, '').replace(/^commandcode\//, '')
}

export function isCommandCodeModel(model) {
  return typeof model === 'string' && (model.startsWith('commandcode/') || model.startsWith(CUSTOM_PROVIDER_PREFIX))
}
