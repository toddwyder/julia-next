import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'
import { chromium } from 'playwright'

import { InitializationRunsStateSchema, ModelOfferSchema, ReadyCardSchema } from '../src/mastra/contracts.ts'
import { createInitializationActivityRecorder } from '../src/mastra/initialization-observability.ts'
import { ensureDistinctReviewer, validateInitializationRequest } from '../src/mastra/initialization.ts'
import { admitReadyCards } from '../src/mastra/linear.ts'
import { isAllowedControlHost, startControlPageServer } from '../src/mastra/control-page.ts'
import { discoverAcpOffers } from '../src/mastra/routes.ts'

const TAILSCALE_HOST = 'ovh.tailnet-1234.ts.net'

function startServer(tailscaleHosts: string[]) {
  return startControlPageServer({
    port: 0,
    tailscaleHosts,
    getState: async () => ({ cards: [], offers: [] }),
    startInitialization: async () => { throw new Error('must not start') },
    getRuns: async () => InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 }),
    getActivity: () => createInitializationActivityRecorder().snapshot(),
  })
}

function getWithHost(url: string, host: string) {
  return new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = request(`${url}/api/runs`, { headers: { Host: host } }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('the control boundary accepts this server’s Tailscale Serve name and refuses every other host', async t => {
  const server = await startServer([TAILSCALE_HOST])
  t.after(() => server.close())

  assert.equal((await getWithHost(server.url, TAILSCALE_HOST)).status, 200)
  assert.equal((await getWithHost(server.url, `${TAILSCALE_HOST}:443`)).status, 200)
  assert.equal((await getWithHost(server.url, TAILSCALE_HOST.toUpperCase())).status, 200)
  assert.equal((await getWithHost(server.url, 'laptop.tailnet-1234.ts.net')).status, 403)
  assert.equal((await getWithHost(server.url, 'ovh.other-tailnet.ts.net')).status, 403)
  assert.equal((await getWithHost(server.url, 'example.com')).status, 403)
  assert.equal((await getWithHost(server.url, `127.0.0.1.example.com`)).status, 403)
})

test('the control boundary refuses the Tailscale name when the server is not configured with it', async t => {
  const unconfigured = await startServer([])
  t.after(() => unconfigured.close())
  assert.equal((await getWithHost(unconfigured.url, TAILSCALE_HOST)).status, 403)
  assert.equal((await getWithHost(unconfigured.url, '127.0.0.1:43123')).status, 200)
})

test('host matching keeps loopback and the configured Tailscale name, and refuses the rest', () => {
  assert.equal(isAllowedControlHost('127.0.0.1:43123', []), true)
  assert.equal(isAllowedControlHost('localhost:43123', []), true)
  assert.equal(isAllowedControlHost('', []), false)
  assert.equal(isAllowedControlHost('example.com', []), false)
  assert.equal(isAllowedControlHost('127.0.0.1.example.com', []), false)

  const configured = [TAILSCALE_HOST]
  assert.equal(isAllowedControlHost(TAILSCALE_HOST, configured), true)
  assert.equal(isAllowedControlHost(`${TAILSCALE_HOST}:443`, configured), true)
  assert.equal(isAllowedControlHost(`  ${TAILSCALE_HOST.toUpperCase()}  `, configured), true)
  assert.equal(isAllowedControlHost('ovh.other-tailnet.ts.net', configured), false)
  assert.equal(isAllowedControlHost('sub.ovh.tailnet-1234.ts.net', configured), false)
  assert.equal(isAllowedControlHost(`${TAILSCALE_HOST}.example.com`, configured), false)
})

function claudeRoute() {
  return {
    getAvailableModels: async () => [],
    connection: { session: { sessionId: 'session', configOptions: [{ id: 'model', options: [] }] } },
  }
}

test('an ACP route whose agent is not installed on this host contributes no offers', async () => {
  const traces: Array<{ route: string; ok: boolean }> = []
  const notInstalled = Object.assign(new Error('spawn agy_acp_server ENOENT'), { code: 'ENOENT' })
  const offers = await discoverAcpOffers(
    { antigravity: { getAvailableModels: async () => { throw notInstalled } }, claude: claudeRoute() } as never,
    trace => { traces.push(trace as never) },
  )
  assert.deepEqual(offers, [])
  assert.deepEqual(traces.map(({ route, ok }) => ({ route, ok })), [{ route: 'antigravity', ok: false }, { route: 'claude', ok: true }])
})

test('a genuine ACP failure still fails discovery rather than being silently dropped', async () => {
  await assert.rejects(discoverAcpOffers(
    { antigravity: { getAvailableModels: async () => { throw new Error('agent crashed') } }, claude: claudeRoute() } as never,
    () => {},
  ), /agent crashed/)
  await assert.rejects(discoverAcpOffers(
    { antigravity: { getAvailableModels: async () => { throw new Error('agent reported ENOENT for its config') } }, claude: claudeRoute() } as never,
    () => {},
  ), /agent reported ENOENT/)
})

const settledBrief = `## Outcome

The control page shows a settled Ready card.

## Acceptance criteria

- The page lists the card.
- Start begins its build.`

test('a Ready card that fails admission is reported as not startable without breaking the list', () => {
  const malformed = {
    identifier: 'JUL-242', title: 'Card 1: Server setup', state: { name: 'Ready' },
    description: '## Requirements\n\nDo it.\n\n## Acceptance\n\nIt works.\n\n## Delivery path\n\nLight: setup only.',
  }
  const settled = { identifier: 'JUL-238', title: 'A settled card', description: settledBrief, state: { name: 'Ready' } }

  const [first, second] = admitReadyCards([malformed, settled])
  assert.deepEqual(first, {
    admitted: false,
    card: {
      identifier: 'JUL-242', title: 'Card 1: Server setup', state: 'Ready',
      reason: 'Cannot start: the Requirements section is retired; missing the Outcome section; missing the Acceptance criteria section',
    },
  })
  assert.equal(second.admitted, true)
  assert.equal(second.card.identifier, 'JUL-238')
})

test('Start stays blocked for a card that failed admission', () => {
  const card = ReadyCardSchema.parse({ identifier: 'JUL-242', title: 'Card 1: Server setup', state: 'Ready', description: settledBrief })
  const offer = { route: 'commandcode', modelId: 'vendor/one', name: 'Vendor One', company: 'Vendor', service: 'CommandCode', wire: 'chat', codingCapable: true, supportedEfforts: ['low', 'medium', 'high'] }
  const other = { ...offer, modelId: 'other/two', name: 'Other Two', company: 'Other' }
  const third = { ...offer, modelId: 'third/three', name: 'Third Three', company: 'Third' }
  const selection = pick => ({ route: pick.route, modelId: pick.modelId, company: pick.company, service: pick.service, wire: pick.wire, effort: 'medium' })
  const roles = { orchestrator: selection(offer), coder: selection(other), reviewer: selection(third) }
  const state = {
    cards: [{ admitted: false, card: { identifier: 'JUL-242', title: 'Card 1: Server setup', state: 'Ready', reason: 'Cannot start: missing the Acceptance criteria section' } }],
    offers: [offer, other, third],
  }
  assert.throws(() => validateInitializationRequest({ card, roles }, state as never), /JUL-242 cannot start/)
})

test('the reviewer must come from a different company than the orchestrator and the coder', () => {
  const offer = { route: 'commandcode', modelId: 'vendor/one', name: 'Vendor One', company: 'Vendor', service: 'CommandCode', wire: 'chat', codingCapable: true, supportedEfforts: ['low', 'medium', 'high'] }
  const other = { ...offer, modelId: 'other/two', name: 'Other Two', company: 'Other' }
  const third = { ...offer, modelId: 'third/three', name: 'Third Three', company: 'Third' }
  const selection = pick => ({ route: pick.route, modelId: pick.modelId, company: pick.company, service: pick.service, wire: pick.wire, effort: 'medium' })
  const roles = { orchestrator: selection(offer), coder: selection(other), reviewer: selection(third) }
  const card = ReadyCardSchema.parse({ identifier: 'JUL-242', title: 'Card 1: Server setup', state: 'Ready', description: settledBrief })
  const state = { cards: [{ admitted: true, card }], offers: [offer, other, third] }
  assert.equal(validateInitializationRequest({ card, roles }, state as never).roles.reviewer.company, 'Third')
  assert.throws(() => validateInitializationRequest({ card, roles: { ...roles, reviewer: selection(offer) } }, state as never), /different company than the orchestrator/)
  assert.throws(() => validateInitializationRequest({ card, roles: { ...roles, reviewer: selection(other) } }, state as never), /different company than the coder/)
  assert.throws(() => ensureDistinctReviewer({ orchestrator: roles.orchestrator, coder: roles.coder } as never), /reviewer selection is required/)
})

test('the Start form remembers the last model choices for all three roles', async t => {
  const first = ModelOfferSchema.parse({
    route: 'commandcode', modelId: 'vendor/one', name: 'Vendor One', company: 'Vendor', service: 'CommandCode',
    codingCapable: true, wire: 'chat', supportedEfforts: ['low', 'medium', 'high'],
  })
  const second = ModelOfferSchema.parse({
    route: 'claude', modelId: 'claude-opus-5-5', name: 'Claude Opus 5.5', company: 'Anthropic', service: 'Claude subscription',
    codingCapable: true, wire: 'messages', supportedEfforts: ['low', 'medium', 'high', 'max'],
  })
  const third = ModelOfferSchema.parse({
    route: 'openai-codex', modelId: 'gpt-6-sol', name: 'GPT-6 Sol', company: 'OpenAI', service: 'ChatGPT plan',
    codingCapable: true, wire: 'responses', supportedEfforts: ['low', 'medium', 'high'],
  })
  const server = await startControlPageServer({
    port: 0,
    getState: async () => ({
      cards: [{ admitted: true, card: ReadyCardSchema.parse({ identifier: 'JUL-238', title: 'A settled card', state: 'Ready', description: settledBrief }) }],
      offers: [first, second, third],
    }),
    startInitialization: async () => { throw new Error('must not start') },
    getRuns: async () => InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 }),
    getActivity: () => createInitializationActivityRecorder().snapshot(),
  })
  t.after(() => server.close())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('julia-control-model-choices', JSON.stringify({
      orchestrator: { key: 'claude::claude-opus-5-5', effort: 'max' },
      coder: { key: 'commandcode::vendor/one', effort: 'high' },
      reviewer: { key: 'openai-codex::gpt-6-sol', effort: 'high' },
    }))
  })
  await page.goto(server.url)
  await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
  const models = page.getByLabel('Route and model')
  const efforts = page.getByLabel('Effort')
  assert.equal(await models.count(), 3)
  assert.equal(await models.nth(0).inputValue(), 'claude::claude-opus-5-5')
  assert.equal(await efforts.nth(0).inputValue(), 'max')
  assert.equal(await models.nth(1).inputValue(), 'commandcode::vendor/one')
  assert.equal(await efforts.nth(1).inputValue(), 'high')
  assert.equal(await models.nth(2).inputValue(), 'openai-codex::gpt-6-sol')
  assert.equal(await efforts.nth(2).inputValue(), 'high')

  await models.nth(1).selectOption('claude::claude-opus-5-5')
  await efforts.nth(1).selectOption('medium')
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('julia-control-model-choices')!))
  assert.deepEqual(stored.coder, { key: 'claude::claude-opus-5-5', effort: 'medium' })
  assert.deepEqual(stored.orchestrator, { key: 'claude::claude-opus-5-5', effort: 'max' })
  assert.deepEqual(stored.reviewer, { key: 'openai-codex::gpt-6-sol', effort: 'high' })
})

test('the page lists every Ready card and blocks Start for one that cannot start', async t => {
  const offer = ModelOfferSchema.parse({
    route: 'commandcode', modelId: 'vendor/one', name: 'Vendor One', company: 'Vendor', service: 'CommandCode',
    codingCapable: true, wire: 'chat', supportedEfforts: ['low', 'medium', 'high'],
  })
  const other = ModelOfferSchema.parse({
    route: 'claude', modelId: 'claude-opus-5-5', name: 'Claude Opus 5.5', company: 'Anthropic', service: 'Claude subscription',
    codingCapable: true, wire: 'messages', supportedEfforts: ['low', 'medium', 'high', 'max'],
  })
  const admitted = ReadyCardSchema.parse({ identifier: 'JUL-238', title: 'A settled card', state: 'Ready', description: settledBrief })
  const server = await startControlPageServer({
    port: 0,
    getState: async () => ({
      cards: [
        { admitted: false, card: { identifier: 'JUL-242', title: 'Card 1: Server setup', state: 'Ready', reason: 'Cannot start: missing the Acceptance criteria section' } },
        { admitted: true, card: admitted },
      ],
      offers: [offer, other],
    }),
    startInitialization: async () => { throw new Error('Start must not run for a card that cannot start') },
    getRuns: async () => InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 }),
    getActivity: () => createInitializationActivityRecorder().snapshot(),
  })
  t.after(() => server.close())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const browserErrors: string[] = []
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  page.on('pageerror', error => { browserErrors.push(error.message) })
  await page.goto(server.url)
  await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()

  await page.getByLabel('Route and model').nth(2).selectOption('claude::claude-opus-5-5')
  const cardSelect = page.getByLabel('Ready card')
  assert.deepEqual(await cardSelect.locator('option').allTextContents(), [
    'JUL-242 — Card 1: Server setup (cannot start)',
    'JUL-238 — A settled card',
  ])
  await cardSelect.selectOption('0')
  assert.equal(await page.getByRole('button', { name: 'Start' }).isDisabled(), true)
  assert.match(await page.locator('p.status').first().innerText(), /Cannot start: missing the Acceptance criteria section/)
  await cardSelect.selectOption('1')
  assert.equal(await page.getByRole('button', { name: 'Start' }).isDisabled(), false)
  assert.deepEqual(browserErrors, [])
})

test('the page refuses a reviewer from the same company as the orchestrator or coder', async t => {
  const offer = ModelOfferSchema.parse({
    route: 'commandcode', modelId: 'vendor/one', name: 'Vendor One', company: 'Vendor', service: 'CommandCode',
    codingCapable: true, wire: 'chat', supportedEfforts: ['low', 'medium', 'high'],
  })
  const other = ModelOfferSchema.parse({
    route: 'claude', modelId: 'claude-opus-5-5', name: 'Claude Opus 5.5', company: 'Anthropic', service: 'Claude subscription',
    codingCapable: true, wire: 'messages', supportedEfforts: ['low', 'medium', 'high', 'max'],
  })
  const admitted = ReadyCardSchema.parse({ identifier: 'JUL-238', title: 'A settled card', state: 'Ready', description: settledBrief })
  const server = await startControlPageServer({
    port: 0,
    getState: async () => ({ cards: [{ admitted: true, card: admitted }], offers: [offer, other] }),
    startInitialization: async () => { throw new Error('must not start') },
    getRuns: async () => InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 }),
    getActivity: () => createInitializationActivityRecorder().snapshot(),
  })
  t.after(() => server.close())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(server.url)
  await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Start' }).isDisabled(), true)
  assert.match(await page.locator('p.status').first().innerText(), /Reviewer must come from a different company/)
  await page.getByLabel('Route and model').nth(2).selectOption('claude::claude-opus-5-5')
  assert.equal(await page.getByRole('button', { name: 'Start' }).isDisabled(), false)
})
