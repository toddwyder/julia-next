// Every model a card run uses comes from the one file the dashboard reads:
// dashboard/config/defaults.json. `shipping` is the dashboard's own Shipping
// model, so changing that line changes both what the dashboard shows and what
// the runner runs. The `runner` block holds the runner's other models and its
// limits, which the dashboard ignores.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CUSTOM_PROVIDER_NAME = 'CommandCode'
export const CUSTOM_PROVIDER_URL = 'https://api.commandcode.ai/provider/v1'
export const CUSTOM_PROVIDER_PREFIX = 'mastracode/commandcode/'

// The one config file, found from this file rather than the working directory.
export const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dashboard', 'config', 'defaults.json')

// Free Command Code models, as listed on the provider's pricing page on
// 31 October 2026. They are named here so the isolated settings file can
// address them; none of them carries a price.
export const FREE_MODELS = [
  'stealth/glyph-cluster:free',
  'reflection/beam:free',
  'inclusionai/ling-3.1-flash-1019:free',
  'minimax/minimax-m3.1-flash',
]

// Limits that belong to the runner, used only when the config file leaves them
// out. Models are never defaulted here: a config without a model is an error.
export const LIMIT_DEFAULTS = {
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
  return THINKING_FOR_EFFORT[effort] ?? THINKING_FOR_EFFORT.large
}

// `mastracode/commandcode/reflection/beam:free` is how a session addresses a
// custom-provider model; the provider itself lists it as `reflection/beam:free`.
export function providerModelId(model) {
  return model.replace(/^mastracode\//, '').replace(/^commandcode\//, '')
}

export function isCommandCodeModel(model) {
  return typeof model === 'string' && (model.startsWith('commandcode/') || model.startsWith(CUSTOM_PROVIDER_PREFIX))
}

export function readRunnerConfig({ configPath = CONFIG_PATH } = {}) {
  let raw
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    throw new Error(`the shared config at ${configPath} could not be read: ${error.message}`)
  }
  const runner = raw.runner ?? {}
  const models = {
    build: runner.build ?? raw.mainSession,
    memory: runner.memory ?? raw.mainSession,
    helper: runner.helper ?? raw.mainSession,
    // The dashboard shows this same line as its Shipping model.
    shipping: raw.shipping,
  }
  for (const [role, model] of Object.entries(models)) {
    if (typeof model !== 'string' || !model) throw new Error(`the shared config at ${configPath} has no ${role} model`)
  }
  return {
    models,
    effort: raw.effort ?? 'large',
    evidenceAttempts: runner.evidenceAttempts ?? LIMIT_DEFAULTS.evidenceAttempts,
    timeoutMs: runner.timeoutMs ?? LIMIT_DEFAULTS.timeoutMs,
    configPath,
  }
}
