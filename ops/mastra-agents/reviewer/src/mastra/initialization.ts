import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { Mastra } from '@mastra/core/mastra'
import { createStep, createWorkflow, createWorkflowStateReader } from '@mastra/core/workflows'
import { LibSQLStore } from '@mastra/libsql'
import type { z } from 'zod/v4'
import type { InitializationActivityRecorder } from './initialization-observability.ts'
import { createRoleExecutionWorkflow } from './workflows/delivery.ts'

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
  if (parsed.roles.builder.company.toLowerCase() === parsed.roles.reviewer.company.toLowerCase()) {
    throw new Error('builder and reviewer must use different companies')
  }
  if (parsed.roles.crashFixer.company.toLowerCase() === parsed.roles.crashReviewer.company.toLowerCase()) {
    throw new Error('crash-fixer and crash reviewer must use different companies')
  }
  return parsed
}

export function validateInitializationRequest(input: StartInitialization, state: ControlPageState) {
  const parsedState = ControlPageStateSchema.parse(state)
  const parsed = ensureInitializationSelectionsOffered(input, parsedState.offers)
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
  const storage = new LibSQLStore({ id: 'julia-initialization-local', url: storageUrl, localPragmas: { mmapSize: 0 } })
  const initializationWorkflow = createInitializationWorkflow()
  const deliveryWorkflow = createRoleExecutionWorkflow({ activity })
  const mastra = new Mastra({ storage, workflows: { initializationWorkflow, deliveryWorkflow } })
  const workflow = mastra.getWorkflow('initializationWorkflow')
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
        const result = await run.start({ inputData: InitializationInputSchema.parse({
          ...parsed, runId, initializedAt: new Date().toISOString(),
        }) })
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
    async close() {
      await storage.close()
    },
  }
}
