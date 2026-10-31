import { deepEqual } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCardRunWorkflow } from '../src/workflow.mjs'

const BEAM = 'mastracode/commandcode/reflection/beam:free'
const GLYPH = 'mastracode/commandcode/stealth/glyph-cluster:free'
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

function verdictFor({ verifier, head = 'abc1234', verdict = 'PASS', first = 'PASS', second = 'PASS' }) {
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

function harness({ freeAnswers, finalAnswer, comments = [firstEvidence, secondEvidence], buildBackAddsEvidence = true }) {
  const runDir = mkdtempSync(join(tmpdir(), 'card-runner-test-'))
  const posted = []
  const pullComments = []
  const published = []
  const adopted = []
  const calls = []
  let evidence = [...comments]
  let freeIndex = 0
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
    postCardComment: async (identifier, body) => { posted.push({ identifier, body }) },
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
      if (options.model === GLYPH) {
        const answer = freeAnswers[freeIndex++]
        if (answer) writeFileSync(path, JSON.stringify(answer))
        return { ok: true, status: 'completed', usage: { inputTokens: 10, outputTokens: 2 }, text: 'done' }
      }
      if (finalAnswer) writeFileSync(path, JSON.stringify(finalAnswer))
      return { ok: true, status: 'completed', usage: { inputTokens: 20, outputTokens: 3 }, text: 'done' }
    },
  }

  return { deps, runDir, posted, pullComments, published, adopted, calls, options: { card: 'JUL-901', repoDir: '/repo', runDir } }
}

test('the runner publishes the build, gates on evidence, then gets one free verdict and one Kimi verdict', async () => {
  const free = verdictFor({ verifier: GLYPH })
  const final = verdictFor({ verifier: KIMI })
  const h = harness({ freeAnswers: [null, free], finalAnswer: final })

  const workflow = createCardRunWorkflow(h.deps)
  const run = await workflow.createRun()
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  equal(result.result.freeVerdict.verdict, 'PASS')
  equal(result.result.freeAttempts, 2)
  equal(result.result.finalVerdict.verdict, 'PASS')
  equal(result.result.evidenceMissing.length, 0)

  // The pull request carries the words the build wrote, and the runner posts them.
  equal(h.published.length, 1)
  equal(h.published[0].title, 'Do the things (JUL-901)')
  check(h.published[0].body.includes('Card: JUL-901'))

  // One build call, no build-back, two free attempts, one final pass.
  deepEqual(h.calls.map((call) => call.model), [BEAM, GLYPH, GLYPH, KIMI])
  deepEqual([...new Set(h.calls.map((call) => call.settingsPath))], [join(h.runDir, 'settings.json')])

  const bodies = h.posted.map((comment) => comment.body).join('\n')
  check(bodies.includes('Free Shipping pass on mastracode/commandcode/stealth/glyph-cluster:free (attempt 2)'))
  check(bodies.includes('Final Shipping pass on mastracode/commandcode/moonshotai/Kimi-K3.1-Pro'))
  equal(h.pullComments.length, 1)
  check(h.pullComments[0].body.includes('```json\n{"juliaShippingVerdict":1'))
  check(h.pullComments[0].body.includes('"head":"abc1234"'))

  const record = JSON.parse(readFileSync(join(h.runDir, 'run.json'), 'utf8'))
  equal(record.ok, true)
  deepEqual(record.steps.map((step) => step.id), ['build', 'publish', 'evidence-gate', 'shipping-free-1', 'shipping-free-2', 'shipping-final'])
  check(existsSync(join(h.runDir, 'steps.jsonl')))
  // Both pieces of evidence reached Shipping without anyone passing them.
  check(h.calls[1].prompt.includes('Prove It Works: The first thing works.'))
  check(h.calls[1].prompt.includes('Prove It Works: The second thing works.'))
})

test('a criterion with no evidence sends the build back before Shipping starts', async () => {
  const free = verdictFor({ verifier: GLYPH })
  const final = verdictFor({ verifier: KIMI })
  const h = harness({ freeAnswers: [free], finalAnswer: final, comments: [firstEvidence] })

  const workflow = createCardRunWorkflow(h.deps)
  const run = await workflow.createRun()
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  equal(result.result.gateAttempts, 1)
  deepEqual(h.calls.map((call) => call.model), [BEAM, BEAM, GLYPH, KIMI])
  // The build-back is told exactly which criterion it owes evidence for.
  check(h.calls[1].prompt.includes('The second thing works.'))
  // The pull request is read again after the build-back, before Shipping judges.
  equal(h.published.length, 1)
})

test('the run stops without Shipping when the evidence never arrives', async () => {
  const final = verdictFor({ verifier: KIMI })
  const h = harness({ freeAnswers: [], finalAnswer: final, comments: [firstEvidence], buildBackAddsEvidence: false })
  h.options.models = { evidenceAttempts: 1 }

  const workflow = createCardRunWorkflow(h.deps)
  const run = await workflow.createRun()
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'failed')
  check(JSON.stringify(result.steps).includes('Shipping did not start: no evidence for The second thing works.'))
  deepEqual(h.calls.map((call) => call.model), [BEAM, BEAM])
  equal(h.pullComments.length, 0)
})

test('ship-only adopts a branch a build already finished and starts at the handover', async () => {
  const free = verdictFor({ verifier: GLYPH })
  const final = verdictFor({ verifier: KIMI })
  const h = harness({ freeAnswers: [free], finalAnswer: final })
  h.options.shipOnly = true
  h.options.branch = 'feat/jul-901-thing'
  writeHandover(h.runDir, { branch: 'feat/jul-901-thing', head: 'abc1234' })

  const workflow = createCardRunWorkflow(h.deps)
  const run = await workflow.createRun()
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  equal(result.result.branch, 'feat/jul-901-thing')
  deepEqual(h.adopted.map((call) => call.branch), ['feat/jul-901-thing'])
  // No build session ran: the branch is kept, not rebuilt.
  deepEqual(h.calls.map((call) => call.model), [GLYPH, KIMI])
  equal(h.published[0].branch, 'feat/jul-901-thing')
  check(h.calls[0].prompt.includes('Prove It Works: The first thing works.'))
})

test('ship-only refuses a handover that names another branch', async () => {
  const h = harness({ freeAnswers: [], finalAnswer: null })
  h.options.shipOnly = true
  h.options.branch = 'feat/jul-901-thing'
  writeHandover(h.runDir, { branch: 'runner/card-901' })

  const workflow = createCardRunWorkflow(h.deps)
  const run = await workflow.createRun()
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'failed')
  equal(h.adopted.length, 0)
})

test('a free model that never answers still gets exactly one Kimi pass', async () => {
  const final = verdictFor({ verifier: KIMI })
  const h = harness({ freeAnswers: [], finalAnswer: final })
  const base = h.deps.runSession
  h.deps.runSession = async (options) => {
    if (options.model.includes('glyph-cluster')) {
      h.calls.push(options)
      return { ok: false, status: 'error', error: 'the session printed no result line' }
    }
    return base(options)
  }
  h.options.models = { freeAttempts: 3 }

  const workflow = createCardRunWorkflow(h.deps)
  const run = await workflow.createRun()
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  equal(result.result.freeAttempts, 3)
  equal(result.result.freeVerdict, null)
  equal(result.result.finalVerdict.verdict, 'PASS')
  equal(h.calls.filter((call) => call.model === KIMI).length, 1)
  check(h.posted[0].body.includes('Shipping ran 3 time(s) and produced no valid verdict'))
  equal(h.pullComments.length, 1)
})

test('a final verdict for another head is refused, so nothing wrong reaches the gate', async () => {
  const free = verdictFor({ verifier: GLYPH })
  const final = verdictFor({ verifier: KIMI, head: 'fffffff' })
  const h = harness({ freeAnswers: [free], finalAnswer: final })

  const workflow = createCardRunWorkflow(h.deps)
  const run = await workflow.createRun()
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  equal(result.result.finalVerdict, null)
  check(result.result.finalError.includes('head is fffffff'))
  equal(h.pullComments.length, 0)
  check(h.posted.at(-1).body.includes('Shipping gave no usable verdict'))
  const record = JSON.parse(readFileSync(join(h.runDir, 'run.json'), 'utf8'))
  equal(record.ok, false)
})

function check(value) {
  if (!value) throw new Error('expected a truthy value')
}

function equal(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
