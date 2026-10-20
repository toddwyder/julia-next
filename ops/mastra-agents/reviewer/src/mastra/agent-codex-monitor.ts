import { EventEmitter, once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { connectCodexProxy } from './agent-codex-connection.ts'
import { codexEvent, codexReconciliationEvents } from './agent-codex.ts'
import { agentError } from './agent-errors.ts'
import type { createAgentActivityStore } from './agent-activity.ts'
import type { AgentLaunch } from './agent-events.ts'

const ThreadSchema = z.object({ id: z.string(), status: z.object({ type: z.enum(['active', 'idle', 'notLoaded', 'systemError']) }) })
const TurnSchema = z.object({ id: z.string(), status: z.enum(['inProgress', 'completed', 'interrupted', 'failed']), startedAt: z.number().nullable().optional(), completedAt: z.number().nullable().optional(), items: z.array(z.unknown()) })
const TurnPageSchema = z.object({ data: z.array(TurnSchema), nextCursor: z.string().nullable().optional() })

export async function createCodexMonitor(store: Awaited<ReturnType<typeof createAgentActivityStore>>, options: { socketPath?: string } = {}) {
  const completions = new EventEmitter()
  const terminal = new Map<string, unknown>()
  const complete = (id: string, event: unknown) => { terminal.set(id, event); completions.emit(id, event) }
  const launches = (await store.launches()).filter(launch => launch.provider === 'codex')
  const byThread = new Map(launches.map(launch => [launch.providerRunId, launch]))
  let ready = false
  const buffered: Array<{ method: string; params: unknown }> = []
  const receive = async (method: string, params: unknown) => {
    const context = z.object({ threadId: z.string().optional(), thread: z.object({ id: z.string() }).optional(), turn: z.object({ startedAt: z.number().nullable().optional(), completedAt: z.number().nullable().optional() }).optional(), startedAtMs: z.number().optional(), completedAtMs: z.number().optional() }).passthrough().safeParse(params)
    if (!context.success) return
    const launch = byThread.get(context.data.threadId ?? context.data.thread?.id ?? '')
    if (!launch) return
    const event = codexEvent(method, params)
    if (event.kind === 'run-started') terminal.delete(launch.launchId)
    const turnTime = context.data.turn?.completedAt ?? context.data.turn?.startedAt
    const time = context.data.completedAtMs ?? context.data.startedAtMs ?? (turnTime == null ? undefined : turnTime * 1000)
    const previous = method === 'thread/status/changed' ? (await store.records()).find(record => record.sourceId === launch.launchId)?.updatedAt : undefined
    await store.append({ ...event, launchId: launch.launchId, eventId: randomUUID(), occurredAt: time === undefined ? previous ?? new Date().toISOString() : new Date(time).toISOString() })
    if (['run-completed', 'run-failed', 'run-canceled', 'disconnected'].includes(event.kind)) complete(launch.launchId, event)
  }
  const disconnect = async (error?: Error) => {
    if (error) console.error(JSON.stringify(agentError(error, { provider: 'codex', runId: 'connection', eventKind: 'disconnect' })))
    const errors: unknown[] = []
    let active: Set<string> | undefined
    try { active = new Set((await store.records()).filter(record => record.running).map(record => record.sourceId)) }
    catch (error) { errors.push(error) }
    for (const launch of byThread.values()) {
      if (terminal.has(launch.launchId)) continue
      try {
        if (active?.has(launch.launchId)) await store.append({ launchId: launch.launchId, eventId: randomUUID(), kind: 'disconnected', providerKind: 'connection-closed', providerStatus: 'disconnected', occurredAt: new Date().toISOString() })
      } catch (error) { errors.push(error) }
      finally { complete(launch.launchId, { kind: 'disconnected' }) }
    }
    if (errors.length) throw new AggregateError(errors, 'Codex disconnect persistence failed')
  }
  const connection = await connectCodexProxy({ ...options,
    onNotification: async (method, params) => { if (!ready) buffered.push({ method, params }); else await receive(method, params) },
    onDisconnect: disconnect,
  })
  const reconcile = async (launch: AgentLaunch) => {
    const threadId = launch.providerRunId
    let { thread } = z.object({ thread: ThreadSchema }).parse(await connection.request('thread/read', { threadId }))
    if (thread.status.type === 'notLoaded') {
      await connection.request('thread/resume', { threadId, excludeTurns: true })
      ;({ thread } = z.object({ thread: ThreadSchema }).parse(await connection.request('thread/read', { threadId })))
    }
    let cursor: string | undefined
    let lastAt: string | undefined
    do {
      let page: z.infer<typeof TurnPageSchema>
      try { page = TurnPageSchema.parse(await connection.request('thread/turns/list', { threadId, cursor, limit: 100, sortDirection: 'asc', itemsView: 'full' })) }
      catch (error) {
        // 0.163.0 explicitly distinguishes an idle thread with no first message from lost history.
        const empty = `Codex protocol error -32600: thread ${threadId} is not materialized yet; thread/turns/list is unavailable before first user message`
        if (thread.status.type === 'idle' && error instanceof Error && error.message === empty) break
        throw error
      }
      for (const turn of page.data) {
        const time = turn.completedAt ?? turn.startedAt
        if (time !== null && time !== undefined) lastAt = new Date(time * 1000).toISOString()
        if (!lastAt) continue // No authoritative timestamp means no invented activity clock.
        for (const [index, event] of codexReconciliationEvents(turn).entries()) {
          await store.append({ ...event, launchId: launch.launchId, eventId: `reconcile:${turn.id}:${index}:${turn.status}`, occurredAt: lastAt })
        }
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    const kind = thread.status.type === 'active' ? 'run-started' : thread.status.type === 'idle' ? 'unknown' : thread.status.type === 'systemError' ? 'run-failed' : 'disconnected'
    await store.append({ launchId: launch.launchId, eventId: randomUUID(), kind, providerKind: 'thread/read', providerStatus: thread.status.type, occurredAt: lastAt ?? (await store.records()).find(record => record.sourceId === launch.launchId)!.updatedAt })
  }
  try {
    for (const launch of launches) await reconcile(launch)
    while (buffered.length) { const message = buffered.shift()!; await receive(message.method, message.params) }
    ready = true
    return {
      request: connection.request,
      completed: (launchId: string, signal?: AbortSignal) => terminal.has(launchId) ? Promise.resolve([terminal.get(launchId)]) : once(completions, launchId, { signal }),
      async launch(metadata: Omit<AgentLaunch, 'providerRunId'>, threadOptions: Record<string, unknown> = {}) {
        if (metadata.provider !== 'codex') throw new Error('Codex metadata requires codex provider')
        const result = z.object({ thread: z.object({ id: z.string() }) }).parse(await connection.request('thread/start', threadOptions))
        const launch = { ...metadata, providerRunId: result.thread.id }
        await store.register(launch)
        byThread.set(launch.providerRunId, launch)
        return launch
      },
      async close() { await connection.close(); await disconnect() },
    }
  } catch (error) { await connection.close(); await disconnect(); throw error }
}
