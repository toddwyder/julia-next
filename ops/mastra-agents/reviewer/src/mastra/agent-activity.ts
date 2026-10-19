import { createClient } from '@libsql/client'
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import type { z } from 'zod/v4'

import { AgentActivityRecordSchema, AgentDashboardCardSchema } from './contracts.ts'

export type AgentActivityRecord = z.infer<typeof AgentActivityRecordSchema>
type AgentAction = AgentActivityRecord['actions'][number]

const STUCK_AFTER_MS = 15 * 60 * 1000

function rows(text: string) {
  return text.split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line) as Record<string, any>] } catch { return [] }
  })
}

const SESSION_HEAD_BYTES = 256 * 1024
const SESSION_TAIL_BYTES = 2 * 1024 * 1024

async function sessionRows(path: string) {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    if (size <= SESSION_HEAD_BYTES + SESSION_TAIL_BYTES) return rows(await file.readFile({ encoding: 'utf8' }))
    const head = Buffer.alloc(SESSION_HEAD_BYTES)
    const tail = Buffer.alloc(SESSION_TAIL_BYTES)
    await file.read(head, 0, head.length, 0)
    await file.read(tail, 0, tail.length, size - tail.length)
    const headText = head.toString('utf8').replace(/[^\n]*$/, '')
    const tailText = tail.toString('utf8').replace(/^[^\n]*\n/, '')
    return rows(`${headText}\n${tailText}`)
  } finally {
    await file.close()
  }
}

function cardIdentity(text: string) {
  const identifier = /\b([A-Z][A-Z0-9]*-\d+)\b/.exec(text)?.[1]
  const title = identifier ? new RegExp(`${identifier}\\s*[:—-]\\s*([^\\r\\n]{1,120})`, 'i').exec(text)?.[1]?.trim() : undefined
  return { cardIdentifier: identifier, cardTitle: title || undefined }
}

function actionLabel(name: string, input: unknown) {
  const detail = typeof input === 'string' ? input : JSON.stringify(input ?? {})
  if (/exec|command|shell/i.test(name)) {
    let command = detail
    try { command = JSON.parse(detail).cmd ?? detail } catch {}
    if (/\b(?:test|vitest|playwright|jest)\b/i.test(command)) return 'Ran tests'
    if (/\bgit\b/i.test(command)) return 'Ran a Git command'
    if (/\b(?:rg|Get-Content|Select-String)\b/i.test(command)) return 'Searched or read project files'
    return 'Ran a command'
  }
  if (/read|open/i.test(name)) {
    return 'Read a project file'
  }
  if (/patch|edit|write/i.test(name)) return 'Changed project files'
  if (/search|glob|grep|find/i.test(name)) return 'Searched project files'
  return `Used ${name}`.slice(0, 120)
}

function failureKey(label: string, output: unknown) {
  const raw = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  const stable = raw
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|s)\b/gi, '<duration>')
    .replace(/\s+/g, ' ')
    .trim()
  return `${label}:${createHash('sha256').update(stable).digest('hex')}`
}

function failed(output: unknown, explicit?: unknown) {
  if (explicit === true || explicit === 'error' || explicit === 'failed') return true
  if (explicit === false || explicit === 'success' || explicit === 'succeeded') return false
  const value = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  const exitCode = /(?:exit code|exit_code)["':=\s-]*(-?\d+)/i.exec(value)?.[1]
  if (exitCode !== undefined) return Number(exitCode) !== 0
  return /["']?(?:isError|is_error|failed)["']?\s*[:=]\s*(?:true|yes|1)\b/i.test(value)
}

function nativeRunning(entries: Record<string, any>[]) {
  const latestUser = entries.findLastIndex(entry => entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload?.role === 'user')
  const latestTerminal = entries.findLastIndex(entry => (entry.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(entry.payload?.type)) || entry.type === 'agent_settled')
  return latestUser >= 0 && latestTerminal < latestUser
}

function commandCodeRunning(messages: Record<string, any>[], processRunning: boolean) {
  if (!processRunning) return false
  const latest = messages.at(-1)?.message
  if (!latest) return false
  if (latest.role !== 'assistant') return true
  return (latest.content ?? []).some((part: Record<string, any>) => part.type === 'tool_use')
}

export async function readCodexActivity(path: string, now = new Date()): Promise<AgentActivityRecord | null> {
  const entries = await sessionRows(path)
  const meta = entries.find(entry => entry.type === 'session_meta')?.payload ?? {}
  const messages = entries.filter(entry => entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload?.role === 'user')
  const userText = messages.flatMap(entry => entry.payload.content ?? []).map((part: any) => part.text ?? '').join('\n')
  const identity = cardIdentity(userText || meta.cwd || '')
  const calls = new Map<string, { entry: Record<string, any>; label: string }>()
  const actions: AgentAction[] = []
  for (const entry of entries) {
    const payload = entry.payload ?? {}
    if (entry.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(payload.type)) {
      calls.set(payload.call_id, { entry, label: actionLabel(payload.name ?? 'Tool', payload.arguments ?? payload.input) })
    }
    if (entry.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(payload.type)) {
      const call = calls.get(payload.call_id)
      if (!call) continue
      const isFailure = failed(payload.output, payload.is_error ?? payload.isError ?? payload.status)
      actions.push({ id: payload.call_id, occurredAt: entry.timestamp, label: call.label, outcome: isFailure ? 'failed' : 'succeeded', ...(isFailure ? { failureKey: failureKey(call.label, payload.output) } : {}) })
    }
  }
  const timestamps = entries.map(entry => entry.timestamp).filter(Boolean)
  if (!timestamps.length) return null
  const updatedAt = timestamps.at(-1)!
  return AgentActivityRecordSchema.parse({
    source: 'codex', sourceId: meta.id ?? meta.session_id ?? basename(path, '.jsonl'), running: nativeRunning(entries),
    ...identity, role: 'Agent', model: meta.model ?? 'Codex', service: 'Codex', stage: 'Working', round: 1,
    startedAt: timestamps[0], updatedAt, actions,
  })
}

export async function readCommandCodeActivity(path: string, now = new Date(), processRunning = false): Promise<AgentActivityRecord | null> {
  const entries = await sessionRows(path)
  const session = entries.find(entry => entry.type === 'session') ?? {}
  const messages = entries.filter(entry => entry.type === 'message')
  const userText = messages.filter(entry => entry.message?.role === 'user').flatMap(entry => entry.message?.content ?? []).map((part: any) => part.text ?? '').join('\n')
  const identity = cardIdentity(userText)
  const actions: AgentAction[] = []
  const actionById = new Map<string, AgentAction>()
  for (const entry of messages) {
    for (const part of entry.message.content ?? []) {
      if (entry.message?.role === 'assistant' && part.type === 'tool_use') {
        const action = { id: part.id, occurredAt: entry.timestamp, label: actionLabel(part.name ?? 'Tool', part.input), outcome: 'unknown' as const }
        actions.push(action)
        actionById.set(part.id, action)
      }
      if (entry.message?.role === 'user' && part.type === 'tool_result') {
        const action = actionById.get(part.tool_use_id)
        if (!action) continue
        const isFailure = failed(part.content, part.is_error ?? part.isError ?? entry.message?.is_error ?? entry.message?.status)
        Object.assign(action, { occurredAt: entry.timestamp, outcome: isFailure ? 'failed' : 'succeeded', ...(isFailure ? { failureKey: failureKey(action.label, part.content) } : {}) })
      }
    }
  }
  const timestamps = entries.map(entry => entry.timestamp).filter(Boolean)
  if (!timestamps.length) return null
  const updatedAt = timestamps.at(-1)!
  const model = messages.map(entry => entry.message?.model).find(Boolean) ?? 'CommandCode agent'
  return AgentActivityRecordSchema.parse({
    source: 'commandcode', sourceId: session.id ?? basename(path, '.jsonl'), running: commandCodeRunning(messages, processRunning),
    ...identity, role: 'Agent', model, service: 'CommandCode', stage: 'Working', round: 1,
    startedAt: timestamps[0], updatedAt, actions,
  })
}

function mastraActivity(trace: Record<string, any>): AgentActivityRecord | null {
  const spans = Array.isArray(trace.spans) ? trace.spans : []
  const timestamps = [trace.startedAt, ...spans.map(span => span.startedAt), ...spans.map(span => span.endedAt)].filter(Boolean)
  if (!trace.traceId || !timestamps.length) return null
  const identity = cardIdentity(`${trace.name ?? ''} ${JSON.stringify(trace.metadata ?? {})}`)
  const actions = spans.filter(span => /TOOL_CALL|WORKFLOW_STEP|WORKSPACE_ACTION/i.test(span.spanType ?? '')).map(span => {
    const isFailure = /error|fail/i.test(span.status ?? '') || Boolean(span.error)
    return { id: span.spanId, occurredAt: span.endedAt ?? span.startedAt, label: span.name, outcome: isFailure ? 'failed' : 'succeeded', ...(isFailure ? { failureKey: failureKey(span.name, span.error ?? span.status) } : {}) }
  })
  const updatedAt = timestamps.sort().at(-1)!
  return AgentActivityRecordSchema.parse({
    source: 'mastra', sourceId: trace.traceId, running: !trace.endedAt,
    ...identity, role: trace.metadata?.role ?? 'Agent', model: trace.metadata?.model ?? 'Mastra agent', service: 'Mastra',
    stage: trace.metadata?.stage ?? 'Working', round: trace.metadata?.round ?? 1, startedAt: trace.startedAt ?? timestamps[0], updatedAt, actions,
  })
}

export async function discoverAgentActivity({ codexFiles = [], commandCodeFiles = [], mastraTraces = [], now = new Date(), activeCommandCodeFiles = [] }: {
  codexFiles?: string[]; commandCodeFiles?: string[]; mastraTraces?: Record<string, any>[]; now?: Date; activeCommandCodeFiles?: string[]
}) {
  const activeCommandCode = new Set(activeCommandCodeFiles)
  const records: Array<AgentActivityRecord | null> = []
  for (const path of codexFiles) records.push(await readCodexActivity(path, now))
  for (const path of commandCodeFiles) records.push(await readCommandCodeActivity(path, now, activeCommandCode.has(path)))
  return AgentActivityRecordSchema.array().parse([...records.filter(Boolean), ...mastraTraces.map(trace => mastraActivity(trace)).filter(Boolean)])
}

function minutes(milliseconds: number) { return Math.max(0, Math.floor(milliseconds / 60000)) }

export function projectAgentCards(records: AgentActivityRecord[], now = new Date()) {
  return records.filter(record => record.running).map(record => {
    const actions = [...record.actions].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    const lastActionAt = actions[0]?.occurredAt ?? record.updatedAt
    const inactiveMs = now.getTime() - Date.parse(lastActionAt)
    const chronological = [...actions].reverse()
    const lastThree = chronological.slice(-3)
    const repeatedFailure = lastThree.length === 3 && lastThree.every(action => action.outcome === 'failed' && action.failureKey === lastThree[0].failureKey)
    const status = inactiveMs >= STUCK_AFTER_MS || repeatedFailure ? 'looks-stuck' : 'working'
    const statusDetail = repeatedFailure
      ? 'Looks stuck: the same action failing the same way 3 times in a row.'
      : status === 'looks-stuck'
        ? `Looks stuck: no new action for ${minutes(inactiveMs)} min.`
        : `Working. Last action ${minutes(inactiveMs)} min ago.`
    return AgentDashboardCardSchema.parse({
      agentId: `${record.source}:${record.sourceId}`, source: record.source,
      cardIdentifier: record.cardIdentifier ?? 'Unassigned', cardTitle: record.cardTitle ?? 'Running agent',
      role: record.role ?? 'Agent', model: record.model ?? 'Unknown model', service: record.service,
      stage: record.stage, round: record.round, startedAt: record.startedAt, updatedAt: record.updatedAt,
      status, statusDetail, actions: actions.map(({ failureKey: _failureKey, ...action }) => action),
    })
  })
}

export async function createAgentActivityStore(storagePath: string) {
  const client = createClient({ url: `file:${storagePath.replaceAll('\\', '/')}` })
  await client.execute(`CREATE TABLE IF NOT EXISTS julia_agent_activity_records (
    source TEXT NOT NULL, source_id TEXT NOT NULL, updated_at TEXT NOT NULL, raw_json TEXT NOT NULL,
    PRIMARY KEY (source, source_id)
  )`)
  return {
    async retain(records: AgentActivityRecord[]) {
      for (const record of AgentActivityRecordSchema.array().parse(records)) {
        if (record.source !== 'codex') continue
        await client.execute({ sql: `INSERT INTO julia_agent_activity_records (source, source_id, updated_at, raw_json)
          VALUES (?, ?, ?, ?) ON CONFLICT(source, source_id) DO UPDATE SET updated_at=excluded.updated_at, raw_json=excluded.raw_json`,
          args: [record.source, record.sourceId, record.updatedAt, JSON.stringify(record)] })
      }
    },
    async list() {
      const result = await client.execute('SELECT raw_json FROM julia_agent_activity_records ORDER BY updated_at DESC')
      return AgentActivityRecordSchema.array().parse(result.rows.map(row => JSON.parse(String(row.raw_json))))
    },
    close: () => client.close(),
  }
}
