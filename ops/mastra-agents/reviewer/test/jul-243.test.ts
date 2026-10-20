import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentActivityStore } from '../src/mastra/agent-activity.ts'

const at = '2026-10-20T00:00:00.000Z'
const later = new Date('2026-10-20T00:20:00.000Z')
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'jul243-settled-'))
  const store = await createAgentActivityStore(join(dir, 'events.db'))
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }) })
  await store.register({ launchId: 'run', provider: 'codex', providerRunId: 'thread', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'builder', model: 'subscription', stage: 'Proof', round: 1 }, at)
  await store.append({ launchId: 'run', eventId: 'start', kind: 'run-started', providerKind: 'turn/started', providerStatus: 'inProgress', occurredAt: at })
  return store
}

test('a running command stays Working after twenty minutes without a new event', async t => {
  const store = await fixture(t)
  await store.append({ launchId: 'run', eventId: 'command', kind: 'action-started', providerKind: 'item/started', providerStatus: 'inProgress', occurredAt: at, action: { id: 'command', type: 'commandExecution', name: 'sleep 1200', outcome: 'unknown' } })
  assert.equal((await store.cards(later))[0].status, 'working')
})

for (const kind of ['run-failed', 'disconnected', 'run-suspended'] as const) {
  test(`${kind} remains visible as Stopped`, async t => {
    const store = await fixture(t)
    await store.append({ launchId: 'run', eventId: 'end', kind, providerKind: kind, providerStatus: kind, occurredAt: at })
    assert.equal((await store.cards(later))[0]?.status, 'stopped')
  })
}

test('fifteen idle minutes becomes Stopped at the threshold', async t => {
  const store = await fixture(t)
  assert.equal((await store.cards(new Date('2026-10-20T00:14:59.999Z')))[0].status, 'working')
  assert.equal((await store.cards(new Date('2026-10-20T00:15:00.000Z')))[0].status, 'stopped')
})


test('three distinct failing commands do not count as the same repeated action', async t => {
  const store = await fixture(t)
  for (let n = 0; n < 3; n++) await store.append({ launchId: 'run', eventId: `failed-${n}`, kind: 'action-completed', providerKind: 'item/completed', providerStatus: 'failed', occurredAt: at, action: { id: `command-${n}`, type: 'commandExecution', name: 'Command execution', actionKey: `command-${n}`, outcome: 'failed', errorCode: 'exit-1' } })
  assert.equal((await store.cards(new Date(at)))[0].status, 'working')
})

test('three identical failing commands show Stopped, a successful action resets the streak', async t => {
  const store = await fixture(t)
  for (let n = 0; n < 3; n++) await store.append({ launchId: 'run', eventId: `failed-${n}`, kind: 'action-completed', providerKind: 'item/completed', providerStatus: 'failed', occurredAt: at, action: { id: `command-${n}`, type: 'commandExecution', name: 'Command execution', actionKey: 'same-command', outcome: 'failed', errorCode: 'exit-1' } })
  assert.equal((await store.cards(new Date(at)))[0].status, 'stopped')
  await store.append({ launchId: 'run', eventId: 'ok', kind: 'action-completed', providerKind: 'item/completed', providerStatus: 'completed', occurredAt: at, action: { id: 'ok', type: 'commandExecution', name: 'Command execution', outcome: 'succeeded' } })
  assert.equal((await store.cards(new Date(at)))[0].status, 'working')
})

test('Codex derives distinct failure identities from native command and cwd, never the item id', async () => {
  const { codexEvent } = await import('../src/mastra/agent-codex.ts')
  const event = (command: string, cwd: string, id: string) => codexEvent('item/completed', { item: { id, type: 'commandExecution', command, cwd, status: 'failed', exitCode: 1 } })
  assert.notEqual(event('false', '/tmp/a', '1').action?.actionKey, event('exit 1', '/tmp/a', '2').action?.actionKey)
  assert.equal(event('false', '/tmp/a', '1').action?.actionKey, event('false', '/tmp/a', '2').action?.actionKey)
  assert.notEqual(event('false', '/tmp/a', '1').action?.actionKey, event('false', '/tmp/b', '1').action?.actionKey)
})

for (const kind of ['run-completed', 'run-canceled'] as const) {
  test(`${kind} leaves the active list and retains its event history after restart`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'jul243-history-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'events.db')
    let store = await createAgentActivityStore(path)
    await store.register({ launchId: 'history', provider: 'mastra', providerRunId: 'native', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'workflow', model: 'none', stage: 'Proof', round: 1 }, at)
    await store.append({ launchId: 'history', eventId: 'start', kind: 'run-started', providerKind: 'start', providerStatus: 'running', occurredAt: at })
    await store.append({ launchId: 'history', eventId: 'end', kind, providerKind: 'end', providerStatus: kind, occurredAt: at })
    store.close()
    store = await createAgentActivityStore(path)
    try {
      assert.deepEqual(await store.cards(later), [])
      assert.deepEqual((await store.history('history')).map(event => event.kind), ['run-started', kind])
      assert.equal((await store.records())[0].state, 'finished')
    } finally { store.close() }
  })
}

test('a real Mastra workflow suspended waiting is Stopped', async t => {
  const { Mastra } = await import('@mastra/core/mastra')
  const { createStep, createWorkflow } = await import('@mastra/core/workflows')
  const { z } = await import('zod/v4')
  const { monitorMastraStream } = await import('../src/mastra/agent-mastra.ts')
  const dir = await mkdtemp(join(tmpdir(), 'jul243-mastra-'))
  const store = await createAgentActivityStore(join(dir, 'events.db'))
  const schema = z.object({})
  const step = createStep({ id: 'waiting-for-input', inputSchema: schema, outputSchema: schema, suspendSchema: schema, execute: async ({ suspend }) => suspend({}) })
  const workflow = createWorkflow({ id: 'paused-proof', inputSchema: schema, outputSchema: schema }).then(step).commit()
  const mastra = new Mastra({ workflows: { workflow } })
  try {
    const run = await mastra.getWorkflow('workflow').createRun()
    const result = await monitorMastraStream({ store, launch: { launchId: 'paused', provider: 'mastra', providerRunId: run.runId, cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'workflow', model: 'none', stage: 'Proof', round: 1 }, stream: run.stream({ inputData: {} }), flush: async () => {} })
    assert.equal(result.status, 'suspended')
    assert.equal((await store.cards())[0].status, 'stopped')
  } finally { await mastra.shutdown(); store.close(); await rm(dir, { recursive: true, force: true }) }
})

test('Proof cleanup settles delayed real workflow persistence before storage closes and records failures', async t => {
  const { cleanupProof } = await import('../src/mastra/agent-proof-cleanup.ts')
  const { readFile } = await import('node:fs/promises')
  const dir = await mkdtemp(join(tmpdir(), 'jul243-cleanup-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = await createAgentActivityStore(join(dir, 'events.db'))
  await store.register({ launchId: 'cleanup', provider: 'mastra', providerRunId: 'native', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'workflow', model: 'none', stage: 'Proof', round: 1 }, at)
  const writes = new Promise<void>(resolve => setTimeout(resolve, 40)).then(() => store.append({ launchId: 'cleanup', eventId: 'final', kind: 'run-completed', providerKind: 'workflow-result', providerStatus: 'success', occurredAt: at }))
  const order: string[] = []
  const result = await cleanupProof({ path: join(dir, 'cleanup.json'), tasks: [writes], cancel: [async () => { throw Error('cancel failed') }], flush: [async () => { assert.equal((await store.history('cleanup'))[0].kind, 'run-completed'); order.push('flushed') }], close: [async () => { store.close(); order.push('closed') }], failure: 'journey failed' })
  assert.deepEqual(order, ['flushed', 'closed'])
  assert.equal(result.ok, false)
  assert.equal(JSON.parse(await readFile(join(dir, 'cleanup.json'), 'utf8')).failure, 'journey failed')
  const reopened = await createAgentActivityStore(join(dir, 'events.db'))
  try { assert.equal((await reopened.history('cleanup'))[0].kind, 'run-completed') } finally { reopened.close() }
})

test('CommandCode explicit completion is success even when its result contains failure-like text', async () => {
  const { commandCodeEvent } = await import('../src/mastra/agent-commandcode.ts')
  const event = commandCodeEvent({ type: 'event', event: { type: 'tool_completed', toolCallId: 'done', toolName: 'read_file', result: 'failure error warning are documentation words' } })
  assert.equal(event.action?.outcome, 'succeeded')
})

test('native idle status does not turn an unexpected Codex failure into Finished', async t => {
  const { codexEvent } = await import('../src/mastra/agent-codex.ts')
  const store = await fixture(t)
  await store.append({ ...codexEvent('turn/completed', { turn: { id: 't', status: 'failed' } }), launchId: 'run', eventId: 'failed-turn', occurredAt: at })
  await store.append({ ...codexEvent('thread/status/changed', { status: { type: 'idle' } }), launchId: 'run', eventId: 'idle', occurredAt: at })
  assert.equal((await store.cards())[0].status, 'stopped')
})

test('append waits for asynchronous event consumers to finish their writes', async t => {
  const store = await fixture(t)
  let written = ''
  store.subscribe(async () => { await new Promise(resolve => setTimeout(resolve, 40)); written = 'persisted' })
  await store.append({ launchId: 'run', eventId: 'new', kind: 'progress', providerKind: 'progress', providerStatus: 'running', occurredAt: at })
  assert.equal(written, 'persisted')
})

test('reconciled Codex idle thread retains authoritative failed turn status', async t => {
  const { codexReconciliationEvents } = await import('../src/mastra/agent-codex.ts')
  const store = await fixture(t)
  const events = codexReconciliationEvents({ id: 'failed-turn', status: 'failed', startedAt: 1792454400, completedAt: 1792454401, items: [] })
  for (const [index, event] of events.entries()) await store.append({ ...event, launchId: 'run', eventId: `reconcile-${index}`, occurredAt: at })
  assert.equal((await store.cards())[0].status, 'stopped')
})

test('Codex reasoning messages between commands do not fabricate a successful tool action', async () => {
  const { codexEvent } = await import('../src/mastra/agent-codex.ts')
  assert.equal(codexEvent('item/completed', { item: { id: 'thought', type: 'reasoning' } }).kind, 'progress')
})

test('phone browser shows Working and Stopped cards, action outcomes and a clean console', async t => {
  const { chromium } = await import('playwright')
  const { startControlPageServer } = await import('../src/mastra/control-page.ts')
  const store = await fixture(t)
  await store.append({ launchId: 'run', eventId: 'active', kind: 'action-started', providerKind: 'item/started', providerStatus: 'inProgress', occurredAt: at, action: { id: 'active', type: 'commandExecution', name: 'Command execution', outcome: 'unknown' } })
  await store.register({ launchId: 'stopped', provider: 'mastra', providerRunId: 'native', cardIdentifier: 'JUL-243', cardTitle: 'Paused workflow', role: 'workflow', model: 'none', stage: 'Proof', round: 1 }, at)
  await store.append({ launchId: 'stopped', eventId: 'pause', kind: 'run-suspended', providerKind: 'workflow-result', providerStatus: 'suspended', occurredAt: at })
  const server = await startControlPageServer({ port: 0, getState: async () => ({ cards: [], offers: [{ route: 'commandcode', modelId: 'free-test', name: 'Free', company: 'Test', service: 'CommandCode', codingCapable: true, supportedEfforts: ['low'] }] }), startInitialization: async () => { throw Error('not used') }, getRuns: async () => ({ runs: [], totalRuns: 0 }), getActivity: () => ({ roleDispatches: { builder: 0, reviewer: 0, crashFixer: 0, crashReviewer: 0 }, llmInferenceCalls: 0, linearQueries: 0, linearMutations: 0 }), getAgentCards: async () => ({ updatedAt: new Date().toISOString(), cards: await store.cards(later) }) })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    assert.equal((await page.goto(server.url))!.status(), 200)
    await page.locator('.agent-card').nth(1).waitFor()
    assert.equal(await page.locator('.agent-status.working').count(), 1)
    assert.equal(await page.locator('.agent-status.stopped').count(), 1)
    assert.equal(await page.getByText('In progress', { exact: true }).count(), 1)
    assert.equal(await page.getByText('What it actually did', { exact: true }).count(), 2)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await server.close() }
})

test('monitored child exposes its owned PID and receives the explicit model with updates disabled', async t => {
  const { writeFile, chmod } = await import('node:fs/promises')
  const { runMonitoredCommandCode } = await import('../src/mastra/agent-commandcode.ts')
  const dir = await mkdtemp(join(tmpdir(), 'jul243-child-'))
  const store = await createAgentActivityStore(join(dir, 'events.db'))
  const executable = join(dir, 'child.mjs')
  await writeFile(executable, '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"result",subtype:"success",argv:process.argv.slice(2)}))\n')
  await chmod(executable, 0o755)
  let pid = 0
  let args: string[] = []
  try {
    const result = await runMonitoredCommandCode({ store, launch: { launchId: 'child', provider: 'commandcode', providerRunId: 'unresolved:child', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'builder', model: 'free', stage: 'Test', round: 1 }, executable, model: 'free', prompt: 'OK', cwd: dir, onSpawn: childPid => { pid = childPid }, onFrame: async frame => { args = (frame as { argv: string[] }).argv } })
    assert.equal(result.exitCode, 0)
    assert.equal(Number.isInteger(pid) && pid > 0, true)
    assert.equal(args[args.indexOf('--model') + 1], 'free')
    assert.equal(args.includes('--no-auto-update'), true)
  } finally { store.close(); await rm(dir, { recursive: true, force: true }) }
})

test('failed journey cleanup waits for a real LibSQL-backed workflow result and trace before closing storage', async t => {
  const { Mastra } = await import('@mastra/core/mastra')
  const { createStep, createWorkflow } = await import('@mastra/core/workflows')
  const { LibSQLStore } = await import('@mastra/libsql')
  const { Observability, MastraStorageExporter } = await import('@mastra/observability')
  const { SamplingStrategyType } = await import('@mastra/core/observability')
  const { z } = await import('zod/v4')
  const { monitorMastraStream } = await import('../src/mastra/agent-mastra.ts')
  const { cleanupProof } = await import('../src/mastra/agent-proof-cleanup.ts')
  const dir = await mkdtemp(join(tmpdir(), 'jul243-real-cleanup-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const database = join(dir, 'mastra.db')
  const storage = new LibSQLStore({ id: 'cleanup', url: `file:${database}` })
  const observation = new Observability({ configs: { default: { serviceName: 'cleanup-test', sampling: { type: SamplingStrategyType.ALWAYS }, exporters: [new MastraStorageExporter()] } } })
  const schema = z.object({})
  const step = createStep({ id: 'settle-workflow', inputSchema: schema, outputSchema: schema, execute: async () => { await new Promise(resolve => setTimeout(resolve, 80)); return {} } })
  const workflow = createWorkflow({ id: 'real-cleanup', inputSchema: schema, outputSchema: schema }).then(step).commit()
  const mastra = new Mastra({ storage, observability: observation, workflows: { workflow } })
  const store = await createAgentActivityStore(join(dir, 'events.db'))
  const run = await mastra.getWorkflow('workflow').createRun()
  const traceId = '02468135790246813579024681357902'
  const task = monitorMastraStream({ store, launch: { launchId: 'real-cleanup', provider: 'mastra', providerRunId: run.runId, cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'workflow', model: 'none', stage: 'Test', round: 1 }, stream: run.stream({ inputData: {}, tracingOptions: { traceId } }), flush: () => observation.flush() })
  task.catch(() => {})
  const cleanup = await cleanupProof({ path: join(dir, 'cleanup.json'), tasks: [task], failure: 'browser assertion failed', flush: [() => observation.flush()], close: [() => mastra.shutdown(), async () => storage.close(), async () => store.close()] })
  assert.equal(cleanup.ok, false)
  assert.deepEqual(cleanup.errors, [])
  assert.equal((await task).status, 'success')
  const reopened = new LibSQLStore({ id: 'reopen', url: `file:${database}` })
  const events = await createAgentActivityStore(join(dir, 'events.db'))
  try {
    const traces = await reopened.getStore('observability')
    const trace = await traces!.getTrace({ traceId })
    assert.equal(trace!.spans.some(span => span.name === "workflow step: 'settle-workflow'"), true)
    assert.equal((await events.history('real-cleanup')).at(-1)?.kind, 'run-completed')
  } finally { await reopened.close(); events.close() }
})

test('a provider result rejected before its stream ends is handled and persisted as disconnected', async t => {
  const { monitorMastraStream } = await import('../src/mastra/agent-mastra.ts')
  const dir = await mkdtemp(join(tmpdir(), 'jul243-result-error-'))
  const store = await createAgentActivityStore(join(dir, 'events.db'))
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }) })
  const stream = { result: Promise.reject(Error('native result failed')), fullStream: (async function* () { await new Promise(resolve => setTimeout(resolve, 40)); yield { type: 'workflow-start', payload: {} } })() }
  await assert.rejects(monitorMastraStream({ store, launch: { launchId: 'result-error', provider: 'mastra', providerRunId: 'native', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'workflow', model: 'none', stage: 'Test', round: 1 }, stream, flush: async () => {} }), /Mastra monitoring failed/)
  assert.equal((await store.history('result-error')).at(-1)?.kind, 'disconnected')
})
