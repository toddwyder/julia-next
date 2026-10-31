import { deepEqual } from 'node:assert'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCardRunWorkflow } from '../src/workflow.mjs'

const description = 'Outcome: two things work.\n\nAcceptance criteria:\n- The first thing works.\n- The second thing works.\n'

function fakeCard() {
  return {
    id: 'id-1',
    identifier: 'JUL-901',
    title: 'A scratch card',
    description,
    url: 'https://linear.app/x/issue/JUL-901',
    labels: ['Feature'],
    comments: [
      { id: 'build-evidence', createdAt: '2026-10-31T00:05:00Z', body: 'Prove It Works: The first thing works.\nran npm test', user: { name: 'build' } },
    ],
  }
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

function harness({ freeAnswers, finalAnswer }) {
  const runDir = mkdtempSync(join(tmpdir(), 'card-runner-test-'))
  const posted = []
  const pullComments = []
  const calls = []
  let freeIndex = 0
  const now = (() => {
    let tick = 0
    return () => new Date(Date.UTC(2026, 9, 31, 0, 0, tick++)).toISOString()
  })()

  const deps = {
    now,
    loadCard: async () => fakeCard(),
    prepareRunDir: async ({ runDir: dir }) => ({ appData: join(dir, 'app-data'), settingsPath: join(dir, 'settings.json') }),
    prepareCheckout: async () => ({ branch: 'runner/card-901', checkout: '/checkout' }),
    requirePull: async () => ({ number: 12, head: 'abc1234', url: 'https://github.com/x/y/pull/12', builder: 'toddwyder' }),
    postCardComment: async (identifier, body) => { posted.push({ identifier, body }) },
    postPullComment: async ({ number, body }) => { pullComments.push({ number, body }) },
    runSession: async (options) => {
      calls.push(options)
      if (options.model === 'mastracode/commandcode/reflection/beam:free' && !options.prompt.includes('Write your verdict')) {
        return { ok: true, status: 'completed', usage: { inputTokens: 5, outputTokens: 1 }, text: 'built' }
      }
      const path = options.prompt.match(/Write your verdict to this absolute path, and print it too:\n(\S+)/)?.[1]
      if (!path) throw new Error(`no verdict path in prompt:\n${options.prompt}`)
      if (options.model === 'mastracode/commandcode/stealth/glyph-cluster:free') {
        const answer = freeAnswers[freeIndex++]
        if (answer) writeFileSync(path, JSON.stringify(answer))
        return { ok: true, status: 'completed', usage: { inputTokens: 10, outputTokens: 2 }, text: 'done' }
      }
      if (finalAnswer) writeFileSync(path, JSON.stringify(finalAnswer))
      return { ok: true, status: 'completed', usage: { inputTokens: 20, outputTokens: 3 }, text: 'done' }
    },
  }

  return { deps, runDir, posted, pullComments, calls, options: { card: 'JUL-901', repoDir: '/repo', runDir } }
}

test('the workflow turns a build into a free verdict, then one Kimi verdict, then a card record', async () => {
  const free = verdictFor({ verifier: 'mastracode/commandcode/stealth/glyph-cluster:free' })
  const final = verdictFor({ verifier: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro' })
  const h = harness({ freeAnswers: [null, free], finalAnswer: final })

  const workflow = createCardRunWorkflow(h.deps)
  const run = await workflow.createRun()
  const result = await run.start({ inputData: h.options })

  equal(result.status, 'success')
  equal(result.result.freeVerdict.verdict, 'PASS')
  equal(result.result.freeAttempts, 2)
  equal(result.result.finalVerdict.verdict, 'PASS')

  // One build call, two free attempts, one final pass: Shipping starts by itself.
  deepEqual(h.calls.map((call) => call.model), [
    'mastracode/commandcode/reflection/beam:free',
    'mastracode/commandcode/stealth/glyph-cluster:free',
    'mastracode/commandcode/stealth/glyph-cluster:free',
    'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro',
  ])
  // Memory is pinned to the free model in every session.
  deepEqual([...new Set(h.calls.map((call) => call.settingsPath))], [join(h.runDir, 'settings.json')])

  const bodies = h.posted.map((comment) => comment.body).join('\n')
  check(bodies.includes('Free Shipping pass on mastracode/commandcode/stealth/glyph-cluster:free (attempt 2)'))
  check(bodies.includes('Final Shipping pass on mastracode/commandcode/moonshotai/Kimi-K3.1-Pro'))
  equal(h.pullComments.length, 1)
  check(h.pullComments[0].body.includes('```json\n{"juliaShippingVerdict":1'))
  check(h.pullComments[0].body.includes('"head":"abc1234"'))

  const record = JSON.parse(readFileSync(join(h.runDir, 'run.json'), 'utf8'))
  equal(record.ok, true)
  deepEqual(record.steps.map((step) => step.id), ['build', 'shipping-free-1', 'shipping-free-2', 'shipping-final'])
  check(existsSync(join(h.runDir, 'steps.jsonl')))
  // The evidence the build posted reached Shipping without anyone passing it.
  check(h.calls[1].prompt.includes('Prove It Works: The first thing works.'))
})

test('a free model that never answers still gets exactly one Kimi pass', async () => {
  const final = verdictFor({ verifier: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro' })
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
  equal(h.calls.filter((call) => call.model.includes('glyph-cluster')).length, 3)
  equal(h.calls.filter((call) => call.model.includes('Kimi')).length, 1)
  check(h.posted[0].body.includes('Shipping ran 3 time(s) and produced no valid verdict'))
  equal(h.pullComments.length, 1)
})

test('a final verdict for another head is refused, so nothing wrong reaches the gate', async () => {
  const free = verdictFor({ verifier: 'mastracode/commandcode/stealth/glyph-cluster:free' })
  const final = verdictFor({ verifier: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro', head: 'fffffff' })
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
