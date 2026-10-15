import { AcpAgent } from '@mastra/acp'
import { createCodingAgent } from '@mastra/core/coding-agent'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { join } from 'node:path'
import { ownedAcpProcesses, retainAcpProcessHandles, sameWindowsProcessIdentity, stopOwnedAcpProcesses, type OwnedAcpProcesses } from './acp-process-lifecycle.ts'
import { ModelOfferSchema, ModelSelectionSchema } from './contracts.ts'
import type { z } from 'zod/v4'

export { descendantAcpProcesses, ownedAcpProcesses, sameWindowsProcessIdentity, stopExactWindowsProcesses, waitForAcpProcessExit } from './acp-process-lifecycle.ts'
export type { WindowsProcessIdentity } from './acp-process-lifecycle.ts'

type ModelOffer = z.infer<typeof ModelOfferSchema>
type ModelSelection = z.infer<typeof ModelSelectionSchema>

function modelCompany(modelId: string) {
  const value = modelId.toLowerCase()
  if (value.includes('claude')) return 'Anthropic'
  if (/^(?:gpt|o\d|codex)|openai/.test(value)) return 'OpenAI'
  if (value.includes('gemini')) return 'Google'
  if (value.includes('deepseek')) return 'DeepSeek'
  if (value.includes('mistral') || value.includes('codestral')) return 'Mistral'
  if (value.includes('qwen')) return 'Alibaba'
  return itemOwner(modelId)
}
function itemOwner(modelId: string) {
  return modelId.includes('/') ? modelId.split('/')[0] : 'CommandCode'
}

const antigravityCommand = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Antigravity-ACP', 'agy_acp_server.exe')
const claudeBridge = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@agentclientprotocol', 'claude-agent-acp', 'dist', 'index.js')

export function createAcpRoutes(cwd = process.cwd()) {
  const routes = {
    antigravity: new AcpAgent({
      id: 'antigravity', name: 'Antigravity', description: 'Google Antigravity coding agent',
      command: antigravityCommand, cwd,
    }),
    claude: new AcpAgent({
      id: 'claude', name: 'Claude', description: 'Anthropic Claude Code coding agent',
      command: process.platform === 'win32' ? process.execPath : 'claude-agent-acp',
      args: process.platform === 'win32' ? [claudeBridge] : [], cwd,
      createClient: defaultClient => Object.assign(defaultClient, {
        async extNotification(method: string, _params: Record<string, unknown>) {
          if (method === '_auth/status_update') return
          throw new Error(`unsupported Claude ACP notification: ${method}`)
        },
      }),
    }),
  }
  retainAcpProcessHandles(routes.antigravity.connection)
  retainAcpProcessHandles(routes.claude.connection)
  return routes
}

function normalizeAcpOffer(route: 'antigravity' | 'claude', item: { modelId: string; name?: string }): ModelOffer {
  return ModelOfferSchema.parse({
    route,
    modelId: item.modelId,
    name: item.name ?? item.modelId,
    company: route === 'antigravity' ? 'Google' : 'Anthropic',
    service: route === 'antigravity' ? 'Antigravity' : 'Claude',
    codingCapable: true,
  })
}

type ClaudeConfigChoice = { value?: unknown; name?: unknown; options?: unknown }
type ClaudeModelConfig = { id?: unknown; currentValue?: unknown; options?: unknown }
type ClaudeSession = { sessionId?: unknown; configOptions?: unknown }
type ClaudeConnectionInternals = {
  session?: ClaudeSession
  connection?: { setSessionConfigOption(request: { sessionId: string; configId: string; value: string }): Promise<{ configOptions?: unknown }> }
}
type ClaudeDiscoveryTrace = {
  event: 'model-discovery-probe'
  route: 'claude'
  operation: 'session/set_config_option'
  modelId: string
  ok: false
  error: string
}

function sanitizedTraceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 300).replace(/(?:Bearer\s+\S+|sk-[\w-]+|(?:api[_-]?key|token|secret)\s*[=:]\s*\S+)/gi, '[REDACTED]')
}

function claudeModelChoices(agent: ReturnType<typeof createAcpRoutes>['claude']) {
  const session = (agent.connection as unknown as { session?: ClaudeSession }).session
  const configs = Array.isArray(session?.configOptions) ? session.configOptions : []
  const modelConfigs = configs.filter((item): item is ClaudeModelConfig => typeof item === 'object' && item !== null && (item as ClaudeModelConfig).id === 'model')
  if (modelConfigs.length !== 1 || !Array.isArray(modelConfigs[0]?.options)) {
    throw new Error('Claude ACP session did not advertise exactly one model config option')
  }
  const flatten = (choices: unknown[]): ClaudeConfigChoice[] => choices.flatMap(choice => {
    if (typeof choice !== 'object' || choice === null) return []
    const parsed = choice as ClaudeConfigChoice
    return Array.isArray(parsed.options) ? flatten(parsed.options) : [parsed]
  })
  return flatten(modelConfigs[0].options).filter((choice): choice is ClaudeConfigChoice & { value: string } =>
    typeof choice.value === 'string' && choice.value.startsWith('claude-'))
}

async function discoverClaudeOffers(
  agent: ReturnType<typeof createAcpRoutes>['claude'],
  recordTrace: (trace: ClaudeDiscoveryTrace) => void,
) {
  await agent.getAvailableModels()
  const offers: ModelOffer[] = []
  for (const choice of claudeModelChoices(agent)) {
    try {
      await applyClaudeModel(agent, choice.value, false)
      offers.push(normalizeAcpOffer('claude', {
        modelId: choice.value,
        name: typeof choice.name === 'string' ? choice.name : choice.value,
      }))
    } catch (error) {
      recordTrace({
        event: 'model-discovery-probe',
        route: 'claude',
        operation: 'session/set_config_option',
        modelId: choice.value,
        ok: false,
        error: sanitizedTraceError(error),
      })
    }
  }
  return offers
}

async function applyClaudeModel(agent: ReturnType<typeof createAcpRoutes>['claude'], modelId: string, updateSession = true) {
  const internals = agent.connection as unknown as ClaudeConnectionInternals
  const session = internals.session
  const sessionId = session?.sessionId
  if (typeof sessionId !== 'string' || !session || !internals.connection) throw new Error('Claude ACP connection is not initialized')
  let response: Awaited<ReturnType<NonNullable<ClaudeConnectionInternals['connection']>['setSessionConfigOption']>>
  try {
    response = await internals.connection.setSessionConfigOption({ sessionId, configId: 'model', value: modelId })
  } catch (error) {
    throw new Error(`Claude model "${modelId}" selection failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  const configs = Array.isArray(response.configOptions) ? response.configOptions : []
  const selected = configs.find((item): item is ClaudeModelConfig =>
    typeof item === 'object' && item !== null && (item as ClaudeModelConfig).id === 'model')
  if (selected?.currentValue !== modelId) {
    throw new Error(`Claude ACP selected "${String(selected?.currentValue)}" instead of "${modelId}"`)
  }
  if (updateSession) session.configOptions = configs
}

async function selectClaudeModel(agent: ReturnType<typeof createAcpRoutes>['claude'], modelId: string) {
  await agent.getAvailableModels()
  if (!claudeModelChoices(agent).some(choice => choice.value === modelId)) {
    throw new Error(`Claude model "${modelId}" is not currently offered`)
  }
  await applyClaudeModel(agent, modelId)
}

export async function discoverAcpOffers(
  routes: ReturnType<typeof createAcpRoutes>,
  recordTrace: (trace: ClaudeDiscoveryTrace) => void = trace => console.error(JSON.stringify(trace)),
) {
  const [antigravity, claude] = await Promise.all([
    routes.antigravity.getAvailableModels(),
    discoverClaudeOffers(routes.claude, recordTrace),
  ])
  return [
    ...antigravity.map(item => normalizeAcpOffer('antigravity', item)),
    ...claude,
  ]
}

export async function selectAcpModel(routes: ReturnType<typeof createAcpRoutes>, selection: ModelSelection) {
  const parsed = ModelSelectionSchema.parse({
    route: selection.route, modelId: selection.modelId, company: selection.company, service: selection.service,
    ...(selection.wire ? { wire: selection.wire } : {}),
  })
  if (parsed.route === 'commandcode') throw new Error('CommandCode is not an ACP route')
  if (parsed.route === 'claude') return selectClaudeModel(routes.claude, parsed.modelId)
  await routes[parsed.route].setModel(parsed.modelId)
}

export async function discoverCommandCodeOffers(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ModelOffer[]> {
  const response = await fetchImpl('https://api.commandcode.ai/provider/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`CommandCode model list failed with HTTP ${response.status}`)
  const body = await response.json() as { data?: Array<{ id?: unknown; name?: unknown; supported_endpoints?: unknown }> }
  return (body.data ?? []).flatMap(item => {
    const endpoints = Array.isArray(item.supported_endpoints) ? item.supported_endpoints.filter(value => typeof value === 'string') : []
    const codingCapable = endpoints.some(endpoint => /(?:chat\/completions|responses|messages)$/.test(endpoint))
    if (!codingCapable || typeof item.id !== 'string') return []
    const wire = endpoints.some(endpoint => /chat\/completions$/.test(endpoint))
      ? 'chat'
      : endpoints.some(endpoint => /messages$/.test(endpoint)) ? 'messages' : 'responses'
    return [ModelOfferSchema.parse({
      route: 'commandcode', modelId: item.id, name: typeof item.name === 'string' ? item.name : item.id,
      company: modelCompany(item.id), service: 'CommandCode', codingCapable: true, wire,
    })]
  })
}

export function createCommandCodeAgent(selection: ModelSelection, apiKey: string) {
  const parsed = ModelSelectionSchema.parse({
    route: selection.route, modelId: selection.modelId, company: selection.company, service: selection.service,
    ...(selection.wire ? { wire: selection.wire } : {}),
  })
  if (parsed.route !== 'commandcode') throw new Error('selection is not a CommandCode route')
  const baseURL = 'https://api.commandcode.ai/provider/v1'
  const model = parsed.wire === 'messages'
    ? createAnthropic({ apiKey, baseURL })(parsed.modelId)
    : parsed.wire === 'responses'
      ? createOpenAI({ apiKey, baseURL }).responses(parsed.modelId)
      : createOpenAICompatible({ name: 'commandcode', apiKey, baseURL }).chatModel(parsed.modelId)
  return createCodingAgent({
    id: `commandcode-${parsed.modelId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    name: `CommandCode ${parsed.modelId}`,
    model,
    instructions: 'Carry out the authorized coding task in the current workspace and report the result.',
  })
}

export function disconnectAcpRoutes(routes: ReturnType<typeof createAcpRoutes>) {
  routes.antigravity.connection.disconnect()
  routes.claude.connection.disconnect()
}

type AcpRouteScope = {
  captureOwnedProcesses: typeof ownedAcpProcesses
  createRoutes: typeof createAcpRoutes
  disconnectRoutes: typeof disconnectAcpRoutes
  stopOwnedProcesses: typeof stopOwnedAcpProcesses
}

function mergeOwnedAcpProcesses(left: OwnedAcpProcesses, right: OwnedAcpProcesses): OwnedAcpProcesses {
  return {
    roots: [...new Set([...left.roots, ...right.roots])],
    descendants: [...left.descendants, ...right.descendants.filter(candidate =>
      !left.descendants.some(existing => sameWindowsProcessIdentity(existing, candidate)))],
  }
}

async function cleanupOwnedAcpRoutes(routes: ReturnType<typeof createAcpRoutes>, scope: Omit<AcpRouteScope, 'createRoutes'>) {
  const errors: unknown[] = []
  let owned: OwnedAcpProcesses = { roots: [], descendants: [] }
  try {
    owned = await scope.captureOwnedProcesses(routes)
  } catch (error) {
    errors.push(error)
  }
  try {
    scope.disconnectRoutes(routes)
  } catch (error) {
    errors.push(error)
  }
  try {
    owned = mergeOwnedAcpProcesses(owned, await scope.captureOwnedProcesses(routes))
  } catch (error) {
    errors.push(error)
  }
  try {
    await scope.stopOwnedProcesses({ roots: owned.roots, descendants: [] })
  } catch (error) {
    errors.push(error)
  }
  try {
    owned = mergeOwnedAcpProcesses(owned, await scope.captureOwnedProcesses(routes))
  } catch (error) {
    errors.push(error)
  }
  try {
    await scope.stopOwnedProcesses({ roots: [], descendants: owned.descendants })
  } catch (error) {
    errors.push(error)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, `ACP cleanup failed: ${errors.map(error => error instanceof Error ? error.message : String(error)).join('; ')}`)
}

export async function withFinalCleanup<T>(operation: () => Promise<T>, cleanup: () => Promise<void>) {
  let operationError: unknown
  let operationFailed = false
  try {
    return await operation()
  } catch (error) {
    operationFailed = true
    operationError = error
    throw error
  } finally {
    try {
      await cleanup()
    } catch (cleanupError) {
      if (operationFailed) {
        const operationMessage = operationError instanceof Error ? operationError.message : String(operationError)
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        const cleanupErrors = cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError]
        throw new AggregateError([operationError, ...cleanupErrors], `Operation failed: ${operationMessage}; cleanup also failed: ${cleanupMessage}`)
      }
      throw cleanupError
    }
  }
}

export async function rethrowAfterCleanup(operationError: unknown, cleanup: () => Promise<void>): Promise<never> {
  return withFinalCleanup(async () => { throw operationError }, cleanup)
}

export async function withAcpRoutes<T>(
  use: (routes: ReturnType<typeof createAcpRoutes>) => Promise<T>,
  scope: AcpRouteScope = {
    captureOwnedProcesses: ownedAcpProcesses,
    createRoutes: createAcpRoutes,
    disconnectRoutes: disconnectAcpRoutes,
    stopOwnedProcesses: stopOwnedAcpProcesses,
  },
) {
  const routes = scope.createRoutes()
  return withFinalCleanup(() => use(routes), () => cleanupOwnedAcpRoutes(routes, scope))
}

export async function cleanupAcpRoutes(routes: ReturnType<typeof createAcpRoutes>) {
  await cleanupOwnedAcpRoutes(routes, {
    captureOwnedProcesses: ownedAcpProcesses,
    disconnectRoutes: disconnectAcpRoutes,
    stopOwnedProcesses: stopOwnedAcpProcesses,
  })
}
