import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import type { z } from 'zod/v4'

import {
  ControlPageStateSchema,
  InitializationActivitySchema,
  InitializationRunsStateSchema,
  ModelOfferSchema,
  ReadyCardSchema,
  RoleSelectionSchema,
  StartInitializationSchema,
} from '../src/mastra/contracts.ts'
import { listReadyLinearCards } from '../src/mastra/linear.ts'
import { createInitializationRuntime } from '../src/mastra/initialization.ts'
import { createInitializationActivityRecorder, createObservedLinearClient } from '../src/mastra/initialization-observability.ts'
import { shouldOpenControlBrowser } from '../src/mastra/control-server.ts'
import { startControlPageServer } from '../src/mastra/control-page.ts'
import { discoverAcpOffers, discoverCommandCodeOffers } from '../src/mastra/routes.ts'
import { createRoleExecutionWorkflow } from '../src/mastra/workflows/delivery.ts'

const settledBrief = `## Outcome

The control page starts a Ready card and shows its progress.

## Acceptance criteria

- The page lists every Ready card.
- Start begins one build for the chosen card.`

test('Ready card admission accepts the card shape and rejects unresolved decisions', () => {
  const card = { identifier: 'JUL-230', title: 'Initialize Ready cards', state: 'Ready', description: settledBrief }
  assert.deepEqual(ReadyCardSchema.parse(card), card)
  assert.doesNotThrow(() => ReadyCardSchema.parse({ ...card, description: settledBrief.replace('The control page starts a Ready card and shows its progress.', 'Admission rejects unresolved decision markers.') }))
  assert.throws(() => ReadyCardSchema.parse({ ...card, state: 'Backlog' }), /expected Ready state/)
  assert.throws(() => ReadyCardSchema.parse({ ...card, description: `${settledBrief}\n\n## Requirements\n\nDelivery beyond initialization.` }), /retired Requirements section/)
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
  const roles = { orchestrator: selection, coder: selection }
  assert.deepEqual(ControlPageStateSchema.parse({ cards: [{ admitted: true, card }], offers: [offer] }), { cards: [{ admitted: true, card }], offers: [offer] })
  assert.deepEqual(StartInitializationSchema.parse({ card, roles }), { card, roles })
  assert.throws(() => RoleSelectionSchema.parse({ ...selection, effort: 'unbounded' }))
  assert.throws(() => ModelOfferSchema.parse({ ...offer, supportedEfforts: [] }))
})

test('initialization observability counts actual boundary activity instead of asserting zeroes', () => {
  const events: unknown[] = []
  const activity = createInitializationActivityRecorder(event => { events.push(event) })
  activity.recordLinearQuery()
  activity.recordLinearMutation()
  activity.recordLlmInference()
  activity.recordRoleDispatch('builder')
  activity.recordRoleDispatch('reviewer')
  activity.recordRoleDispatch('crashFixer')
  activity.recordRoleDispatch('crashReviewer')

  assert.deepEqual(activity.snapshot(), InitializationActivitySchema.parse({
    roleDispatches: { builder: 1, reviewer: 1, crashFixer: 1, crashReviewer: 1 },
    llmInferenceCalls: 1,
    linearQueries: 1,
    linearMutations: 1,
  }))
  assert.equal(events.length, 7)
})

test('the observed Linear capability measures queries and mutations at the request seam', async () => {
  const activity = createInitializationActivityRecorder()
  const requests: string[] = []
  const client = createObservedLinearClient('linear-reference', activity, async (_input, init) => {
    requests.push(String(init?.body))
    return new Response('{}')
  })

  await client.query('query Read { viewer { id } }', {})
  await client.mutate('mutation Write { commentCreate { success } }', {})

  assert.equal(requests.length, 2)
  assert.equal(activity.snapshot().linearQueries, 1)
  assert.equal(activity.snapshot().linearMutations, 1)
})

test('the proof launcher can suppress the uncontrolled desktop browser without changing ordinary launches', () => {
  assert.equal(shouldOpenControlBrowser({}), true)
  assert.equal(shouldOpenControlBrowser({ JULIA_CONTROL_OPEN_BROWSER: '0' }), false)
})

test('the production role workflow records each dispatch and inference at its actual seam', async () => {
  const activity = createInitializationActivityRecorder()
  const route = { setModel: async () => {}, generate: async () => ({ text: 'done', finishReason: 'stop' }) }
  const claudeOptions = [{ value: 'claude-sonnet-4-6', name: 'Sonnet 4.6' }]
  const claudeRoute = {
    ...route,
    getAvailableModels: async () => [],
    connection: {
      session: { sessionId: 'observability', configOptions: [{ id: 'model', currentValue: 'claude-sonnet-4-6', options: claudeOptions }] },
      connection: { setSessionConfigOption: async () => ({ configOptions: [{ id: 'model', currentValue: 'claude-sonnet-4-6', options: claudeOptions }] }) },
    },
  }
  const workflow = createRoleExecutionWorkflow({
    routes: { antigravity: route, claude: claudeRoute } as never,
    activity,
  })
  const run = await workflow.createRun()
  const result = await run.start({ inputData: {
    decision: 'Start', authorized: true,
    snapshot: { issueId: 'JUL-230', allowSameService: false, savedAt: new Date().toISOString(), roles: {
      builder: { route: 'antigravity', modelId: 'builder', company: 'Google', service: 'Antigravity' },
      reviewer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
      crashFixer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
      fixReviewer: { route: 'antigravity', modelId: 'crash-reviewer', company: 'Google', service: 'Antigravity' },
    } },
  } })
  assert.equal(result.status, 'success')
  assert.deepEqual(activity.snapshot(), {
    roleDispatches: { builder: 1, reviewer: 1, crashFixer: 1, crashReviewer: 1 },
    llmInferenceCalls: 4,
    linearQueries: 0,
    linearMutations: 0,
  })
})

test('Linear Ready-card discovery paginates every complete card with read-only queries', async () => {
  const requests: Array<{ document: string; variables: Record<string, unknown> }> = []
  const traces: unknown[] = []
  let page = 0
  const cards = await listReadyLinearCards({ query: async (document, variables) => {
    requests.push({ document, variables })
    page += 1
    const identifier = page === 1 ? 'JUL-230' : 'JUL-231'
    return new Response(JSON.stringify({ data: { issues: {
      nodes: [{ identifier, title: 'Initialize Ready cards', description: settledBrief, state: { name: 'Ready' } }],
      pageInfo: { hasNextPage: page === 1, endCursor: page === 1 ? 'cursor-1' : null },
    } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  } }, trace => { traces.push(trace) })
  assert.deepEqual(cards.map(entry => entry.card.identifier), ['JUL-230', 'JUL-231'])
  assert.equal(requests.length, 2)
  assert.equal(requests[0]!.variables.after, null)
  assert.equal(requests[1]!.variables.after, 'cursor-1')
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

test('CommandCode discovery rejects a malformed success payload instead of tracing an unknown count as zero', async () => {
  const traces: Array<{ route: string; ok: boolean; status?: number; offerCount?: number }> = []
  await assert.rejects(
    discoverCommandCodeOffers('secret', async () => Response.json({ unexpected: [] }), trace => { traces.push(trace) }),
    /invalid/i,
  )
  assert.deepEqual(traces, [{
    event: 'model-discovery', route: 'commandcode', operation: 'models/list', ok: false, status: 200,
    durationMs: (traces[0] as { durationMs: number } | undefined)?.durationMs,
    error: (traces[0] as { error: string } | undefined)?.error,
  }])
  assert.equal(traces[0]?.offerCount, undefined)
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
    orchestrator: { route: 'antigravity', modelId: 'gemini-pro', company: 'Google', service: 'Antigravity', effort: 'high' },
    coder: { route: 'commandcode', modelId: 'deepseek-v3', company: 'DeepSeek', service: 'CommandCode', wire: 'chat', effort: 'medium' },
  } })

  const firstRuntime = await createInitializationRuntime({ storagePath, activity: createInitializationActivityRecorder() })
  const state = { cards: [{ admitted: true, card }], offers }
  await assert.rejects(firstRuntime.start({ ...input, card: { ...card, title: 'Forged title' } }, state), /differs from the current admitted card/)
  const first = await firstRuntime.start(input, state)
  assert.equal(first.state, 'ready-for-build')
  assert.equal(first.resumed, false)
  assert.deepEqual(first.snapshot.card, card)
  assert.deepEqual(first.snapshot.roles, input.roles)
  assert.equal(await firstRuntime.runCount(), 1)
  await firstRuntime.close()

  const restartedRuntime = await createInitializationRuntime({ storagePath, activity: createInitializationActivityRecorder() })
  assert.deepEqual(await restartedRuntime.list(), InitializationRunsStateSchema.parse({
    runs: [{ ...first, resumed: true }],
    totalRuns: 1,
  }))
  await restartedRuntime.close()
})

test('Cancel closes the browser form locally without another server request', async t => {
  const card = ReadyCardSchema.parse({ identifier: 'JUL-230', title: 'Initialize Ready cards', state: 'Ready', description: settledBrief })
  const offer = ModelOfferSchema.parse({
    route: 'antigravity', modelId: 'gemini-pro', name: 'Gemini Pro', company: 'Google', service: 'Antigravity',
    codingCapable: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  })
  const requests: Array<{ method: string; path: string }> = []
  const persisted = InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 })
  const activity = InitializationActivitySchema.parse({
    roleDispatches: { builder: 0, reviewer: 0, crashFixer: 0, crashReviewer: 0 },
    llmInferenceCalls: 0,
    linearQueries: 2,
    linearMutations: 0,
  })
  const server = await startControlPageServer({
    port: 0,
    getState: async () => ({ cards: [{ admitted: true, card }], offers: [offer] }),
    startInitialization: async () => { throw new Error('Start must not run for Cancel') },
    getRuns: async () => persisted,
    getActivity: () => activity,
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
  const before = await (await fetch(`${server.url}/api/runs`)).json()
  const beforeCancel = requests.length
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByText('Initialization closed. Nothing was sent or saved.').waitFor()
  assert.equal(requests.length, beforeCancel)
  const after = await (await fetch(`${server.url}/api/runs`)).json()
  assert.deepEqual(after, before)
  assert.deepEqual(after, { ...persisted, activity })
  assert.equal(await page.locator('form').count(), 0)
  assert.deepEqual(consoleErrors, [])
})

test('the control boundary rejects a non-loopback Host header', async t => {
  const server = await startControlPageServer({
    port: 0,
    getState: async () => ({ cards: [], offers: [] }),
    startInitialization: async () => { throw new Error('must not start') },
    getRuns: async () => InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 }),
    getActivity: () => createInitializationActivityRecorder().snapshot(),
  })
  t.after(() => server.close())
  const result = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = request(`${server.url}/api/runs`, { headers: { Host: 'example.com' } }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(result.status, 403)
  assert.deepEqual(JSON.parse(result.body), { error: "Host must be loopback or this server's Tailscale Serve name" })
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
    getState: async () => ({ cards: [{ admitted: true, card }], offers }),
    startInitialization: async input => {
      received = input
      const snapshot = { runId: 'run-browser', card: input.card, roles: input.roles, state: 'ready-for-build' as const, initializedAt: '2026-10-16T00:00:00.000Z' }
      return { runId: snapshot.runId, state: snapshot.state, snapshot, resumed: false }
    },
    getRuns: async () => InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 }),
    getActivity: () => InitializationActivitySchema.parse({
      roleDispatches: { builder: 0, reviewer: 0, crashFixer: 0, crashReviewer: 0 },
      llmInferenceCalls: 0,
      linearQueries: 0,
      linearMutations: 0,
    }),
  })
  t.after(() => server.close())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(server.url)
  await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
  const choices = [
    ['Orchestrator', 'antigravity::gemini-pro', 'high'],
    ['Coder', 'commandcode::deepseek-v3', 'low'],
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
  ])
})
