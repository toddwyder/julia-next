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
