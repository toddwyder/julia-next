import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import type { AgentEvent } from './agent-events.ts'

type EventBody = Omit<AgentEvent, 'launchId' | 'eventId' | 'occurredAt'>
const TurnSchema = z.object({ id: z.string(), status: z.enum(['inProgress', 'completed', 'interrupted', 'failed']) })
const ItemSchema = z.object({ id: z.string(), type: z.string(), command: z.string().optional(), cwd: z.string().optional(), status: z.string().optional(), exitCode: z.number().nullable().optional(), receiverThreadIds: z.array(z.string()).optional() })
const labels: Record<string, string> = { commandExecution: 'Command execution', fileChange: 'File change', mcpToolCall: 'MCP tool call', webSearch: 'Web search', agentMessage: 'Agent message', plan: 'Plan', reasoning: 'Reasoning', collabAgentToolCall: 'Agent collaboration' }

/** Semantic fields come from the installed 0.163.0 app-server schema, never output. */
export function codexEvent(method: string, params: unknown): EventBody {
  if (method === 'thread/started') return { kind: 'progress', providerKind: method, providerStatus: 'started', telemetry: { compactions: [], checklist: [] } }
  if (method === 'thread/tokenUsage/updated') {
    const { tokenUsage } = z.object({ tokenUsage: z.object({ last: z.object({ totalTokens: z.number().int().nonnegative() }), modelContextWindow: z.number().int().nullable().optional() }) }).parse(params)
    const usedTokens = tokenUsage.last.totalTokens
    const windowTokens = tokenUsage.modelContextWindow
    return { kind: 'progress', providerKind: method, providerStatus: 'updated', telemetry: { context: windowTokens && windowTokens > 0 ? { percent: Math.min(100, Math.round(usedTokens / windowTokens * 100)), usedTokens, windowTokens } : null } }
  }
  if (method === 'turn/plan/updated') {
    const { plan } = z.object({ plan: z.array(z.object({ step: z.string(), status: z.enum(['pending', 'inProgress', 'completed']) })) }).parse(params)
    return { kind: 'progress', providerKind: method, providerStatus: 'updated', telemetry: { checklist: plan } }
  }
  if (method === 'turn/started' || method === 'turn/completed') {
    const { turn } = z.object({ turn: TurnSchema }).parse(params)
    return { kind: turn.status === 'inProgress' ? 'run-started' : turn.status === 'completed' ? 'run-completed' : turn.status === 'interrupted' ? 'run-canceled' : 'run-failed', providerKind: method, providerStatus: turn.status, ...(method === 'turn/started' ? { telemetry: { checklist: [] } } : {}) }
  }
  if (method === 'thread/status/changed') {
    const { status } = z.object({ status: z.object({ type: z.enum(['active', 'idle', 'notLoaded', 'systemError']) }) }).parse(params)
    return { kind: status.type === 'active' ? 'run-started' : status.type === 'idle' ? 'unknown' : status.type === 'systemError' ? 'run-failed' : 'disconnected', providerKind: method, providerStatus: status.type }
  }
  if (method === 'item/started' || method === 'item/completed') {
    const { item } = z.object({ item: ItemSchema }).parse(params)
    if (['reasoning', 'agentMessage', 'plan', 'userMessage'].includes(item.type)) return { kind: 'progress', providerKind: method, providerStatus: item.type }
    if (item.type === 'contextCompaction') return { kind: 'progress', providerKind: method, providerStatus: item.status ?? 'unknown', ...(method === 'item/completed' ? { telemetry: { compactionId: item.id } } : {}) }
    const failed = item.status === 'failed' || item.status === 'declined' || (item.type === 'commandExecution' && item.exitCode !== null && item.exitCode !== undefined && item.exitCode !== 0)
    const outcome = method === 'item/started' ? 'unknown' : failed ? 'failed' : item.status === 'completed' || item.status === undefined ? 'succeeded' : 'unknown'
    return { kind: method === 'item/started' ? 'action-started' : 'action-completed', providerKind: method, providerStatus: item.status ?? (method === 'item/started' ? 'inProgress' : 'completed'), ...(item.receiverThreadIds ? { relatedRunIds: item.receiverThreadIds } : {}), action: {
      id: item.id, type: item.type.slice(0, 160), name: labels[item.type] ?? item.type.slice(0, 160), outcome,
      ...(item.command ? { actionKey: createHash('sha256').update(JSON.stringify([item.type, item.command, item.cwd ?? ''])).digest('hex') } : {}),
      ...(failed ? { errorCode: item.exitCode !== null && item.exitCode !== undefined ? `exit-${item.exitCode}` : item.status, errorCategory: 'provider-error' } : {}),
    } }
  }
  if (method === 'thread/closed') return { kind: 'disconnected', providerKind: method, providerStatus: 'closed' }
  return { kind: 'unknown', providerKind: method.slice(0, 160), providerStatus: 'unknown' }
}

/** A thread being idle does not say whether its last turn succeeded or crashed. */
export function codexReconciliationEvents(value: unknown): EventBody[] {
  const turn = TurnSchema.extend({ items: z.array(z.unknown()) }).parse(value)
  const events = turn.items.map(item => {
    const parsed = ItemSchema.parse(item)
    return codexEvent(parsed.status === 'inProgress' ? 'item/started' : 'item/completed', { item })
  })
  const { telemetry: _telemetry, ...lifecycle } = codexEvent(turn.status === 'inProgress' ? 'turn/started' : 'turn/completed', { turn })
  return [...events, lifecycle]
}
