import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import type { AgentEvent, AgentLaunch } from './agent-events.ts'
import type { createAgentActivityStore } from './agent-activity.ts'
import { agentError } from './agent-errors.ts'

const ChunkSchema = z.object({ type: z.string(), payload: z.record(z.string(), z.unknown()) })
const StepSchema = z.object({ id: z.string().min(1), stepCallId: z.string().optional(), status: z.string() })
type Body = Omit<AgentEvent, 'launchId' | 'eventId' | 'occurredAt'>

export function mastraEvent(value: unknown): Body {
  const chunk = ChunkSchema.parse(value)
  if (chunk.type === 'workflow-start') return { kind: 'run-started', providerKind: chunk.type, providerStatus: 'running' }
  if (chunk.type === 'workflow-canceled') return { kind: 'run-canceled', providerKind: chunk.type, providerStatus: 'canceled' }
  if (chunk.type === 'workflow-paused' || chunk.type === 'workflow-step-suspended') return { kind: 'run-suspended', providerKind: chunk.type, providerStatus: 'suspended' }
  if (chunk.type === 'workflow-step-start' || chunk.type === 'workflow-step-result') {
    const step = StepSchema.parse(chunk.payload)
    const outcome = step.status === 'success' ? 'succeeded' : step.status === 'failed' ? 'failed' : 'unknown'
    return { kind: chunk.type === 'workflow-step-start' ? 'action-started' : 'action-completed', providerKind: chunk.type, providerStatus: step.status, action: {
      id: step.stepCallId ?? step.id, type: 'workflow-step', name: step.id.slice(0, 160), outcome,
      ...(outcome === 'failed' ? { errorCode: 'failed', errorCategory: 'workflow-step-error' } : {}),
    } }
  }
  // The awaited WorkflowRunOutput.result, not a trace's age, decides terminal state.
  return { kind: chunk.type === 'workflow-step-progress' ? 'progress' : 'unknown', providerKind: chunk.type.slice(0, 160), providerStatus: 'unknown' }
}

export async function monitorMastraStream<T extends { status: string }>({ store, launch, stream, flush }: {
  store: Awaited<ReturnType<typeof createAgentActivityStore>>; launch: AgentLaunch;
  stream: { fullStream: AsyncIterable<unknown>; result: Promise<T> }; flush: () => Promise<void>
}): Promise<T> {
  const settled = stream.result.then(value => ({ value }), error => ({ error }))
  if (launch.provider !== 'mastra') throw new Error('Mastra launch requires mastra provider')
  await store.register(launch)
  const append = (body: Body) => store.append({ ...body, launchId: launch.launchId, eventId: randomUUID(), occurredAt: new Date().toISOString() })
  try {
    for await (const chunk of stream.fullStream) await append(mastraEvent(chunk))
    const outcome = await settled
    if ('error' in outcome) throw outcome.error
    const result = outcome.value
    await flush()
    const kind = result.status === 'success' ? 'run-completed' : result.status === 'suspended' || result.status === 'paused' ? 'run-suspended' : result.status === 'canceled' ? 'run-canceled' : result.status === 'failed' || result.status === 'tripwire' ? 'run-failed' : 'disconnected'
    await append({ kind, providerKind: 'workflow-result', providerStatus: result.status })
    return result
  } catch (error) {
    await settled
    console.error(JSON.stringify(agentError(error, { provider: 'mastra', runId: launch.providerRunId, eventKind: 'stream-error' })))
    await append({ kind: 'disconnected', providerKind: 'stream-error', providerStatus: 'disconnected' })
    throw new Error('Mastra monitoring failed', { cause: error })
  }
}
