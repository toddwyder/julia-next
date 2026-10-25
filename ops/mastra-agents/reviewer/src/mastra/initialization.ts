import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { Mastra } from '@mastra/core/mastra'
import { createStep, createWorkflow, createWorkflowStateReader } from '@mastra/core/workflows'
import { LibSQLStore } from '@mastra/libsql'
import { MastraStorageExporter, Observability } from '@mastra/observability'
import { SamplingStrategyType } from '@mastra/core/observability'
import type { z } from 'zod/v4'
import type { InitializationActivityRecorder } from './initialization-observability.ts'
import { createRoleExecutionWorkflow } from './workflows/delivery.ts'
import { createAgentActivityStore } from './agent-activity.ts'
import { monitorMastraStream } from './agent-mastra.ts'

import {
  InitializationInputSchema,
  InitializationResultSchema,
  InitializationRunsStateSchema,
  ControlPageStateSchema,
  ModelOfferSchema,
  ReadyForBuildSchema,
  RunSnapshotSchema,
  StartInitializationSchema,
} from './contracts.ts'

type StartInitialization = z.infer<typeof StartInitializationSchema>
type ControlPageState = z.infer<typeof ControlPageStateSchema>

export const INITIALIZATION_WORKFLOW_ID = 'julia-initialization'
export const READY_FOR_BUILD_STEP_ID = 'suspend-ready-for-build'

export function ensureInitializationSelectionsOffered(input: StartInitialization, offers: unknown) {
  const parsed = StartInitializationSchema.parse(input)
  const currentOffers = ModelOfferSchema.array().parse(offers)
  for (const [role, selection] of Object.entries(parsed.roles)) {
    const offer = currentOffers.find(candidate => candidate.route === selection.route && candidate.modelId === selection.modelId)
    if (!offer) throw new Error(`${role} selection ${selection.route}:${selection.modelId} is unavailable or stale`)
    if (offer.company !== selection.company || offer.service !== selection.service || offer.wire !== selection.wire) {
      throw new Error(`${role} selection metadata differs from the current offer`)
    }
    if (!offer.supportedEfforts.includes(selection.effort)) {
      throw new Error(`${role} effort ${selection.effort} is not supported by ${selection.route}:${selection.modelId}`)
    }
  }
  return parsed
}

export function ensureDistinctReviewer(roles: StartInitialization['roles']) {
  const reviewer = roles.reviewer
  if (!reviewer) throw new Error('reviewer selection is required')
  if (reviewer.company === roles.orchestrator.company) {
    throw new Error(`reviewer ${reviewer.company} must come from a different company than the orchestrator ${roles.orchestrator.company}`)
  }
  if (reviewer.company === roles.coder.company) {
    throw new Error(`reviewer ${reviewer.company} must come from a different company than the coder ${roles.coder.company}`)
  }
  return reviewer
}

export function validateInitializationRequest(input: StartInitialization, state: ControlPageState) {
  const parsedState = ControlPageStateSchema.parse(state)
  const parsed = ensureInitializationSelectionsOffered(input, parsedState.offers)
  ensureDistinctReviewer(parsed.roles)
  const currentCard = parsedState.cards.find(entry => entry.card.identifier === parsed.card.identifier)
  if (!currentCard) throw new Error(`${parsed.card.identifier} is no longer a current Ready card`)
  if (!currentCard.admitted) throw new Error(`${parsed.card.identifier} cannot start: ${currentCard.card.reason}`)
  if (JSON.stringify(currentCard.card) !== JSON.stringify(parsed.card)) {
    throw new Error(`${parsed.card.identifier} differs from the current admitted card`)
  }
  return parsed
}

export function createInitializationWorkflow() {
  const suspendReadyForBuild = createStep({
    id: READY_FOR_BUILD_STEP_ID,
    inputSchema: InitializationInputSchema,
    outputSchema: RunSnapshotSchema,
    suspendSchema: ReadyForBuildSchema,
    execute: async ({ inputData, runId, suspend }) => {
      const snapshot = RunSnapshotSchema.parse({
        runId,
        card: inputData.card,
        roles: inputData.roles,
        state: 'ready-for-build',
        initializedAt: inputData.initializedAt,
      })
      return await suspend(ReadyForBuildSchema.parse({ state: 'ready-for-build', snapshot }))
    },
  })
  return createWorkflow({ id: INITIALIZATION_WORKFLOW_ID, inputSchema: InitializationInputSchema, outputSchema: RunSnapshotSchema })
    .then(suspendReadyForBuild)
    .commit()
}

function runIdFor(input: StartInitialization) {
  const digest = createHash('sha256').update(JSON.stringify(StartInitializationSchema.parse(input))).digest('hex')
  return `${input.card.identifier.toLowerCase()}-${digest.slice(0, 32)}`
}

export async function createInitializationRuntime({ storagePath, activity }: { storagePath: string; activity: InitializationActivityRecorder }) {
  const storageUrl = `file:${resolve(storagePath).replaceAll('\\', '/')}`
  const agentStore = await createAgentActivityStore(storagePath)
  const storage = new LibSQLStore({ id: 'julia-initialization-local', url: storageUrl, localPragmas: { mmapSize: 0 } })
  const initializationWorkflow = createInitializationWorkflow()
  const deliveryWorkflow = createRoleExecutionWorkflow({ activity })
  const observabilityRuntime = new Observability({
    configs: { default: { serviceName: 'julia-control', sampling: { type: SamplingStrategyType.ALWAYS }, exporters: [new MastraStorageExporter()] } },
  })
  const mastra = new Mastra({
    storage,
    workflows: { initializationWorkflow, deliveryWorkflow },
    observability: observabilityRuntime,
  })
  const workflow = mastra.getWorkflow('initializationWorkflow')
  const observabilityStore = await storage.getStore('observability')
  const pending = new Map<string, Promise<z.infer<typeof InitializationResultSchema>>>()

  const read = async (runId: string, resumed = true) => {
    const state = await workflow.getWorkflowRunById(runId)
    if (!state) return null
    if (state.status !== 'suspended') throw new Error(`initialization run ${runId} has unexpected status ${state.status}`)
    const suspended = createWorkflowStateReader(state).getSuspendedStep()
    if (suspended?.stepId !== READY_FOR_BUILD_STEP_ID) throw new Error(`initialization run ${runId} is suspended at an unexpected step`)
    const ready = ReadyForBuildSchema.parse(suspended.suspendPayload)
    if (ready.snapshot.runId !== runId) throw new Error('persisted initialization snapshot belongs to another run')
    return InitializationResultSchema.parse({ runId, state: ready.state, snapshot: ready.snapshot, resumed })
  }

  return {
    async start(input: StartInitialization, state: ControlPageState) {
      const parsed = validateInitializationRequest(input, state)
      const runId = runIdFor(parsed)
      const existing = await read(runId)
      if (existing) return existing
      const active = pending.get(runId)
      if (active) return active
      const starting = (async () => {
        const run = await workflow.createRun({ runId })
        const stream = run.stream({ inputData: InitializationInputSchema.parse({
          ...parsed, runId, initializedAt: new Date().toISOString(),
        }), tracingOptions: { metadata: { cardIdentifier: parsed.card.identifier, role: 'Initialization', model: 'Workflow', stage: 'Initialize', round: 1 } } })
        const result = await monitorMastraStream({ store: agentStore, launch: { launchId: runId, provider: 'mastra', providerRunId: runId, cardIdentifier: parsed.card.identifier, cardTitle: parsed.card.title, role: 'Initialization', model: 'Workflow', stage: 'Initialize', round: 1 }, stream, flush: () => observabilityRuntime.flush() })
        if (result.status !== 'suspended') throw new Error(`initialization run ${runId} did not suspend before delivery`)
        const saved = await read(runId, false)
        if (!saved) throw new Error(`initialization run ${runId} was not persisted`)
        return saved
      })()
      pending.set(runId, starting)
      try { return await starting } finally { pending.delete(runId) }
    },
    read,
    async list() {
      const listed = await workflow.listWorkflowRuns()
      const runs = await Promise.all(listed.runs.map(async (run: { runId: string }) => {
        const saved = await read(run.runId)
        if (!saved) throw new Error(`listed initialization run ${run.runId} could not be read`)
        return saved
      }))
      return InitializationRunsStateSchema.parse({ runs, totalRuns: listed.total })
    },
    async runCount() {
      return (await workflow.listWorkflowRuns()).total
    },
    async listMastraTraces() {
      await observabilityRuntime.flush()
      if (!observabilityStore) return []
      const roots = []
      for (let page = 0; ; page += 1) {
        const listed = await observabilityStore.listTraces({ pagination: { page, perPage: 100 }, orderBy: { field: 'startedAt', direction: 'DESC' } })
        roots.push(...listed.spans)
        if (listed.spans.length < 100) break
      }
      return Promise.all(roots.map(async root => {
        const trace = await observabilityStore.getTrace({ traceId: root.traceId })
        return trace ? {
          traceId: root.traceId,
          name: root.name,
          startedAt: root.startedAt.toISOString(),
          endedAt: root.endedAt?.toISOString(),
          metadata: root.metadata,
          spans: trace.spans.map(span => ({
            ...span,
            startedAt: span.startedAt.toISOString(),
            endedAt: span.endedAt?.toISOString(),
            createdAt: span.createdAt.toISOString(),
            updatedAt: span.updatedAt?.toISOString(),
          })),
        } : null
      })).then(traces => traces.filter(Boolean))
    },
    async close() {
      await observabilityRuntime.shutdown()
      await mastra.shutdown()
      agentStore.close()
    },
  }
}
