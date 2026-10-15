import { AcpAgent } from '@mastra/acp'
import { createCodingAgent } from '@mastra/core/coding-agent'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { execFile, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ModelOfferSchema, ModelSelectionSchema } from './contracts.ts'
import type { z } from 'zod/v4'

type ModelOffer = z.infer<typeof ModelOfferSchema>
type ModelSelection = z.infer<typeof ModelSelectionSchema>
const execute = promisify(execFile)

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
  return {
    antigravity: new AcpAgent({
      id: 'antigravity', name: 'Antigravity', description: 'Google Antigravity coding agent',
      command: antigravityCommand, cwd,
    }),
    claude: new AcpAgent({
      id: 'claude', name: 'Claude', description: 'Anthropic Claude Code coding agent',
      command: process.platform === 'win32' ? process.execPath : 'claude-agent-acp',
      args: process.platform === 'win32' ? [claudeBridge] : [], cwd,
    }),
  }
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

export async function discoverAcpOffers(routes: ReturnType<typeof createAcpRoutes>) {
  const [antigravity, claude] = await Promise.all([
    routes.antigravity.getAvailableModels(),
    routes.claude.getAvailableModels(),
  ])
  return [
    ...antigravity.map(item => normalizeAcpOffer('antigravity', item)),
    ...claude.map(item => normalizeAcpOffer('claude', item)),
  ]
}

export async function selectAcpModel(routes: ReturnType<typeof createAcpRoutes>, selection: ModelSelection) {
  const parsed = ModelSelectionSchema.parse({
    route: selection.route, modelId: selection.modelId, company: selection.company, service: selection.service,
    ...(selection.wire ? { wire: selection.wire } : {}),
  })
  if (parsed.route === 'commandcode') throw new Error('CommandCode is not an ACP route')
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

type ProcessBackedConnection = { agentProcess?: ChildProcess }

export type WindowsProcessIdentity = {
  processId: number
  parentProcessId: number
  name: string
  creationDate: string
  executablePath: string | null
}

export type OwnedAcpProcesses = { roots: ChildProcess[]; descendants: WindowsProcessIdentity[] }

async function windowsProcesses(): Promise<WindowsProcessIdentity[]> {
  if (process.platform !== 'win32') return []
  const command = "@(Get-CimInstance Win32_Process | Select-Object @{Name='processId';Expression={$_.ProcessId}},@{Name='parentProcessId';Expression={$_.ParentProcessId}},@{Name='name';Expression={$_.Name}},@{Name='creationDate';Expression={$_.CreationDate.ToString('o')}},@{Name='executablePath';Expression={$_.ExecutablePath}}) | ConvertTo-Json -Compress"
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
  const parsed = JSON.parse(stdout.trim() || '[]') as WindowsProcessIdentity | WindowsProcessIdentity[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

export function descendantAcpProcesses(rootProcessIds: number[], processes: WindowsProcessIdentity[]) {
  const descendants = new Set(rootProcessIds)
  let changed = true
  while (changed) {
    changed = false
    for (const item of processes) {
      if (!descendants.has(item.processId) && descendants.has(item.parentProcessId)) {
        descendants.add(item.processId)
        changed = true
      }
    }
  }
  return processes.filter(item => item.name.toLowerCase() === 'agy_acp_server.exe' && descendants.has(item.processId))
}

export async function ownedAcpProcesses(
  routes: ReturnType<typeof createAcpRoutes>,
  listProcesses: () => Promise<WindowsProcessIdentity[]> = windowsProcesses,
): Promise<OwnedAcpProcesses> {
  const roots = [routes.antigravity.connection, routes.claude.connection]
    .map(connection => (connection as unknown as ProcessBackedConnection).agentProcess)
    .filter((child): child is ChildProcess => child !== undefined)
  const rootProcessIds = roots.flatMap(child => child.pid === undefined ? [] : [child.pid])
  return { roots, descendants: descendantAcpProcesses(rootProcessIds, await listProcesses()) }
}

export async function waitForAcpProcessExit(child: ChildProcess, graceMilliseconds = 2_000, forceMilliseconds = 2_000) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout
    const cleanup = () => {
      child.off('exit', finish)
      clearTimeout(timer)
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (message: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }
    child.once('exit', finish)
    timer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return finish()
      try {
        if (!child.kill('SIGKILL')) return fail(`ACP process ${child.pid ?? '(unknown)'} could not be terminated`)
      } catch (error) {
        return fail(`ACP process ${child.pid ?? '(unknown)'} could not be terminated: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!settled) timer = setTimeout(() => fail(`ACP process ${child.pid ?? '(unknown)'} did not exit after forced termination`), forceMilliseconds)
    }, graceMilliseconds)
  })
}

async function stopExactWindowsProcesses(processes: WindowsProcessIdentity[]) {
  if (!processes.length || process.platform !== 'win32') return
  const encodedIdentities = Buffer.from(JSON.stringify(processes), 'utf8').toString('base64')
  const command = `$owned = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedIdentities}')) | ConvertFrom-Json; Get-CimInstance Win32_Process | Where-Object { $candidate = $_; @($owned | Where-Object { $_.processId -eq $candidate.ProcessId -and $_.name -eq $candidate.Name -and $_.creationDate -eq $candidate.CreationDate.ToString('o') -and $_.executablePath -eq $candidate.ExecutablePath }).Count -gt 0 } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  await execute('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
  const current = await windowsProcesses()
  const remaining = processes.filter(identity => current.some(candidate =>
    candidate.processId === identity.processId
    && candidate.name === identity.name
    && candidate.creationDate === identity.creationDate
    && candidate.executablePath === identity.executablePath))
  if (remaining.length) throw new Error(`ACP cleanup failed for process identities ${remaining.map(item => `${item.processId}@${item.creationDate}`).join(', ')}`)
}

export async function stopOwnedAcpProcesses(owned: OwnedAcpProcesses) {
  const results = await Promise.allSettled([
    ...owned.roots.map(child => waitForAcpProcessExit(child)),
    stopExactWindowsProcesses(owned.descendants),
  ])
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, `ACP process cleanup failed: ${errors.map(error => error instanceof Error ? error.message : String(error)).join('; ')}`)
}

type AcpRouteScope = {
  captureOwnedProcesses: typeof ownedAcpProcesses
  createRoutes: typeof createAcpRoutes
  disconnectRoutes: typeof disconnectAcpRoutes
  stopOwnedProcesses: typeof stopOwnedAcpProcesses
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
    await scope.stopOwnedProcesses(owned)
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
        throw new AggregateError([operationError, cleanupError], `Operation failed: ${operationMessage}; cleanup also failed: ${cleanupMessage}`)
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
