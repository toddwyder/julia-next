import { createClient } from '@libsql/client'
import { createHash } from 'node:crypto'
import { AgentActivityRecordSchema, AgentDashboardCardSchema } from './contracts.ts'
import { AgentEventSchema, AgentLaunchSchema } from './agent-events.ts'
import type { AgentEvent, AgentLaunch } from './agent-events.ts'
import type { z } from 'zod/v4'

export type AgentActivityRecord = z.infer<typeof AgentActivityRecordSchema>
const STUCK_AFTER_MS = 15 * 60 * 1000

export function projectAgentCards(records: AgentActivityRecord[], now = new Date()) {
  return records.filter(record => record.state !== 'finished').map(record => {
    const actions = [...record.actions].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    const inactiveMs = Math.max(0, now.getTime() - Date.parse(record.updatedAt))
    const lastThree = record.actions.filter(action => action.phase !== 'running').sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)).slice(-3)
    const repeatedFailure = lastThree.length === 3 && lastThree.every(action => action.outcome === 'failed' && action.failureKey === lastThree[0].failureKey)
    const activeCommand = actions.some(action => action.phase === 'running')
    const status = record.state === 'stopped' || repeatedFailure || (!activeCommand && inactiveMs >= STUCK_AFTER_MS) ? 'stopped' : 'working'
    const minutes = Math.floor(inactiveMs / 60000)
    return AgentDashboardCardSchema.parse({
      agentId: `${record.source}:${record.sourceId}`, source: record.source,
      cardIdentifier: record.cardIdentifier, cardTitle: record.cardTitle,
      role: record.role, model: record.model, service: record.service,
      stage: record.stage, round: record.round, startedAt: record.startedAt, updatedAt: record.updatedAt,
      status, statusDetail: record.state === 'stopped' ? 'Stopped: '+record.stopReason
        : repeatedFailure ? 'Stopped: the same action failing the same way 3 times in a row.'
        : status === 'stopped' ? `Stopped: no new action for ${minutes} min.` : activeCommand ? 'Working: command or tool running.' : `Working. Last action ${minutes} min ago.`,
      actions: actions.map(({ failureKey: _failureKey, ...action }) => action),
    })
  })
}

function project(launch: AgentLaunch, registeredAt: string, events: AgentEvent[]): AgentActivityRecord {
  const actions = new Map<string, AgentActivityRecord['actions'][number]>()
  let running = false
  let state: 'working' | 'stopped' | 'finished' = 'working'
  let stopReason = ''
  let updatedAt = registeredAt
  for (const event of events) {
    if (event.kind === 'run-started') { running = true; state = 'working'; stopReason = '' }
    if (['run-completed', 'run-canceled'].includes(event.kind)) { running = false; state = 'finished' }
    if (['run-failed', 'run-suspended', 'disconnected'].includes(event.kind)) { running = false; state = 'stopped'; stopReason = event.kind === 'run-suspended' ? 'workflow paused waiting.' : event.kind === 'disconnected' ? 'connection lost.' : 'run failed unexpectedly.' }
    if (event.kind !== 'unknown' && event.occurredAt > updatedAt) updatedAt = event.occurredAt
    if (event.action) {
      const action = event.action
      const failureKey = action.outcome === 'failed' ? createHash('sha256').update(JSON.stringify([launch.provider, action.type, action.actionKey ?? action.id, action.errorCode ?? '', action.errorCategory ?? 'provider-error'])).digest('hex') : undefined
      actions.delete(action.id)
      actions.set(action.id, { id: action.id, occurredAt: event.occurredAt, label: action.name, outcome: action.outcome, phase: event.kind === 'action-started' ? 'running' : 'completed', ...(failureKey ? { failureKey } : {}) })
    }
  }
  return AgentActivityRecordSchema.parse({ source: launch.provider, sourceId: launch.launchId, running, state, stopReason,
    cardIdentifier: launch.cardIdentifier, cardTitle: launch.cardTitle, role: launch.role, model: launch.model,
    service: launch.provider, stage: launch.stage, round: launch.round, startedAt: registeredAt, updatedAt, actions: [...actions.values()] })
}

export async function createAgentActivityStore(storagePath: string) {
  const listeners = new Set<(event: AgentEvent) => void | Promise<void>>()
  const client = createClient({ url: `file:${storagePath.replaceAll('\\', '/')}`, timeout: 5000 })
  await client.batch([
    `CREATE TABLE IF NOT EXISTS julia_agent_launches (launch_id TEXT PRIMARY KEY, registered_at TEXT NOT NULL, metadata TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS julia_agent_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, launch_id TEXT NOT NULL, event_id TEXT NOT NULL, event_json TEXT NOT NULL, UNIQUE(launch_id,event_id))`,
  ], 'write')
  const history = async (launchId: string): Promise<AgentEvent[]> => {
    const result = await client.execute({ sql: 'SELECT event_json FROM julia_agent_events WHERE launch_id=? ORDER BY sequence', args: [launchId] })
    return result.rows.map(row => AgentEventSchema.parse(JSON.parse(String(row.event_json))))
  }
  const records = async () => {
    const result = await client.execute('SELECT metadata, registered_at FROM julia_agent_launches ORDER BY registered_at')
    return Promise.all(result.rows.map(async row => {
      const launch = AgentLaunchSchema.parse(JSON.parse(String(row.metadata)))
      return project(launch, String(row.registered_at), await history(launch.launchId))
    }))
  }
  const store = {
    async register(value: AgentLaunch, at = new Date().toISOString()) {
      const launch = AgentLaunchSchema.parse(value)
      AgentEventSchema.shape.occurredAt.parse(at)
      await client.execute({ sql: 'INSERT INTO julia_agent_launches (launch_id,registered_at,metadata) VALUES (?,?,?)', args: [launch.launchId, at, JSON.stringify(launch)] })
    },
    async identify(launchId: string, providerRunId: string) {
      const result = await client.execute({ sql: 'SELECT metadata FROM julia_agent_launches WHERE launch_id=?', args: [launchId] })
      if (!result.rows.length) throw new Error('Unregistered agent launch')
      const launch = AgentLaunchSchema.parse(JSON.parse(String(result.rows[0].metadata)))
      if (!launch.providerRunId.startsWith('unresolved:') && launch.providerRunId !== providerRunId) throw new Error('Provider identity already bound')
      const identified = AgentLaunchSchema.parse({ ...launch, providerRunId })
      await client.execute({ sql: 'UPDATE julia_agent_launches SET metadata=? WHERE launch_id=?', args: [JSON.stringify(identified), launchId] })
    },
    async append(value: AgentEvent) {
      const event = AgentEventSchema.parse(value)
      const launch = await client.execute({ sql: 'SELECT metadata FROM julia_agent_launches WHERE launch_id=?', args: [event.launchId] })
      if (!launch.rows.length) throw new Error('Unregistered agent launch')
      const metadata = AgentLaunchSchema.parse(JSON.parse(String(launch.rows[0].metadata)))
      const stored = { ...event, launch: metadata }
      const result = await client.execute({ sql: 'INSERT OR IGNORE INTO julia_agent_events (launch_id,event_id,event_json) VALUES (?,?,?)', args: [event.launchId, event.eventId, JSON.stringify(stored)] })
      if (result.rowsAffected) for (const listener of listeners) await listener(stored)
    },
    history, records,
    subscribe(listener: (event: AgentEvent) => void | Promise<void>) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async launches(): Promise<AgentLaunch[]> {
      const result = await client.execute('SELECT metadata FROM julia_agent_launches ORDER BY registered_at')
      return result.rows.map(row => AgentLaunchSchema.parse(JSON.parse(String(row.metadata))))
    },
    async disconnectActive(reason: string) {
      for (const record of await records()) {
        if (!record.running) continue
        await store.append({ launchId: record.sourceId, eventId: `disconnect:${reason}:${Date.now()}`, kind: 'disconnected', providerKind: reason, providerStatus: 'disconnected', occurredAt: new Date().toISOString() })
      }
    },
    async cards(now = new Date()) { return projectAgentCards(await records(), now) },
    close: () => client.close(),
  }
  return store
}
