import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentActivityStore } from '../src/mastra/agent-activity.ts'
import { codexEvent } from '../src/mastra/agent-codex.ts'

test('context fullness uses the last exchange and survives durable reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul244-'))
  let store = await createAgentActivityStore(join(root, 'events.db'))
  try {
    await store.register({ launchId: 'c', providerRunId: 'native', provider: 'codex', cardIdentifier: 'JUL-244', cardTitle: 'Dashboard C', role: 'Builder', model: 'codex', stage: 'Build', round: 1 })
    await store.append({ ...codexEvent('thread/tokenUsage/updated', { tokenUsage: { last: { totalTokens: 610 }, total: { totalTokens: 99000 }, modelContextWindow: 1000 } }), launchId: 'c', eventId: 'usage', occurredAt: new Date().toISOString() })
    store.close()
    store = await createAgentActivityStore(join(root, 'events.db'))
    assert.deepEqual((await store.cards())[0].telemetry.context, { percent: 61, usedTokens: 610, windowTokens: 1000 })
    assert.equal((await store.cards())[0].telemetry.handoffs, null)
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('native checklist ticks replace earlier wording and compaction replay counts once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul244-plan-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  try {
    await store.register({ launchId: 'c', providerRunId: 'native', provider: 'codex', cardIdentifier: 'JUL-244', cardTitle: 'Dashboard C', role: 'Builder', model: 'codex', stage: 'Build', round: 1 })
    let id = 0
    const append = (method: string, params: unknown) => store.append({ ...codexEvent(method, params), launchId: 'c', eventId: String(++id), occurredAt: '2026-10-20T12:00:00.000Z' })
    await append('turn/started', { turn: { id: 't', status: 'inProgress' } })
    assert.deepEqual((await store.cards())[0].telemetry.checklist, [])
    await append('turn/plan/updated', { plan: [{ step: '<Read> the card', status: 'pending' }] })
    await append('turn/plan/updated', { plan: [{ step: '<Read> the card', status: 'completed' }, { step: 'Prove it', status: 'inProgress' }] })
    await append('item/completed', { item: { id: 'compact-1', type: 'contextCompaction' } })
    await append('item/completed', { item: { id: 'compact-1', type: 'contextCompaction' } })
    const { telemetry } = (await store.cards())[0]
    assert.deepEqual(telemetry.checklist, [{ step: '<Read> the card', status: 'completed' }, { step: 'Prove it', status: 'inProgress' }])
    assert.deepEqual(telemetry.compactions, [{ id: 'compact-1', occurredAt: '2026-10-20T12:00:00.000Z' }])
    await append('turn/started', { turn: { id: 't2', status: 'inProgress' } })
    assert.deepEqual((await store.cards())[0].telemetry.checklist, [])
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('phone shows context bar, separate unknown handoffs, literal checklist ticks and unavailable fallback', async () => {
  const { chromium, expect } = await import('playwright/test')
  const { startControlPageServer } = await import('../src/mastra/control-page.ts')
  const root = await mkdtemp(join(tmpdir(), 'jul244-browser-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  for (const provider of ['codex', 'commandcode'] as const) await store.register({ launchId: provider, providerRunId: provider, provider, cardIdentifier: 'JUL-244', cardTitle: provider, role: 'Builder', model: 'model', stage: 'Build', round: 1 })
  await store.append({ ...codexEvent('thread/tokenUsage/updated', { tokenUsage: { last: { totalTokens: 610 }, modelContextWindow: 1000 } }), launchId: 'codex', eventId: 'usage', occurredAt: new Date().toISOString() })
  await store.append({ ...codexEvent('turn/plan/updated', { plan: [{ step: '<Read> the card', status: 'completed' }, { step: 'Prove it', status: 'inProgress' }] }), launchId: 'codex', eventId: 'plan', occurredAt: new Date().toISOString() })
  const server = await startControlPageServer({ port: 0, getState: async () => ({ cards: [], offers: [{ route: 'commandcode', modelId: 'free-test', name: 'Free', company: 'Test', service: 'CommandCode', codingCapable: true, supportedEfforts: ['low'] }] }), startInitialization: async () => { throw Error('not used') }, getRuns: async () => ({ runs: [], totalRuns: 0 }), getActivity: () => ({ roleDispatches: { builder: 0, reviewer: 0, crashFixer: 0, crashReviewer: 0 }, llmInferenceCalls: 0, linearQueries: 0, linearMutations: 0 }), getAgentCards: async () => ({ updatedAt: new Date().toISOString(), cards: await store.cards() }) })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    assert.equal((await page.goto(server.url))!.status(), 200)
    const codex = page.locator('.agent-card').filter({ has: page.getByRole('heading', { name: 'codex', exact: true }) })
    await expect(codex.getByText('Context 61% full', { exact: true })).toBeVisible({ timeout: 2000 })
    assert.equal(await codex.getByRole('progressbar').getAttribute('aria-valuenow'), '61')
    assert.equal(await codex.getByText('Handoffs: unavailable', { exact: true }).count(), 1)
    assert.equal(await codex.getByText('✓ <Read> the card', { exact: true }).count(), 1)
    assert.equal(await codex.getByText('□ Prove it (working on)', { exact: true }).count(), 1)
    const cc = page.locator('.agent-card').filter({ has: page.getByRole('heading', { name: 'commandcode', exact: true }) })
    assert.equal(await cc.getByText('Context unavailable', { exact: true }).count(), 1)
    assert.equal(await cc.getByText('Checklist: unavailable', { exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await server.close(); store.close(); await rm(root, { recursive: true, force: true }) }
})

test('newly observed Codex thread records zero compactions but missing capacity remains unavailable', async () => {
  assert.deepEqual(codexEvent('thread/started', { thread: { id: 'native' } }).telemetry, { compactions: [], checklist: [] })
  for (const modelContextWindow of [null, 0, -1, undefined]) assert.deepEqual(codexEvent('thread/tokenUsage/updated', { tokenUsage: { last: { totalTokens: 500 }, modelContextWindow } }).telemetry, { context: null })
  assert.deepEqual(codexEvent('thread/tokenUsage/updated', { tokenUsage: { last: { totalTokens: 1500 }, modelContextWindow: 1000 } }).telemetry, { context: { percent: 100, usedTokens: 1500, windowTokens: 1000 } })
})
