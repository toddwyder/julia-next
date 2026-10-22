// @mastra/code-sdk@1.14.0: dist/auth/storage.d.ts; dist/auth/types.d.ts;
// dist/agents/custom-provider-source.d.ts; dist/onboarding/settings.d.ts.
// Facts: local credential persistence and public runtime provider resolution.
// Synthetic credential markers only; no account login or inference is attempted.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sdk, withoutModel } from './framework-runtime.mjs'

test('stock credential storage persists API keys and OAuth tokens in the app-data auth.json', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdk-auth-learning-'))
  const previous = process.env.MASTRA_APP_DATA_DIR
  process.env.MASTRA_APP_DATA_DIR = directory
  try {
    await withoutModel(async () => {
      const { AuthStorage } = await sdk('auth/storage.js')
      const storage = new AuthStorage()
      storage.set('learning-provider', { type: 'api_key', key: 'learning-api-marker' })
      storage.set('openai-codex', {
        type: 'oauth', access: 'learning-access-marker', refresh: 'learning-refresh-marker',
        expires: Date.now() + 60_000, accountId: 'learning-account',
      })
      const persisted = JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8'))
      assert.deepEqual(persisted['learning-provider'], { type: 'api_key', key: 'learning-api-marker' })
      assert.equal(persisted['openai-codex'].access, 'learning-access-marker')
      assert.equal(persisted['openai-codex'].refresh, 'learning-refresh-marker')
      assert.equal((await stat(join(directory, 'auth.json'))).mode & 0o777, 0o600)
      // Reading an already authorized, unexpired token needs no keyboard or network.
      const originalFetch = globalThis.fetch
      globalThis.fetch = () => { throw Error('This local fact must not use the network') }
      try {
        const reopened = new AuthStorage()
        assert.equal(await reopened.getApiKey('learning-provider'), 'learning-api-marker')
        assert.equal(await reopened.getApiKey('openai-codex'), 'learning-access-marker')
      } finally { globalThis.fetch = originalFetch }
    })
  } finally {
    if (previous === undefined) delete process.env.MASTRA_APP_DATA_DIR
    else process.env.MASTRA_APP_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})

test('runtime custom-provider keys resolve without being saved in settings or exported to the environment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdk-provider-learning-'))
  const previous = process.env.MASTRA_APP_DATA_DIR
  process.env.MASTRA_APP_DATA_DIR = directory
  const { setCustomProvidersSource, resolveCustomProviders } = await sdk('agents/custom-provider-source.js')
  try {
    await withoutModel(async () => {
      const { loadSettings, saveSettings } = await sdk('onboarding/settings.js')
      saveSettings(loadSettings())
      const environmentBefore = { ...process.env }
      setCustomProvidersSource(() => [{ name: 'Learning', url: 'https://example.invalid/v1', apiKey: 'runtime-key-marker', models: ['learning'] }])
      assert.equal(resolveCustomProviders()[0].apiKey, 'runtime-key-marker')
      assert.equal((await readFile(join(directory, 'settings.json'), 'utf8')).includes('runtime-key-marker'), false)
      assert.equal(JSON.stringify({ ...process.env }) === JSON.stringify(environmentBefore), true, 'runtime source must not change the environment')
      assert.deepEqual(await readdir(directory), ['settings.json'])
      setCustomProvidersSource(() => [])
      assert.deepEqual(resolveCustomProviders(), [])
      setCustomProvidersSource(undefined)
      assert.equal(resolveCustomProviders(), undefined)
    })
  } finally {
    setCustomProvidersSource(undefined)
    if (previous === undefined) delete process.env.MASTRA_APP_DATA_DIR
    else process.env.MASTRA_APP_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})
