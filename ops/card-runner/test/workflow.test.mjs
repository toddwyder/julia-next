import { deepEqual } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCardRunWorkflow, readRunRecord, runRecordPath, verdictPathFor } from '../src/workflow.mjs'

const BEAM = 'mastracode/commandcode/reflection/beam:free'
const KIMI = 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro'

const description = 'Outcome: two things work.\n\nAcceptance criteria:\n- The first thing works.\n- The second thing works.\n'

const firstEvidence = {
  id: 'build-evidence-1',
  createdAt: '2026-10-31T00:05:00Z',
  body: 'Prove It Works: The first thing works.\nran npm test',
  user: { name: 'build' },
}
const secondEvidence = {
  id: 'build-evidence-2',
  createdAt: '2026-10-31T00:05:01Z',
  body: 'Prove It Works: The second thing works.\nopened the page',
  user: { name: 'build' },
}

const config = {
  models: { build: BEAM, memory: BEAM, helper: BEAM, shipping: KIMI },
  effort: 'large',
  evidenceAttempts: 2,
  timeoutMs: 60_000,
  configPath: '/repo/dashboard/config/defaults.json',
}

function verdictFor({ verifier = KIMI, head = 'abc1234', verdict = 'PASS', first = 'PASS', second = 'PASS' } = {}) {
  return {
    juliaShippingVerdict: 1,
    card: 'JUL-901',
    head,
    verdict,
    builder: 'toddwyder',
    verifier,
    criteria: [
      { criterion: 'The first thing works.', verdict: first, note: 'ran the tests' },
      { criterion: 'The second thing works.', verdict: second, note: 'opened the page' },
    ],
  }
}

function writeHandover(runDir, { branch = 'runner/card-901', head = 'abc1234', startedAt = '2026-10-31T00:00:00Z' } = {}) {
  mkdirSync(join(runDir, 'pr'), { recursive: true })
  writeFileSync(join(runDir, 'pr/title.txt'), 'Do the things (JUL-901)\n')
  writeFileSync(join(runDir, 'pr/body.md'), 'What changed.\n\nCard: JUL-901\n')
  writeFileSync(join(runDir, 'build-done.json'), JSON.stringify({ card: 'JUL-901', branch, head, startedAt }))
}

function harness({ shippingAnswer, comments = [firstEvidence, secondEvidence], buildBackAddsEvidence = true, dropCardPosts = 0, keptVerdict = false, startedMarker = false, runId = 'JUL-901-1' } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), 'card-runner-test-'))
  const posted = []
  const pullComments = []
  const published = []
  const adopted = []
  const calls = []
  let evidence = [...comments]
  let cardPostFailures = dropCardPosts

  if (keptVerdict) {
    mkdirSync(join(runDir, 'verdicts'), { recursive: true })
    writeFileSync(verdictPathFor(runDir, runId), JSON.stringify(keptVerdict === true ? verdictFor() : keptVerdict))
  }
  if (startedMarker) {
    mkdirSync(join(runDir, 'verdicts'), { recursive: true })
    writeFileSync(join(runDir, 'verdicts', `${runId}.started.json`), JSON.stringify({ model: KIMI, startedAt: '2026-10-31T00:00:00Z' }))
  }

  const now = (() => {
    let tick = 0
    return () => new Date(Date.UTC(2026, 9, 31, 0, 0, tick++)).toISOString()
  })()

  const deps = {
    now,
    loadCard: async () => ({
      id: 'id-1',
      identifier: 'JUL-901',
      title: 'A scratch card',
      description,
      url: 'https://linear.app/x/issue/JUL-901',
      labels: ['Feature'],
      comments: evidence,
    }),
    prepareRunDir: async ({ runDir: dir }) => ({ appData: join(dir, 'app-data'), settingsPath: join(dir, 'settings.json') }),
    prepareCheckout: async () => ({ branch: 'runner/card-901', checkout: '/checkout' }),
    prepareAdoptedCheckout: async ({ branch, runDir: dir }) => {
      adopted.push({ branch, runDir: dir })
      return { branch, checkout: '/checkout' }
    },
    publishPull: async ({ branch, title, body }) => {
      published.push({ branch, title, body })
      return { number: 12, head: 'abc1234', url: 'https://github.com/x/y/pull/12', builder: 'toddwyder' }
    },
    requirePull: async () => ({ number: 12, head: 'abc1234', url: 'https://github.com/x/y/pull/12', builder: 'toddwyder' }),
    postCardComment: async (identifier, body) => {
      if (cardPostFailures > 0) {
        cardPostFailures -= 1
        throw new TypeError('fetch failed')
      }
      posted.push({ identifier, body })
    },
    postPullComment: async ({ number, body }) => { pullComments.push({ number, body }) },
    runSession: async (options) => {
      calls.push(options)
      if (options.model === BEAM && options.prompt.includes('back before Shipping')) {
        if (buildBackAddsEvidence) evidence = [...evidence, { ...secondEvidence, createdAt: '2026-10-31T00:06:00Z' }]
        return { ok: true, status: 'completed', usage: { inputTokens: 5, outputTokens: 1 }, text: 'built back' }
      }
      if (options.model === BEAM && options.prompt.includes('Write the title to')) {
        writeHandover(runDir)
        return { ok: true, status: 'completed', usage: { inputTokens: 5, outputTokens: 1 }, text: 'built' }
      }
      const path = options.prompt.match(/Write your verdict to this absolute path, and print it too:\n(\S+)/)?.[1]
      if (!path) throw new Error(`no verdict path in prompt:\n${options.prompt}`)
      if (shippingAnswer) writeFileSync(path, JSON.stringify(shippingAnswer))
      return { ok: true, status: 'completed', usage: { inputTokens: 20, outputTokens: 3 }, text: 'done' }
    },
  }

  return {
    deps,
    runDir,
    runId,
    posted,
    pullComments,
    published,
    adopted,
    calls,
    workflow: () => createCardRunWorkflow(deps),
    options: { card: 'JUL-901', repoDir: '/repo', runDir, config },
  }
}

function stepOutput(result, id) {
  return result.steps?.[id]?.output
}

test('one run publishes the build, gates on evidence, and gets exactly one Shipping verdict', async () => {
  const h = harness({ shippingAnswer: verdictFor() })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  // A PASS hands the run to Todd, so the run is suspended until he says yes.
  equal(result.status, 'suspended')
  const record = stepOutput(result, 'record')
  equal(record.verdict.verdict, 'PASS')

  const shippingCalls = h.calls.filter((call) => call.model === KIMI)
  equal(shippingCalls.length, 1)
  deepEqual(h.calls.map((call) => call.model), [BEAM, KIMI])
  deepEqual([...new Set(h.calls.map((call) => call.settingsPath))], [join(h.runDir, 'settings.json')])

  equal(h.published.length, 1)
  equal(h.published[0].title, 'Do the things (JUL-901)')
  check(h.published[0].body.includes('Card: JUL-901'))

  equal(h.posted.length, 1)
  check(h.posted[0].body.startsWith(`## Shipping pass on ${KIMI}`))
  equal(h.pullComments.length, 1)

  // The answer is kept on disk under this run's id, and the run record names it.
  check(existsSync(verdictPathFor(h.runDir, h.runId)))
  const saved = readRunRecord(h.runDir, h.runId)
  equal(saved.ok, true)
  equal(saved.verdict.verdict, 'PASS')
  equal(saved.verdictPath, verdictPathFor(h.runDir, h.runId))
  equal(saved.pull.number, 12)
})

test('a criterion with no evidence sends the build back before Shipping starts', async () => {
  const h = harness({ shippingAnswer: verdictFor(), comments: [firstEvidence] })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'suspended')
  const record = stepOutput(result, 'record')
  equal(record.gateAttempts, 1)
  equal(record.evidenceMissing.length, 0)
  equal(h.calls.filter((call) => call.model === KIMI).length, 1)
  check(h.calls.some((call) => call.prompt.includes('back before Shipping')))
})

test('the run stops without any Shipping review when the evidence never arrives', async () => {
  const h = harness({ shippingAnswer: verdictFor(), comments: [firstEvidence], buildBackAddsEvidence: false })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'failed')
  check(String(result.error?.message ?? result.error).includes('Shipping did not start: no evidence for The second thing works.'))
  equal(h.calls.filter((call) => call.model === KIMI).length, 0)
  equal(h.posted.length, 0)
})

test('a FAIL verdict names the defect and ends the run without a pause', async () => {
  const h = harness({ shippingAnswer: verdictFor({ verdict: 'FAIL', second: 'FAIL' }) })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  const record = stepOutput(result, 'record')
  equal(record.verdict.verdict, 'FAIL')
  equal(result.result.approved, false)
  equal(h.calls.filter((call) => call.model === KIMI).length, 1)
  check(h.posted[0].body.includes('FAIL: The second thing works.'))
})

test('an unusable answer ends the run with its reason and starts no second review', async () => {
  const h = harness({ shippingAnswer: null })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  const record = stepOutput(result, 'record')
  equal(record.verdict, null)
  check(record.verdictError.includes('no verdict'))
  equal(h.calls.filter((call) => call.model === KIMI).length, 1)
  equal(h.posted.length, 1)
  check(h.posted[0].body.includes('Shipping gave no usable verdict'))

  const saved = readRunRecord(h.runDir, h.runId)
  equal(saved.ok, false)
  equal(saved.verdict, null)
})

test('a kept answer is used instead of starting a second review', async () => {
  const h = harness({ keptVerdict: verdictFor() })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'suspended')
  equal(h.calls.filter((call) => call.model === KIMI).length, 0)
  equal(stepOutput(result, 'record').verdict.verdict, 'PASS')
})

test('a run whose review already started and wrote nothing starts no second review', async () => {
  const h = harness({ startedMarker: true })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  equal(h.calls.filter((call) => call.model === KIMI).length, 0)
  check(stepOutput(result, 'record').verdictError.includes('no second review'))
})

test('a verdict for another head is refused, so nothing wrong reaches the gate', async () => {
  const h = harness({ shippingAnswer: verdictFor({ head: 'fffffff' }) })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  const record = stepOutput(result, 'record')
  equal(record.verdict, null)
  check(record.verdictError.includes('head is fffffff'))
  equal(readRunRecord(h.runDir, h.runId).ok, false)
  equal(h.calls.filter((call) => call.model === KIMI).length, 1)
})

test('a dropped connection while posting is retried, so a pass is never lost', async () => {
  const h = harness({ shippingAnswer: verdictFor(), dropCardPosts: 1 })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  equal(h.posted.length, 1)
  equal(h.pullComments.length, 1)
  equal(readRunRecord(h.runDir, h.runId).ok, true)
})

test('a post that never lands keeps the answer and records the failure', async () => {
  const h = harness({ shippingAnswer: verdictFor(), dropCardPosts: 99 })
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({ inputData: h.options })

  const record = stepOutput(result, 'record')
  check(record.postError.includes('fetch failed'))
  const saved = readRunRecord(h.runDir, h.runId)
  equal(saved.ok, false)
  equal(saved.verdict.verdict, 'PASS')
  check(existsSync(saved.verdictPath))
})

test('the run record carries token and cost totals from the dashboard price list', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'card-runner-prices-'))
  mkdirSync(join(stateDir, 'state'), { recursive: true })
  writeFileSync(join(stateDir, 'state', 'models.json'), JSON.stringify({
    models: [
      { id: 'x/Kimi-K3.1-Pro', inputPerMillion: 1, outputPerMillion: 10, free: false },
      { id: 'x/beam:free', inputPerMillion: 0, outputPerMillion: 0, free: true },
    ],
  }))
  const previous = process.env.DASHBOARD_STATE_DIR
  process.env.DASHBOARD_STATE_DIR = stateDir
  try {
    const h = harness({ shippingAnswer: verdictFor() })
    const run = await h.workflow().createRun({ runId: h.runId })
    await run.start({ inputData: h.options })

    const saved = readRunRecord(h.runDir, h.runId)
    // build 5/1 on a free model, Shipping 20/3 on Kimi at $1 in and $10 out.
    equal(saved.tokens.inputTokens, 25)
    equal(saved.tokens.outputTokens, 4)
    equal(saved.costUsd, Number(((20 * 1 + 3 * 10) / 1e6).toFixed(4)))
    equal(saved.costNote, null)
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_STATE_DIR
    else process.env.DASHBOARD_STATE_DIR = previous
  }
})

test('a run whose model has no price keeps its tokens and says why the cost is missing', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'card-runner-prices-'))
  mkdirSync(join(stateDir, 'state'), { recursive: true })
  writeFileSync(join(stateDir, 'state', 'models.json'), JSON.stringify({ models: [] }))
  const previous = process.env.DASHBOARD_STATE_DIR
  process.env.DASHBOARD_STATE_DIR = stateDir
  try {
    const h = harness({ shippingAnswer: verdictFor() })
    const run = await h.workflow().createRun({ runId: h.runId })
    await run.start({ inputData: h.options })

    const saved = readRunRecord(h.runDir, h.runId)
    equal(saved.tokens.inputTokens, 25)
    equal(saved.costUsd, null)
    check(saved.costNote.includes('price catalogue has no row'))
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_STATE_DIR
    else process.env.DASHBOARD_STATE_DIR = previous
  }
})

test('ship-only adopts a branch a build already finished and starts at the handover', async () => {
  const h = harness({ shippingAnswer: verdictFor() })
  writeHandover(h.runDir)
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({
    inputData: { ...h.options, shipOnly: true, branch: 'runner/card-901' },
  })

  equal(result.status, 'suspended')
  equal(h.adopted.length, 1)
  deepEqual(h.calls.map((call) => call.model), [KIMI])
  check(existsSync(runRecordPath(h.runDir, h.runId)))
})

test('ship-only refuses a handover that names another branch', async () => {
  const h = harness({ shippingAnswer: verdictFor() })
  writeHandover(h.runDir)
  const run = await h.workflow().createRun({ runId: h.runId })
  const result = await run.start({
    inputData: { ...h.options, shipOnly: true, branch: 'feat/jul-901-thing' },
  })

  equal(result.status, 'failed')
  check(String(result.error?.message ?? result.error).includes('the build said it was done on runner/card-901'))
  equal(h.calls.length, 0)
})

function check(value) {
  if (!value) throw new Error('expected a truthy value')
}

function equal(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
