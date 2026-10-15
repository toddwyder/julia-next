// Delivery settings are deliberately declarative. This module resolves and
// validates them for a later runner; it never starts a coding harness.
import { readFile } from 'node:fs/promises'

const ROLES = ['builder', 'reviewer'] as const
const HARNESSES = new Set(['claude-code', 'codex', 'omp', 'agy'] as const)
const CONNECTION_FIELDS = ['provider', 'endpoint', 'protocol', 'authReference'] as const

type Role = typeof ROLES[number] | 'recoveryReviewer'
type Harness = 'claude-code' | 'codex' | 'omp' | 'agy'
type NativeConnection = { route: 'native'; provider: null; endpoint: null; protocol: null; authReference: null }
type ApiConnection = { route: 'api'; provider: string; endpoint: string; protocol: string; authReference: string }
type ModelConnection = NativeConnection | ApiConnection
type Thinking = { supported: false; default: null } | { supported: string[]; default: string }
type CatalogEntry = {
  id: string
  displayName: string
  executableModelId: string | null
  maker: string
  harness: Harness
  thinking: Thinking
  connection: ModelConnection
}
type RoleChoice = { model: string; thinking?: string | null }
type ReviewerRunLimits = { maxTotalUsd: number; outputTokenCap: null }
type ResolvedRole = { role: Role; model: CatalogEntry; thinking: string | null }
export type ResolvedDeliveryToolSettings = {
  builder: ResolvedRole
  reviewer: ResolvedRole
  recoveryReviewer?: ResolvedRole
  reviewerRunLimits: ReviewerRunLimits
}

function reject(reason: string): never {
  throw new Error(`delivery-tool settings: ${reason}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function canonicalMaker(value: string) {
  return value.trim().toLowerCase()
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], context: string) {
  const extra = Object.keys(value).find(key => !allowed.includes(key))
  if (extra) reject(`${context} contains unsupported setting "${extra}"`)
}

function catalogLabel(entry: Record<string, unknown>, index: number) {
  return nonEmptyString(entry.id) ? `catalog entry "${entry.id}"` : `catalog entry ${index + 1}`
}

function validateThinking(thinking: unknown, label: string): Thinking {
  if (!isObject(thinking)) reject(`${label} thinking must be an object`)
  checkKeys(thinking, ['supported', 'default'], `${label} thinking`)
  if (thinking.supported === false) {
    if (thinking.default !== null) reject(`${label} has unsupported thinking and must use a null default`)
    return { supported: false, default: null }
  }
  if (!Array.isArray(thinking.supported) || thinking.supported.length === 0 || thinking.supported.some(level => !nonEmptyString(level))) {
    reject(`${label} thinking supported must be a non-empty list or false`)
  }
  const supported = thinking.supported as string[]
  if (new Set(supported).size !== supported.length) reject(`${label} thinking levels must be unique`)
  if (!nonEmptyString(thinking.default) || !supported.includes(thinking.default)) {
    reject(`${label} has a default thinking level that is not supported`)
  }
  return { supported, default: thinking.default }
}

function validateConnection(connection: unknown, label: string): ModelConnection {
  if (!isObject(connection)) reject(`${label} connection must be an object`)
  checkKeys(connection, ['route', ...CONNECTION_FIELDS], `${label} connection`)
  if (connection.route !== 'native' && connection.route !== 'api') reject(`${label} connection route must be native or api`)
  for (const field of CONNECTION_FIELDS) {
    if (!(field in connection)) reject(`${label} connection must include ${field}`)
  }
  if (connection.route === 'native') {
    for (const field of CONNECTION_FIELDS) {
      if (connection[field] !== null) reject(`${label} native connection must explicitly use null for ${field}`)
    }
    return { route: 'native', provider: null, endpoint: null, protocol: null, authReference: null }
  }
  for (const field of CONNECTION_FIELDS) {
    if (!nonEmptyString(connection[field])) reject(`${label} API connection requires ${field}`)
  }
  const endpoint = parseHttpUrl(connection.endpoint as string)
  if (!endpoint) reject(`${label} API connection endpoint must be an absolute HTTP(S) URL`)
  if (endpoint.username || endpoint.password) reject(`${label} API connection endpoint must not contain credentials`)
  return connection as ApiConnection
}

function validateCatalog(value: unknown): CatalogEntry[] {
  if (!Array.isArray(value) || value.length === 0) reject('catalog must be a non-empty array')
  const ids = new Set<string>()
  return value.map((candidate, index) => {
    if (!isObject(candidate)) reject(`catalog entry ${index + 1} must be an object`)
    const label = catalogLabel(candidate, index)
    checkKeys(candidate, ['id', 'displayName', 'executableModelId', 'maker', 'harness', 'thinking', 'connection'], label)
    if (!nonEmptyString(candidate.id) || /\s/.test(candidate.id)) reject(`${label} ID must be a non-empty string without spaces`)
    if (ids.has(candidate.id)) reject(`duplicate catalog ID "${candidate.id}"`)
    ids.add(candidate.id)
    if (!nonEmptyString(candidate.displayName)) reject(`${label} displayName must be a non-empty string`)
    if (!nonEmptyString(candidate.maker)) reject(`${label} maker must be a non-empty string`)
    if (!nonEmptyString(candidate.harness) || !HARNESSES.has(candidate.harness as Harness)) reject(`${label} has unknown harness ${JSON.stringify(candidate.harness)}`)
    const connection = validateConnection(candidate.connection, label)
    if (!nonEmptyString(candidate.executableModelId)
      && !(candidate.executableModelId === null && ['codex', 'agy'].includes(candidate.harness) && connection.route === 'native')) {
      reject(`${label} executableModelId must be a non-empty string, or null for a supported native CLI default`)
    }
    validateThinking(candidate.thinking, label)
    return candidate as unknown as CatalogEntry
  })
}

function resolveCatalogEntry(catalog: CatalogEntry[], reference: string) {
  const matches = catalog.filter(entry => entry.id === reference || entry.displayName === reference)
  if (matches.length === 0) return null
  if (matches.length > 1) reject(`catalog reference ${JSON.stringify(reference)} is ambiguous`)
  return matches[0]
}

function validateRole(role: Role, choice: unknown, catalog: CatalogEntry[]): ResolvedRole {
  if (!isObject(choice)) reject(`${role} must name a model and thinking level`)
  checkKeys(choice, ['model', 'thinking'], role)
  if (!nonEmptyString(choice.model)) reject(`${role} model must be a non-empty exact catalog ID or display name`)
  const model = resolveCatalogEntry(catalog, choice.model)
  if (!model) reject(`${role} model reference ${JSON.stringify(choice.model)} is unknown`)
  const thinking = choice.thinking === undefined ? model.thinking.default : choice.thinking
  if (model.thinking.supported === false) {
    if (thinking !== null) reject(`${role} model ${JSON.stringify(model.id)} does not support thinking`)
  } else if (typeof thinking !== 'string' || !model.thinking.supported.includes(thinking)) {
    reject(`${role} thinking ${JSON.stringify(thinking)} is not supported by catalog entry ${JSON.stringify(model.id)}`)
  }
  return { role, model, thinking: thinking as string | null }
}

function validateReviewerRunLimits(value: unknown): ReviewerRunLimits {
  if (!isObject(value)) reject('reviewerRunLimits must be an object')
  checkKeys(value, ['maxTotalUsd', 'outputTokenCap'], 'reviewerRunLimits')
  if (typeof value.maxTotalUsd !== 'number' || !Number.isFinite(value.maxTotalUsd) || value.maxTotalUsd < 0) reject('reviewerRunLimits maxTotalUsd must be a non-negative number')
  if (value.outputTokenCap !== null) reject('reviewerRunLimits outputTokenCap must be null')
  return { maxTotalUsd: value.maxTotalUsd, outputTokenCap: null }
}

export function validateDeliveryToolSettings(settings: unknown): ResolvedDeliveryToolSettings {
  if (!isObject(settings)) reject('must be an object')
  checkKeys(settings, ['catalog', 'reviewerRunLimits', ...ROLES, 'recoveryReviewer'], 'settings')
  const catalog = validateCatalog(settings.catalog)
  const builder = validateRole('builder', settings.builder, catalog)
  const reviewer = validateRole('reviewer', settings.reviewer, catalog)
  if (canonicalMaker(builder.model.maker) === canonicalMaker(reviewer.model.maker)) {
    reject(`builder and reviewer both resolve to maker ${JSON.stringify(builder.model.maker)}; they must use different makers`)
  }
  const recoveryReviewer = settings.recoveryReviewer
    ? validateRole('recoveryReviewer', settings.recoveryReviewer, catalog)
    : (catalog.some(entry => entry.id === 'google-gemini-recovery-reviewer')
      ? validateRole('recoveryReviewer', { model: 'google-gemini-recovery-reviewer' } satisfies RoleChoice, catalog)
      : null)
  if (recoveryReviewer && canonicalMaker(recoveryReviewer.model.maker) === canonicalMaker(builder.model.maker)) {
    reject(`builder and recovery reviewer both resolve to maker ${JSON.stringify(builder.model.maker)}; they must use different makers`)
  }
  return { builder, reviewer, ...(recoveryReviewer ? { recoveryReviewer } : {}), reviewerRunLimits: validateReviewerRunLimits(settings.reviewerRunLimits) }
}

export async function loadDeliveryToolSettings(path: string | URL, { read = readFile }: { read?: typeof readFile } = {}) {
  let settings: unknown
  try {
    settings = JSON.parse(await read(path, 'utf8'))
  } catch {
    reject(`could not read delivery-tool settings from ${path}`)
  }
  return validateDeliveryToolSettings(settings)
}
