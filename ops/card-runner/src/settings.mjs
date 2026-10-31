import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CUSTOM_PROVIDER_NAME,
  CUSTOM_PROVIDER_URL,
  DEFAULTS,
  FREE_MODELS,
  isCommandCodeModel,
  providerModelId,
} from './config.mjs'

export const APP_DATA_DIR = join(homedir(), '.local', 'share', 'mastracode')

export function readSettings(path) {
  if (!existsSync(path)) throw new Error(`Mastra Code settings not found at ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function commandCodeProvider(base) {
  const provider = (base.customProviders ?? []).find((entry) => entry.name === CUSTOM_PROVIDER_NAME)
  const apiKey = provider?.apiKey ?? process.env.COMMANDCODE_API_KEY
  if (!apiKey) throw new Error('No Command Code API key: add the CommandCode provider to Mastra Code settings, or set COMMANDCODE_API_KEY')
  return {
    name: CUSTOM_PROVIDER_NAME,
    url: provider?.url ?? CUSTOM_PROVIDER_URL,
    apiKey,
    models: [...new Set([...(provider?.models ?? []), ...FREE_MODELS])],
  }
}

// The build, the shipping passes and the memory helpers all address Command
// Code, so every model they name has to appear in the provider's own model
// list before a session can select it.
export function withProviderModels(provider, models) {
  const wanted = models.filter(isCommandCodeModel).map(providerModelId)
  return { ...provider, models: [...new Set([...provider.models, ...wanted])] }
}

export function buildSettings(base, { buildModel, memoryModel, helperModel, thinkingLevel = 'high' }) {
  const models = { build: buildModel, plan: buildModel, fast: helperModel, memory: memoryModel }
  const provider = withProviderModels(commandCodeProvider(base), [buildModel, memoryModel, helperModel])
  return {
    ...base,
    onboarding: { ...(base.onboarding ?? {}), completedAt: base.onboarding?.completedAt ?? new Date().toISOString(), omPackId: null },
    models: {
      ...(base.models ?? {}),
      activeModelPackId: 'custom:card-runner',
      // Observer and reflector are the memory helpers. Pinning both here is
      // what makes every memory-helper request run at $0.
      observerModelOverride: memoryModel,
      observerModelSelection: memoryModel,
      reflectorModelOverride: memoryModel,
      reflectorModelSelection: memoryModel,
      modeDefaults: { ...(base.models?.modeDefaults ?? {}), ...models },
    },
    customProviders: [provider, ...(base.customProviders ?? []).filter((entry) => entry.name !== CUSTOM_PROVIDER_NAME)],
    customModelPacks: [
      { name: 'card-runner', models, createdAt: new Date().toISOString() },
      ...(base.customModelPacks ?? []).filter((pack) => pack.name !== 'card-runner'),
    ],
    preferences: { ...(base.preferences ?? {}), yolo: true, thinkingLevel, subagentsEnabled: true },
  }
}

// A run gets its own app-data folder so its threads, observations and
// credentials cannot mix with an interactive session's. Only auth.json is
// carried over; it is copied 0600 and never printed.
export function prepareRunDir({ runDir, baseSettings, authSource = APP_DATA_DIR, buildModel = DEFAULTS.build, memoryModel = DEFAULTS.memory, helperModel = DEFAULTS.helper, thinkingLevel = 'high' }) {
  const appData = join(runDir, 'app-data')
  mkdirSync(appData, { recursive: true })
  const auth = join(authSource, 'auth.json')
  if (!existsSync(auth)) throw new Error(`Mastra Code auth.json not found at ${auth}`)
  copyFileSync(auth, join(appData, 'auth.json'))
  chmodSync(join(appData, 'auth.json'), 0o600)

  const base = baseSettings ?? readSettings(join(authSource, 'settings.json'))
  const settings = buildSettings(base, { buildModel, memoryModel, helperModel, thinkingLevel })
  // Mastra Code reads the settings file beside the app data it runs on, so the
  // generated file has to live in the run's own app-data folder. A --settings
  // path outside it leaves the custom provider unregistered.
  const settingsPath = join(appData, 'settings.json')
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  return { appData, settingsPath, settings }
}
