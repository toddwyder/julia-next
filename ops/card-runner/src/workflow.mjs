// One card run, as a Mastra workflow: build, publish, collect evidence, one
// Shipping review, record the answer, then wait for Todd's yes.
//
// Mastra storage holds the run's step state, so a killed runner restarts at the
// step it died on and a paused run stays paused. The only files this workflow
// writes are the ones a person or another program needs: the build's handover,
// the judge's verdict, and the run record.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { readRunnerConfig, thinkingForEffort } from './config.mjs'
import { evidenceBlock, selectEvidence } from './evidence.mjs'
import { missingEvidence, readBuildDone, readPullDraft } from './handover.mjs'
import { buildBackPrompt, buildPrompt, shippingPrompt, verdictComment } from './prompts.mjs'
import { prepareRunDir } from './settings.mjs'
import { runSession as defaultRunSession } from './session.mjs'
import { criteriaFrom, parseVerdict, validateVerdict } from './verdict.mjs'
import { usageSummary } from './usage.mjs'
import {
  loadCard as defaultLoadCard,
  postCardComment as defaultPostCardComment,
  postPullComment as defaultPostPullComment,
  prepareAdoptedCheckout as defaultPrepareAdoptedCheckout,
  prepareCheckout as defaultPrepareCheckout,
  publishPull as defaultPublishPull,
  requirePull as defaultRequirePull,
} from './card.mjs'

export const STATE_DIR = process.env.CARD_RUNNER_STATE_DIR ?? '/var/lib/julia-dashboard/state/runs'
export const WORKFLOW_ID = 'card-run'

const modelsSchema = z.object({
  build: z.string(),
  memory: z.string(),
  helper: z.string(),
  shipping: z.string(),
})

const configSchema = z.object({
  models: modelsSchema,
  effort: z.string(),
  evidenceAttempts: z.number(),
  timeoutMs: z.number(),
  configPath: z.string(),
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
  pull: z.object({ number: z.number(), head: z.string(), url: z.string() }).nullable(),
  builder: z.string(),
  evidenceStartedAt: z.string(),
  evidence: z.array(evidenceSchema),
  config: configSchema,
  timeline: z.array(activitySchema),
  gateAttempts: z.number(),
  evidenceMissing: z.array(z.string()),
  verdictPath: z.string(),
  verdict: verdictSchema.nullable(),
  verdictError: z.string().nullable(),
  postError: z.string().nullable(),
  approved: z.boolean().nullable(),
  approvedAt: z.string().nullable(),
})

export const cardRunInputSchema = z.object({
  card: z.string(),
  repoDir: z.string().optional(),
  runDir: z.string().optional(),
  shipOnly: z.boolean().optional(),
  branch: z.string().optional(),
  // Tests pass a config object; the command line never does, so a real run
  // always reads dashboard/config/defaults.json.
  config: configSchema.optional(),
})

export function runRecordPath(runDir, runId) {
  return join(runDir, 'records', `${runId}.json`)
}

export function readRunRecord(runDir, runId) {
  return JSON.parse(readFileSync(runRecordPath(runDir, runId), 'utf8'))
}

function writeRunRecord(runDir, runId, record) {
  const path = runRecordPath(runDir, runId)
  mkdirSync(join(runDir, 'records'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
  return path
}

// A verdict is only worth the pass that produced it, so a dropped connection
// while posting it is retried instead of ending the run without a record.
async function postUntilItLands(send, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send()
    } catch (error) {
      if (attempt >= attempts) throw error
      await new Promise((done) => setTimeout(done, 2000 * attempt))
    }
  }
}

export function verdictPathFor(runDir, runId) {
  return join(runDir, 'verdicts', `${runId}.json`)
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

export function createCardRunWorkflow(overrides = {}) {
  const deps = {
    loadCard: defaultLoadCard,
    prepareCheckout: defaultPrepareCheckout,
    prepareAdoptedCheckout: defaultPrepareAdoptedCheckout,
    publishPull: defaultPublishPull,
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
      const config = inputData.config ?? readRunnerConfig()
      const { models } = config
      const runDir = inputData.runDir ?? join(STATE_DIR, inputData.card)
      const repoDir = inputData.repoDir ?? process.cwd()
      const startedAt = deps.now()

      const card = await deps.loadCard(inputData.card)
      const prepared = await deps.prepareRunDir({
        runDir,
        buildModel: models.build,
        memoryModel: models.memory,
        helperModel: models.helper,
        shippingModel: models.shipping,
        thinkingLevel: thinkingForEffort(config.effort),
      })
      let branch
      let checkout
      let evidenceStartedAt = startedAt

      const activity = {
        id: inputData.shipOnly ? 'build-handover' : 'build',
        startedAt,
        finishedAt: startedAt,
        model: models.build,
        ok: false,
      }

      if (inputData.shipOnly) {
        // A build that already ran outside this workflow hands over its branch
        // and the file that says it is done. The runner keeps that branch and
        // starts at the same place as a build it ran itself.
        const handedOver = readBuildDone({ runDir, card: card.identifier })
        branch = inputData.branch ?? handedOver.branch
        if (handedOver.branch !== branch) throw new Error(`the build said it was done on ${handedOver.branch}, expected ${branch}`)
        checkout = (await deps.prepareAdoptedCheckout({ repoDir, branch, runDir })).checkout
        evidenceStartedAt = handedOver.startedAt ?? startedAt
      } else {
        const preparedCheckout = await deps.prepareCheckout({ repoDir, card, runDir })
        branch = preparedCheckout.branch
        checkout = preparedCheckout.checkout
        const session = await deps.runSession({
          prompt: buildPrompt({ card, branch, runDir }),
          model: models.build,
          thinkingLevel: thinkingForEffort(config.effort),
          title: `${inputData.card} build`,
          timeoutMs: config.timeoutMs,
          settingsPath: prepared.settingsPath,
          cwd: checkout,
          appData: prepared.appData,
          tracePath: join(runDir, 'trace-build.duckdb'),
        })
        activity.finishedAt = deps.now()
        activity.ok = session.ok
        activity.usage = session.usage
        activity.error = session.ok ? undefined : session.error
        if (!session.ok) throw new Error(`the build session did not finish: ${session.error}`)
        readBuildDone({ runDir, card: inputData.card })
      }

      const after = await deps.loadCard(inputData.card)
      const evidence = selectEvidence(after.comments, evidenceStartedAt)
      return {
        card: inputData.card,
        runDir,
        appData: prepared.appData,
        settingsPath: prepared.settingsPath,
        branch,
        checkout,
        pull: null,
        builder: '',
        evidenceStartedAt,
        evidence,
        config,
        timeline: [activity],
        gateAttempts: 0,
        evidenceMissing: missingEvidence(evidence, criteriaFor(after)),
        verdictPath: '',
        verdict: null,
        verdictError: null,
        postError: null,
        approved: null,
        approvedAt: null,
      }
    },
  })

  const publishStep = createStep({
    id: 'publish',
    inputSchema: runStateSchema,
    outputSchema: runStateSchema,
    execute: async ({ inputData }) => {
      const startedAt = deps.now()
      const draft = readPullDraft({ runDir: inputData.runDir, card: inputData.card })
      const pull = await deps.publishPull({
        repoDir: inputData.checkout,
        branch: inputData.branch,
        title: draft.title,
        body: draft.body,
      })
      const activity = {
        id: 'publish',
        startedAt,
        finishedAt: deps.now(),
        model: 'gh',
        ok: true,
      }
      return {
        ...inputData,
        pull: { number: pull.number, head: pull.head, url: pull.url },
        builder: pull.builder,
        timeline: [...inputData.timeline, activity],
      }
    },
  })

  // Shipping only starts once every criterion has its own evidence comment.
  // When one is missing the same build session goes back for it, and a run that
  // never produces the evidence stops without a Shipping review.
  const evidenceGateStep = createStep({
    id: 'evidence-gate',
    inputSchema: runStateSchema,
    outputSchema: runStateSchema,
    execute: async ({ inputData }) => {
      if (!inputData.evidenceMissing.length) {
        const activity = {
          id: 'evidence-gate',
          startedAt: deps.now(),
          finishedAt: deps.now(),
          model: 'none',
          ok: true,
        }
        return { ...inputData, timeline: [...inputData.timeline, activity] }
      }

      const attempt = inputData.gateAttempts + 1
      if (attempt > inputData.config.evidenceAttempts) {
        throw new Error(`Shipping did not start: no evidence for ${inputData.evidenceMissing.join('; ')}`)
      }

      const startedAt = deps.now()
      const card = await deps.loadCard(inputData.card)
      const session = await deps.runSession({
        prompt: buildBackPrompt({
          card: { ...card, identifier: inputData.card },
          branch: inputData.branch,
          runDir: inputData.runDir,
          missing: inputData.evidenceMissing,
        }),
        model: inputData.config.models.build,
        thinkingLevel: thinkingForEffort(inputData.config.effort),
        title: `${inputData.card} build back ${attempt}`,
        timeoutMs: inputData.config.timeoutMs,
        settingsPath: inputData.settingsPath,
        cwd: inputData.checkout,
        appData: inputData.appData,
        tracePath: join(inputData.runDir, `trace-build-back-${attempt}.duckdb`),
      })
      if (!session.ok) throw new Error(`the build-back session did not finish: ${session.error}`)
      readBuildDone({ runDir: inputData.runDir, card: inputData.card })

      // A build-back can add a commit, so the pull request head is read again.
      const pull = await deps.requirePull({ repoDir: inputData.checkout, branch: inputData.branch })
      const after = await deps.loadCard(inputData.card)
      const evidence = selectEvidence(after.comments, inputData.evidenceStartedAt)
      const evidenceMissing = missingEvidence(evidence, criteriaFor(after))

      const activity = {
        id: `build-back-${attempt}`,
        startedAt,
        finishedAt: deps.now(),
        model: inputData.config.models.build,
        ok: evidenceMissing.length === 0,
        usage: session.usage,
        error: evidenceMissing.length ? `still no evidence for ${evidenceMissing.join('; ')}` : undefined,
      }
      return {
        ...inputData,
        pull: { number: pull.number, head: pull.head, url: pull.url },
        builder: pull.builder,
        evidence,
        evidenceMissing,
        gateAttempts: attempt,
        timeline: [...inputData.timeline, activity],
      }
    },
  })

  // One Shipping review per run. The judge writes its answer to a file named
  // after this run, and that file is never deleted. A marker written before the
  // session starts means a restarted step reads the kept answer instead of
  // starting a second review.
  const shippingStep = createStep({
    id: 'shipping',
    inputSchema: runStateSchema,
    outputSchema: runStateSchema,
    execute: async ({ inputData, runId }) => {
      const startedAt = deps.now()
      const verdictPath = verdictPathFor(inputData.runDir, runId)
      const markerPath = join(inputData.runDir, 'verdicts', `${runId}.started.json`)
      const model = inputData.config.models.shipping

      let session = null
      if (existsSync(verdictPath)) {
        // A restarted step finds the answer already on disk.
      } else if (existsSync(markerPath)) {
        const error = `the Shipping review already ran as part of this run and wrote no answer; this run starts no second review`
        const activity = { id: 'shipping', startedAt, finishedAt: deps.now(), model, ok: false, error }
        return {
          ...inputData,
          verdictPath,
          verdict: null,
          verdictError: error,
          timeline: [...inputData.timeline, activity],
        }
      } else {
        mkdirSync(join(inputData.runDir, 'verdicts'), { recursive: true })
        writeFileSync(markerPath, `${JSON.stringify({ model, startedAt })}\n`)
        const card = await deps.loadCard(inputData.card)
        session = await deps.runSession({
          prompt: shippingPrompt({
            card: { ...card, identifier: inputData.card },
            evidence: evidenceBlock(inputData.evidence),
            verifierModel: model,
            verdictPath,
            pull: inputData.pull,
          }),
          model,
          thinkingLevel: thinkingForEffort(inputData.config.effort),
          title: `${inputData.card} shipping`,
          timeoutMs: inputData.config.timeoutMs,
          settingsPath: inputData.settingsPath,
          cwd: inputData.checkout,
          appData: inputData.appData,
          tracePath: join(inputData.runDir, 'trace-shipping.duckdb'),
        })
      }

      let verdict = null
      let error = session && !session.ok ? session.error : undefined
      if (!error || existsSync(verdictPath)) {
        const parsed = parseVerdict(readIfPresent(verdictPath))
        if (!parsed.ok) {
          error = `the verdict was not usable: ${parsed.errors.join('; ')}`
        } else {
          const card = await deps.loadCard(inputData.card)
          const checked = validateVerdict(parsed.verdict, {
            card: inputData.card,
            head: inputData.pull.head,
            verifier: model,
            expectedCriteria: criteriaFor(card),
          })
          if (checked.ok) verdict = checked.verdict
          else error = `the verdict did not answer the card: ${checked.errors.join('; ')}`
        }
      }

      const activity = {
        id: 'shipping',
        startedAt,
        finishedAt: deps.now(),
        model,
        ok: Boolean(verdict),
        usage: session?.usage,
        error,
      }
      return {
        ...inputData,
        verdictPath,
        verdict,
        verdictError: verdict ? null : (error ?? 'Shipping gave no answer'),
        timeline: [...inputData.timeline, activity],
      }
    },
  })

  const recordStep = createStep({
    id: 'record',
    inputSchema: runStateSchema,
    outputSchema: runStateSchema,
    execute: async ({ inputData, runId }) => {
      const model = inputData.config.models.shipping
      let postError = null
      try {
        if (inputData.verdict) {
          await postUntilItLands(() => deps.postCardComment(
            inputData.card,
            verdictComment({ model: inputData.verdict.verifier ?? model, verdict: inputData.verdict }),
          ))
          if (inputData.pull) {
            await postUntilItLands(() => deps.postPullComment({
              repoDir: inputData.checkout,
              number: inputData.pull.number,
              body: `Shipping verdict on ${inputData.pull.head}\n\n\`\`\`json\n${JSON.stringify(inputData.verdict)}\n\`\`\``,
            }))
          }
        } else {
          await postUntilItLands(() => deps.postCardComment(
            inputData.card,
            `## Shipping pass on ${model}\n\nShipping gave no usable verdict: ${inputData.verdictError ?? 'unknown reason'}`,
          ))
        }
      } catch (error) {
        // The answer is kept on disk, so a failed post loses nothing and can be
        // sent again with `run.mjs <card> --repost <runId>`.
        postError = error.message
      }

      const usage = usageSummary(inputData.timeline)
      const recordPath = writeRunRecord(inputData.runDir, runId, {
        runId,
        card: inputData.card,
        branch: inputData.branch,
        checkout: inputData.checkout,
        pull: inputData.pull,
        configPath: inputData.config.configPath,
        startedAt: inputData.timeline[0]?.startedAt,
        finishedAt: deps.now(),
        ok: Boolean(inputData.verdict) && !postError,
        verdictPath: inputData.verdictPath,
        verdict: inputData.verdict,
        verdictError: inputData.verdictError,
        postError,
        tokens: usage.tokens,
        costUsd: usage.costUsd,
        costNote: usage.costNote,
        priceCatalogue: usage.priceCatalogue,
        steps: inputData.timeline,
      })
      return { ...inputData, postError }
    },
  })

  const approvalStep = createStep({
    id: 'approval',
    inputSchema: runStateSchema,
    outputSchema: runStateSchema,
    suspendSchema: z.object({
      card: z.string(),
      runId: z.string().optional(),
      verdict: z.string().nullable(),
      question: z.string(),
    }),
    resumeSchema: z.object({ approved: z.boolean() }),
    execute: async ({ inputData, resumeData, suspend, runId }) => {
      if (inputData.verdict?.verdict !== 'PASS') {
        // Nothing reaches UAT without a Shipping PASS, so a FAIL or an unusable
        // answer ends here instead of asking for a yes it would not mean.
        return { ...inputData, approved: false, approvedAt: null }
      }
      if (!resumeData) {
        return suspend({
          card: inputData.card,
          runId,
          verdict: inputData.verdict?.verdict ?? null,
          question: `Approve ${inputData.card} for UAT?`,
        })
      }
      return { ...inputData, approved: resumeData.approved, approvedAt: deps.now() }
    },
  })

  return createWorkflow({
    id: WORKFLOW_ID,
    inputSchema: cardRunInputSchema,
    outputSchema: runStateSchema,
  })
    .then(buildStep)
    .then(publishStep)
    .dountil(evidenceGateStep, async ({ inputData }) => inputData.evidenceMissing.length === 0)
    .then(shippingStep)
    .then(recordStep)
    .then(approvalStep)
    .commit()
}
