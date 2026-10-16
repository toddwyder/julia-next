import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import type { z } from 'zod/v4'

import {
  ControlPageStateSchema,
  ModelOfferSchema,
  ReadyCardSchema,
  RoleSelectionSchema,
  StartInitializationSchema,
} from '../src/mastra/contracts.ts'
import { listReadyLinearCards } from '../src/mastra/linear.ts'
import { createInitializationRuntime } from '../src/mastra/initialization.ts'
import { startControlPageServer } from '../src/mastra/control-page.ts'
import { discoverAcpOffers, discoverCommandCodeOffers } from '../src/mastra/routes.ts'

const settledBrief = `## Agent Brief

**Category:** enhancement

**Summary:** Initialize a Ready card.

**Current behavior:** Initialization requires a terminal.

**Desired behavior:** Initialization starts from a local control page.

**Key interfaces:** ReadyCardSchema.

**Acceptance criteria:**

- The card is accepted.

**Out of scope:** Delivery beyond initialization.`

test('Ready card admission accepts the authoritative Agent Brief and rejects unresolved decisions', () => {
  const card = { identifier: 'JUL-230', title: 'Initialize Ready cards', state: 'Ready', description: settledBrief }
  assert.deepEqual(ReadyCardSchema.parse(card), card)
  assert.doesNotThrow(() => ReadyCardSchema.parse({ ...card, description: settledBrief.replace('Initialization requires a terminal.', 'Admission rejects unresolved decision markers.') }))
  assert.throws(() => ReadyCardSchema.parse({ ...card, state: 'Backlog' }), /expected Ready state/)
  assert.throws(() => ReadyCardSchema.parse({ ...card, description: settledBrief.replace('**Summary:** Initialize a Ready card.', '**Summary:**') }), /nonempty Summary field/)
  assert.throws(() => ReadyCardSchema.parse({ ...card, description: `${settledBrief}\n\nTODO: choose a route` }), /unresolved decision marker/)
})

test('control-page contracts carry complete offers and exact route-supported role selections', () => {
  const card = ReadyCardSchema.parse({ identifier: 'JUL-230', title: 'Initialize Ready cards', state: 'Ready', description: settledBrief })
  const offer = ModelOfferSchema.parse({
    route: 'antigravity', modelId: 'gemini-pro', name: 'Gemini Pro', company: 'Google', service: 'Antigravity',
    codingCapable: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  })
  const selection = RoleSelectionSchema.parse({
    route: offer.route, modelId: offer.modelId, company: offer.company, service: offer.service, effort: 'xhigh',
  })
  const roles = { builder: selection, reviewer: selection, crashFixer: selection, crashReviewer: selection }
  assert.deepEqual(ControlPageStateSchema.parse({ cards: [card], offers: [offer] }), { cards: [card], offers: [offer] })
  assert.deepEqual(StartInitializationSchema.parse({ card, roles }), { card, roles })
  assert.throws(() => RoleSelectionSchema.parse({ ...selection, effort: 'unbounded' }))
  assert.throws(() => ModelOfferSchema.parse({ ...offer, supportedEfforts: [] }))
})

test('Linear Ready-card discovery paginates every complete card with read-only queries', async () => {
  const requestBodies: string[] = []
  const traces: unknown[] = []
  let page = 0
  const cards = await listReadyLinearCards('linear-reference', async (_input, init) => {
    requestBodies.push(String(init?.body))
    page += 1
    const identifier = page === 1 ? 'JUL-230' : 'JUL-231'
    return new Response(JSON.stringify({ data: { issues: {
      nodes: [{ identifier, title: 'Initialize Ready cards', description: settledBrief, state: { name: 'Ready' } }],
      pageInfo: { hasNextPage: page === 1, endCursor: page === 1 ? 'cursor-1' : null },
    } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }, trace => { traces.push(trace) })
  assert.deepEqual(cards.map(card => card.identifier), ['JUL-230', 'JUL-231'])
  assert.equal(requestBodies.length, 2)
  assert.match(requestBodies[0]!, /issues\(.*Ready/)
  assert.doesNotMatch(requestBodies.join('\n'), /mutation/i)
  assert.equal((JSON.parse(requestBodies[1]!) as { variables: { after: string } }).variables.after, 'cursor-1')
  assert.deepEqual(traces.map(trace => (trace as { operation: string; ok: boolean }).operation), ['linear-ready-list'])
  assert.deepEqual(traces.map(trace => (trace as { operation: string; ok: boolean }).ok), [true])
  assert.equal((traces[0] as { cardCount: number }).cardCount, 2)
})

test('model discovery records a sanitized success or failure trace for every service connection', async () => {
  const traces: Array<{ route: string; ok: boolean; operation: string; error?: string }> = []
  const routes = {
    antigravity: { getAvailableModels: async () => [{ modelId: 'gemini-pro', name: 'Gemini Pro' }] },
    claude: {
      getAvailableModels: async () => [],
      connection: { session: { sessionId: 'session', configOptions: [{ id: 'model', options: [] }] } },
    },
  }
  await discoverAcpOffers(routes as never, trace => { traces.push(trace) })
  await assert.rejects(
    discoverCommandCodeOffers('secret', async () => new Response('denied', { status: 503 }), trace => { traces.push(trace) }),
    /HTTP 503/,
  )
  assert.deepEqual(traces.filter(trace => trace.operation === 'models/list').map(({ route, ok }) => ({ route, ok })), [
    { route: 'antigravity', ok: true },
    { route: 'claude', ok: true },
    { route: 'commandcode', ok: false },
  ])
  assert.doesNotMatch(traces.find(trace => trace.route === 'commandcode')?.error ?? '', /secret/)
})

test('Start creates one restart-surviving suspended run and returns it for the same confirmed input', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul-230-initialization-'))
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
  const storagePath = join(directory, 'initialization.db')
  const card = ReadyCardSchema.parse({ identifier: 'JUL-230', title: 'Initialize Ready cards', state: 'Ready', description: settledBrief })
  const offers = [
    { route: 'antigravity', modelId: 'gemini-pro', name: 'Gemini Pro', company: 'Google', service: 'Antigravity', codingCapable: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { route: 'commandcode', modelId: 'deepseek-v3', name: 'DeepSeek V3', company: 'DeepSeek', service: 'CommandCode', codingCapable: true, wire: 'chat', supportedEfforts: ['low', 'medium', 'high'] },
    { route: 'claude', modelId: 'claude-sonnet-4-6', name: 'Sonnet 4.6', company: 'Anthropic', service: 'Claude', codingCapable: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  ].map(offer => ModelOfferSchema.parse(offer))
  const input = StartInitializationSchema.parse({ card, roles: {
    builder: { route: 'antigravity', modelId: 'gemini-pro', company: 'Google', service: 'Antigravity', effort: 'high' },
    reviewer: { route: 'commandcode', modelId: 'deepseek-v3', company: 'DeepSeek', service: 'CommandCode', wire: 'chat', effort: 'medium' },
    crashFixer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude', effort: 'low' },
    crashReviewer: { route: 'antigravity', modelId: 'gemini-pro', company: 'Google', service: 'Antigravity', effort: 'xhigh' },
  } })

  const firstRuntime = await createInitializationRuntime({ storagePath })
  const state = { cards: [card], offers }
  await assert.rejects(firstRuntime.start({ ...input, card: { ...card, title: 'Forged title' } }, state), /differs from the current admitted card/)
  const first = await firstRuntime.start(input, state)
  assert.equal(first.state, 'ready-for-build')
  assert.equal(first.resumed, false)
  assert.deepEqual(first.snapshot.card, card)
  assert.deepEqual(first.snapshot.roles, input.roles)
  assert.equal(await firstRuntime.runCount(), 1)
  await firstRuntime.close()

  const restartedRuntime = await createInitializationRuntime({ storagePath })
  const repeated = await restartedRuntime.start(input, state)
  assert.equal(repeated.runId, first.runId)
  assert.equal(repeated.resumed, true)
  assert.deepEqual(repeated.snapshot, first.snapshot)
  assert.equal(await restartedRuntime.runCount(), 1)
  assert.deepEqual(await restartedRuntime.read(first.runId), { ...first, resumed: true })
  await restartedRuntime.close()
})

test('Cancel closes the browser form locally without another server request', async t => {
  const card = ReadyCardSchema.parse({ identifier: 'JUL-230', title: 'Initialize Ready cards', state: 'Ready', description: settledBrief })
  const offer = ModelOfferSchema.parse({
    route: 'antigravity', modelId: 'gemini-pro', name: 'Gemini Pro', company: 'Google', service: 'Antigravity',
    codingCapable: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  })
  const requests: Array<{ method: string; path: string }> = []
  const server = await startControlPageServer({
    port: 0,
    getState: async () => ({ cards: [card], offers: [offer] }),
    startInitialization: async () => { throw new Error('Start must not run for Cancel') },
    onRequest: request => { requests.push(request) },
  })
  t.after(() => server.close())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const consoleErrors: string[] = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.goto(server.url)
  await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
  const beforeCancel = requests.length
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByText('Initialization closed. Nothing was sent or saved.').waitFor()
  assert.equal(requests.length, beforeCancel)
  assert.equal(await page.locator('form').count(), 0)
  assert.deepEqual(consoleErrors, [])
})

test('browser Start sends the exact changed card and four selections through the local boundary', async t => {
  const card = ReadyCardSchema.parse({ identifier: 'JUL-230', title: 'Initialize Ready cards', state: 'Ready', description: settledBrief })
  const offers = [
    { route: 'antigravity', modelId: 'gemini-pro', name: 'Gemini Pro', company: 'Google', service: 'Antigravity', codingCapable: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { route: 'commandcode', modelId: 'deepseek-v3', name: 'DeepSeek V3', company: 'DeepSeek', service: 'CommandCode', codingCapable: true, wire: 'chat', supportedEfforts: ['low', 'medium', 'high'] },
    { route: 'claude', modelId: 'claude-sonnet-4-6', name: 'Sonnet 4.6', company: 'Anthropic', service: 'Claude', codingCapable: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  ].map(offer => ModelOfferSchema.parse(offer))
  let received: z.infer<typeof StartInitializationSchema> | undefined
  const server = await startControlPageServer({
    port: 0,
    getState: async () => ({ cards: [card], offers }),
    startInitialization: async input => {
      received = input
      const snapshot = { runId: 'run-browser', card: input.card, roles: input.roles, state: 'ready-for-build' as const, initializedAt: '2026-10-16T00:00:00.000Z' }
      return { runId: snapshot.runId, state: snapshot.state, snapshot, resumed: false }
    },
  })
  t.after(() => server.close())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(server.url)
  await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
  const choices = [
    ['Builder', 'antigravity::gemini-pro', 'high'],
    ['Reviewer', 'commandcode::deepseek-v3', 'low'],
    ['Crash fixer', 'claude::claude-sonnet-4-6', 'xhigh'],
    ['Crash reviewer', 'antigravity::gemini-pro', 'max'],
  ] as const
  for (const [role, model, effort] of choices) {
    const field = page.getByRole('group', { name: role, exact: true })
    await field.getByLabel('Route and model').selectOption(model)
    await field.getByLabel('Effort').selectOption(effort)
  }
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByText('Ready for build').waitFor()
  assert.equal(received?.card.identifier, 'JUL-230')
  assert.deepEqual(Object.values(received!.roles).map(selection => [selection.route, selection.modelId, selection.effort]), [
    ['antigravity', 'gemini-pro', 'high'],
    ['commandcode', 'deepseek-v3', 'low'],
    ['claude', 'claude-sonnet-4-6', 'xhigh'],
    ['antigravity', 'gemini-pro', 'max'],
  ])
})
