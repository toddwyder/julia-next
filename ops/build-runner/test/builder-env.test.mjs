import test from 'node:test'
import assert from 'node:assert/strict'
import { builderCommandEnvironment, DEFAULT_BUILDER_ENV_KEYS, MACHINE_ONLY_KEYS } from '../builder-env.mjs'

test('the builder command environment carries CommandCode by default', () => {
  const env = builderCommandEnvironment({ COMMANDCODE_API_KEY: 'synthetic-commandcode' })
  assert.deepEqual(env, { COMMANDCODE_API_KEY: 'synthetic-commandcode' })
  assert.deepEqual([...DEFAULT_BUILDER_ENV_KEYS], ['COMMANDCODE_API_KEY'])
})

test('keys that move the board or change production never reach a builder command', () => {
  const source = Object.fromEntries([...MACHINE_ONLY_KEYS, 'COMMANDCODE_API_KEY'].map(key => [key, `synthetic-${key}`]))
  const env = builderCommandEnvironment(source, [...MACHINE_ONLY_KEYS, 'COMMANDCODE_API_KEY'])
  assert.deepEqual(env, { COMMANDCODE_API_KEY: 'synthetic-COMMANDCODE_API_KEY' })
})

test('a configured read-only key reaches the builder, and a missing key is skipped', () => {
  const env = builderCommandEnvironment(
    { COMMANDCODE_API_KEY: 'synthetic-commandcode', SENTRY_ORG: 'synthetic-org' },
    ['COMMANDCODE_API_KEY', 'SENTRY_ORG', 'SENTRY_READ_TOKEN'],
  )
  assert.deepEqual(env, { COMMANDCODE_API_KEY: 'synthetic-commandcode', SENTRY_ORG: 'synthetic-org' })
})
