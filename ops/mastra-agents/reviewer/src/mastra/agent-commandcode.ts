import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import type { AgentEvent, AgentLaunch } from './agent-events.ts'
import type { createAgentActivityStore } from './agent-activity.ts'
import { agentError } from './agent-errors.ts'

type EventBody = Omit<AgentEvent, 'launchId' | 'eventId' | 'occurredAt'>
const FrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event'), event: z.object({ type: z.string().min(1) }).passthrough() }).passthrough(),
  z.object({ type: z.literal('result'), subtype: z.enum(['success', 'error', 'max_turns']) }).passthrough(),
])
const RunningToolSchema = z.object({ type: z.literal('tool_running'), toolCallId: z.string().min(1), toolName: z.string().min(1).max(160) })
const ToolEndSchema = z.object({ type: z.enum(['tool_completed', 'tool_errored']), toolCallId: z.string().min(1), toolName: z.string().min(1).max(160), error: z.string().optional() })

/** 1.72.3 bundled headless.md: unknown event kinds are retained without invented semantics. */
export function commandCodeEvent(value: unknown): EventBody {
  const frame = FrameSchema.parse(value)
  if (frame.type === 'result') return { kind: frame.subtype === 'success' ? 'run-completed' : 'run-failed', providerKind: 'result', providerStatus: frame.subtype }
  if (frame.event.type === 'run_start') return { kind: 'run-started', providerKind: 'run_start', providerStatus: 'running' }
  if (['turn_start', 'turn_end', 'model_request_start', 'model_request_end'].includes(frame.event.type)) return { kind: 'progress', providerKind: frame.event.type, providerStatus: frame.event.type }
  const running = RunningToolSchema.safeParse(frame.event)
  if (running.success) return { kind: 'action-started', providerKind: 'tool_running', providerStatus: 'running', action: { id: running.data.toolCallId, type: 'tool', name: running.data.toolName, outcome: 'unknown' } }
  const ended = ToolEndSchema.safeParse(frame.event)
  if (ended.success) {
    const tool = ended.data
    const failed = tool.type === 'tool_errored'
    // Only the explicit error field contributes to failure identity. Tool result/output is excluded.
    const errorCategory = failed ? createHash('sha256').update((tool.error ?? 'unspecified-tool-error').replace(/\s+/g, ' ').trim()).digest('hex') : undefined
    return { kind: 'action-completed', providerKind: tool.type, providerStatus: failed ? 'errored' : 'completed', action: { id: tool.toolCallId, type: 'tool', name: tool.toolName, outcome: failed ? 'failed' : 'unknown', ...(failed ? { errorCode: 'tool_errored', errorCategory } : {}) } }
  }
  return { kind: 'unknown', providerKind: frame.event.type.slice(0, 160), providerStatus: 'unknown' }
}

export async function runMonitoredCommandCode({ store, launch, prompt, cwd, executable = 'command-code', maxTurns = 100, signal, allowTools = false }: {
  store: Awaited<ReturnType<typeof createAgentActivityStore>>; launch: AgentLaunch; prompt: string; cwd: string; executable?: string; maxTurns?: number; signal?: AbortSignal; allowTools?: boolean
}) {
  if (launch.provider !== 'commandcode') throw new Error('CommandCode launch requires commandcode provider')
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) throw new Error('Monitored CommandCode maxTurns must be a positive safe integer')
  await store.register(launch)
  const child = spawn(executable, ['-p', prompt, '--output-format', 'json', '--max-turns', String(maxTurns), '--skip-onboarding', '--no-auto-update', '--trust', ...(allowTools ? ['--yolo'] : [])], { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.resume() // Human stderr can contain prompts or credentials; never ingest it.
  const exited = new Promise<{ code: number | null; error?: Error }>(resolve => {
    child.once('error', error => resolve({ code: null, error }))
    child.once('close', code => resolve({ code }))
  })
  let started = false
  let terminal = false
  let usage: unknown
  const append = (event: EventBody) => store.append({ ...event, launchId: launch.launchId, eventId: randomUUID(), occurredAt: new Date().toISOString() })
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      if (!line.trim()) continue
      const raw: unknown = JSON.parse(line)
      const frame = FrameSchema.parse(raw)
      const nativeId = frame.type === 'result' ? frame.sessionId : frame.event.sessionId
      if (typeof nativeId === 'string' && nativeId) await store.identify(launch.launchId, nativeId)
      if (!started) {
        started = true
        await append({ kind: 'run-started', providerKind: 'event-stream-start', providerStatus: 'running' })
      }
      const event = commandCodeEvent(frame)
      if (frame.type === 'event' && frame.event.type === 'tool_errored' && typeof frame.event.error === 'string') {
        console.error(JSON.stringify(agentError(new Error('CommandCode tool failed', { cause: new Error(frame.event.error) }), { provider: 'commandcode', runId: launch.launchId, eventKind: 'tool_errored' })))
      }
      await append(event)
      if (frame.type === 'result') { terminal = true; usage = frame.usage }
    }
  } catch (error) {
    child.kill('SIGTERM')
    console.error(JSON.stringify(agentError(error, { provider: 'commandcode', runId: launch.providerRunId, eventKind: 'stream-error' })))
    await append({ kind: 'disconnected', providerKind: 'stream-error', providerStatus: 'invalid-stream' })
    throw new Error('CommandCode stream failed', { cause: error })
  }
  const result = await exited
  if (result.error) console.error(JSON.stringify(agentError(result.error, { provider: 'commandcode', runId: launch.launchId, eventKind: 'child-exit' })))
  if (result.code !== 0 || !terminal) await append({ kind: result.code === 0 || result.code === null ? 'disconnected' : 'run-failed', providerKind: 'child-exit', providerStatus: result.code === null ? 'spawn-error' : `exit-${result.code}` })
  return { exitCode: result.code, terminal, usage }
}
