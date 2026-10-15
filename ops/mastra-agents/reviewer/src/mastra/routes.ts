import { AcpAgent } from '@mastra/acp'
import { createCodingAgent } from '@mastra/core/coding-agent'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { join } from 'node:path'
import { ModelOfferSchema, ModelSelectionSchema } from './contracts.ts'
import type { z } from 'zod/v4'

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
