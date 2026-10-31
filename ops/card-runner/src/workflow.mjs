// JUL-295 step 1: one card's build evidence reaches Shipping by itself.
//
// The shape is a Mastra workflow: a build step, a loop that lets a free model
// judge until it returns a usable verdict, one final pass on Kimi K3.1 Pro, and
// a step that puts both verdicts where a person and CI can read them.
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { DEFAULTS, thinkingForEffort } from './config.mjs'
import { evidenceBlock, selectEvidence } from './evidence.mjs'
import { exhaustedComment, buildPrompt, shippingPrompt, verdictComment } from './prompts.mjs'
import { prepareRunDir } from './settings.mjs'
import { runSession as defaultRunSession } from './session.mjs'
import { parseVerdict, validateVerdict, criteriaFrom } from './verdict.mjs'
import {
  loadCard as defaultLoadCard,
  postCardComment as defaultPostCardComment,
  postPullComment as defaultPostPullComment,
  prepareCheckout as defaultPrepareCheckout,
  requirePull as defaultRequirePull,
} from './card.mjs'

export const STATE_DIR = process.env.CARD_RUNNER_STATE_DIR ?? '/var/lib/julia-dashboard/state/runs'

const modelsSchema = z.object({
  build: z.string(),
  memory: z.string(),
  helper: z.string(),
  shippingFree: z.string(),
  shippingFinal: z.string(),
  effort: z.string(),
  freeAttempts: z.number(),
  timeoutMs: z.number(),
})

const verdictSchema = z.object({
  juliaShippingVerdict: z.number(),
  card: z.string(),
  head: z.string(),
  verdict: z.enum(['PASS', 'FAIL']),
  builder: z.string(),
  verifier: z.string(),
  criteria: z.array(z.object({
    criterion: z.string(),
    verdict: z.enum(['PASS', 'FAIL']),
    note: z.string(),
  })),
})

const activitySchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  model: z.string(),
  ok: z.boolean(),
  usage: z.record(z.string(), z.number()).optional(),
  error: z.string().optional(),
})

const evidenceSchema = z.object({
  id: z.string(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
})

export const runStateSchema = z.object({
  card: z.string(),
  runDir: z.string(),
  appData: z.string(),
  settingsPath: z.string(),
  branch: z.string(),
  checkout: z.string(),
  pull: z.object({ number: z.number(), head: z.string(), url: z.string() }),
  builder: z.string(),
  evidenceStartedAt: z.string(),
  evidence: z.array(evidenceSchema),
  models: modelsSchema,
  timeline: z.array(activitySchema),
  freeAttempts: z.number(),
  freeErrors: z.array(z.string()),
  freeVerdict: verdictSchema.nullable(),
  finalVerdict: verdictSchema.nullable(),
  finalError: z.string().nullable(),
})

export const cardRunInputSchema = z.object({
  card: z.string(),
  repoDir: z.string().optional(),
  runDir: z.string().optional(),
  models: modelsSchema.partial().optional(),
})

function modelsFor(overrides = {}) {
  return { ...DEFAULTS, ...overrides }
}

function appendStep(runDir, activity) {
  mkdirSync(runDir, { recursive: true })
  appendFileSync(join(runDir, 'steps.jsonl'), `${JSON.stringify(activity)}\n`)
}

function writeRunRecord(runDir, record) {
  mkdirSync(runDir, { recursive: true })
  const path = join(runDir, 'run.json')
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
  return path
}

function clearVerdictFile(path) {
  rmSync(path, { force: true })
}

export function createCardRunWorkflow(overrides = {}) {
  const deps = {
    loadCard: defaultLoadCard,
    prepareCheckout: defaultPrepareCheckout,
    requirePull: defaultRequirePull,
    postCardComment: defaultPostCardComment,
    postPullComment: defaultPostPullComment,
    runSession: defaultRunSession,
    prepareRunDir,
    now: () => new Date().toISOString(),
    ...overrides,
  }

  const buildStep = createStep({
    id: 'build',
    inputSchema: cardRunInputSchema,
    outputSchema: runStateSchema,
    execute: async ({ inputData }) => {
      const models = modelsFor(inputData.models)
      const runDir = inputData.runDir ?? join(STATE_DIR, inputData.card)
      const repoDir = inputData.repoDir ?? process.cwd()
      const startedAt = deps.now()

      const card = await deps.loadCard(inputData.card)
      const prepared = await deps.prepareRunDir({ runDir, memoryModel: models.memory })
      const { branch, checkout } = await deps.prepareCheckout({ repoDir, card, runDir })

      const activity = {
        id: 'build',
        startedAt,
        finishedAt: startedAt,
        model: models.build,
        ok: false,
      }
      const session = await deps.runSession({
        prompt: buildPrompt({ card, branch }),
        model: models.build,
        thinkingLevel: thinkingForEffort(models.effort),
        title: `${card.identifier} build`,
        timeoutMs: models.timeoutMs,
        settingsPath: prepared.settingsPath,
        cwd: checkout,
        appData: prepared.appData,
        tracePath: join(runDir, 'trace-build.duckdb'),
      })
      if (!session.ok) throw new Error(`the build session did not finish: ${session.error}`)

      const pull = await deps.requirePull({ repoDir, branch })
      const after = await deps.loadCard(inputData.card)
      const evidence = selectEvidence(after.comments, startedAt)
      activity.finishedAt = deps.now()
      activity.ok = true
      appendStep(runDir, activity)

      return {
        card: card.identifier,
        runDir,
        appData: prepared.appData,
        settingsPath: prepared.settingsPath,
        branch,
        checkout,
        pull: { number: pull.number, head: pull.head, url: pull.url },
        builder: pull.builder,
        evidenceStartedAt: startedAt,
        evidence,
        models,
        timeline: [activity],
        freeAttempts: 0,
        freeErrors: [],
        freeVerdict: null,
        finalVerdict: null,
        finalError: null,
      }
    },
  })

  const shippingFreeStep = createStep({
    id: 'shipping-free',
    inputSchema: runStateSchema,
    outputSchema: runStateSchema,
    execute: async ({ inputData }) => {
      const attempt = inputData.freeAttempts + 1
      const startedAt = deps.now()
      const verdictPath = join(inputData.runDir, `shipping-free-${attempt}.json`)
      clearVerdictFile(verdictPath)
      const card = await deps.loadCard(inputData.card)
      const prompt = shippingPrompt({
        card: { ...card, identifier: inputData.card },
        evidence: evidenceBlock(inputData.evidence),
        verifierModel: inputData.models.shippingFree,
        verdictPath,
        final: false,
        pull: inputData.pull,
      })
      const session = await deps.runSession({
        prompt,
        model: inputData.models.shippingFree,
        thinkingLevel: thinkingForEffort(inputData.models.effort),
        title: `${inputData.card} shipping free attempt ${attempt}`,
        timeoutMs: inputData.models.timeoutMs,
        settingsPath: inputData.settingsPath,
        cwd: inputData.checkout,
        appData: inputData.appData,
        tracePath: join(inputData.runDir, `trace-shipping-free-${attempt}.duckdb`),
      })

      let verdict = null
      let error = session.ok ? undefined : session.error
      if (session.ok) {
        const parsed = parseVerdict(readIfPresent(verdictPath))
        if (!parsed.ok) {
          error = `the verdict was not usable: ${parsed.errors.join('; ')}`
        } else {
          const checked = validateVerdict(parsed.verdict, {
            card: inputData.card,
            head: inputData.pull.head,
            verifier: inputData.models.shippingFree,
            expectedCriteria: criteriaFor(card),
          })
          if (checked.ok) verdict = checked.verdict
          else error = `the verdict did not answer the card: ${checked.errors.join('; ')}`
        }
      }

      const activity = {
        id: `shipping-free-${attempt}`,
        startedAt,
        finishedAt: deps.now(),
        model: inputData.models.shippingFree,
        ok: Boolean(verdict),
        usage: session.usage,
        error,
      }
      appendStep(inputData.runDir, activity)
      return {
        ...inputData,
        timeline: [...inputData.timeline, activity],
        freeAttempts: attempt,
        freeErrors: error ? [...inputData.freeErrors, error] : inputData.freeErrors,
        freeVerdict: verdict ?? inputData.freeVerdict,
      }
    },
  })

  const shippingFinalStep = createStep({
    id: 'shipping-final',
    inputSchema: runStateSchema,
    outputSchema: runStateSchema,
    execute: async ({ inputData }) => {
      const startedAt = deps.now()
      const verdictPath = join(inputData.runDir, 'shipping-final.json')
      clearVerdictFile(verdictPath)
      const card = await deps.loadCard(inputData.card)
      const prompt = shippingPrompt({
        card: { ...card, identifier: inputData.card },
        evidence: evidenceBlock(inputData.evidence),
        verifierModel: inputData.models.shippingFinal,
        verdictPath,
        final: true,
        pull: inputData.pull,
      })
      const session = await deps.runSession({
        prompt,
        model: inputData.models.shippingFinal,
        thinkingLevel: thinkingForEffort(inputData.models.effort),
        title: `${inputData.card} shipping final`,
        timeoutMs: inputData.models.timeoutMs,
        settingsPath: inputData.settingsPath,
        cwd: inputData.checkout,
        appData: inputData.appData,
        tracePath: join(inputData.runDir, 'trace-shipping-final.duckdb'),
      })

      let verdict = null
      let error = session.ok ? undefined : session.error
      if (session.ok) {
        const parsed = parseVerdict(readIfPresent(verdictPath))
        if (!parsed.ok) {
          error = `the verdict was not usable: ${parsed.errors.join('; ')}`
        } else {
          const checked = validateVerdict(parsed.verdict, {
            card: inputData.card,
            head: inputData.pull.head,
            verifier: inputData.models.shippingFinal,
            expectedCriteria: criteriaFor(card),
          })
          if (checked.ok) verdict = checked.verdict
          else error = `the verdict did not answer the card: ${checked.errors.join('; ')}`
        }
      }

      const activity = {
        id: 'shipping-final',
        startedAt,
        finishedAt: deps.now(),
        model: inputData.models.shippingFinal,
        ok: Boolean(verdict),
        usage: session.usage,
        error,
      }
      appendStep(inputData.runDir, activity)
      return {
        ...inputData,
        timeline: [...inputData.timeline, activity],
        finalVerdict: verdict,
        finalError: error ?? null,
      }
    },
  })

  const recordStep = createStep({
    id: 'record',
    inputSchema: runStateSchema,
    outputSchema: runStateSchema,
    execute: async ({ inputData }) => {
      const { models, freeVerdict, finalVerdict, freeErrors, freeAttempts } = inputData
      const freeBody = freeVerdict
        ? verdictComment({ card: inputData.card, verdict: freeVerdict, model: models.shippingFree, pass: 'Free', attempts: freeAttempts })
        : exhaustedComment({ card: inputData.card, model: models.shippingFree, attempts: freeAttempts, errors: freeErrors })
      await deps.postCardComment(inputData.card, freeBody)

      if (finalVerdict) {
        await deps.postCardComment(inputData.card, verdictComment({ card: inputData.card, verdict: finalVerdict, model: models.shippingFinal, pass: 'Final', attempts: 1 }))
        await deps.postPullComment({
          repoDir: inputData.checkout,
          number: inputData.pull.number,
          body: `Shipping verdict on ${inputData.pull.head}\n\n\`\`\`json\n${JSON.stringify(finalVerdict)}\n\`\`\``,
        })
      } else {
        await deps.postCardComment(inputData.card, `## Final Shipping pass on ${models.shippingFinal}\n\nShipping gave no usable verdict: ${inputData.finalError ?? 'unknown reason'}`)
      }

      const ok = Boolean(finalVerdict)
      writeRunRecord(inputData.runDir, {
        card: inputData.card,
        branch: inputData.branch,
        pull: inputData.pull,
        startedAt: inputData.timeline[0]?.startedAt,
        finishedAt: deps.now(),
        ok,
        steps: inputData.timeline,
        freeErrors,
      })
      return { ...inputData, finalError: ok ? inputData.finalError : inputData.finalError ?? 'no final verdict' }
    },
  })

  return createWorkflow({
    id: 'card-run',
    inputSchema: cardRunInputSchema,
    outputSchema: runStateSchema,
  })
    .then(buildStep)
    .dountil(shippingFreeStep, async ({ inputData }) => Boolean(inputData.freeVerdict) || inputData.freeAttempts >= inputData.models.freeAttempts)
    .then(shippingFinalStep)
    .then(recordStep)
    .commit()
}

function readIfPresent(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function criteriaFor(card) {
  return criteriaFrom(card.description)
}
