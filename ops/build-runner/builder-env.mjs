export const MACHINE_ONLY_KEYS = Object.freeze([
  'LINEAR_API_KEY',
  'SENTRY_AUTH_TOKEN',
  'AXIOM_TOKEN',
  'VERCEL_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
])

export const DEFAULT_BUILDER_ENV_KEYS = Object.freeze(['COMMANDCODE_API_KEY'])

export function builderCommandEnvironment(environment = {}, keys = DEFAULT_BUILDER_ENV_KEYS) {
  const env = {}
  for (const key of keys) {
    if (MACHINE_ONLY_KEYS.includes(key)) continue
    const value = environment?.[key]
    if (typeof value === 'string' && value) env[key] = value
  }
  return env
}
