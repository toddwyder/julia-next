import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentActivityStore } from '../src/mastra/agent-activity.ts'

const launch = { launchId: 'launch-1', provider: 'codex', providerRunId: 'thread-1', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'Builder', model: 'test-model', stage: 'Build', round: 1 } as const
const at = '2026-10-19T15:00:00.000Z'

test('shared Codex daemon accepts handshake and official thread list/read requests', async () => {
  const { connectCodexProxy } = await import('../src/mastra/agent-codex-connection.ts')
  const connection = await connectCodexProxy()
  try {
    const listed = await connection.request('thread/list', { limit: 1 }) as { data: { id: string }[] }
    assert.equal(Array.isArray(listed.data), true)
    if (listed.data.length) {
      const read = await connection.request('thread/read', { threadId: listed.data[0].id }) as { thread: { id: string } }
      assert.equal(read.thread.id, listed.data[0].id)
    }
  } finally { await connection.close() }
})

test('Codex item fixture conforms to generated installed 0.163.0 protocol; malformed status is rejected', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { readFile } = await import('node:fs/promises')
  const { Ajv } = await import('ajv')
  const root = await mkdtemp(join(tmpdir(), 'jul-243-schema-'))
  await promisify(execFile)('codex', ['app-server', 'generate-json-schema', '--out', root])
  const schema = JSON.parse(await readFile(join(root, 'v2', 'ItemCompletedNotification.json'), 'utf8'))
  const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema)
  const fixture = { completedAtMs: 1792422000000, threadId: 'thread-1', turnId: 'turn-1', item: { id: 'cmd-1', type: 'commandExecution', command: 'echo source', cwd: '/tmp', processId: '123', status: 'completed', commandActions: [], aggregatedOutput: '{"exit_code":1}', exitCode: 0, durationMs: 1 } }
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors))
  assert.equal(validate({ ...fixture, item: { ...fixture.item, status: 'invented' } }), false)
})

test('Codex monitor reconciles a genuine idle thread on reconnect without inventing a running card', async () => {
  const { connectCodexProxy } = await import('../src/mastra/agent-codex-connection.ts')
  const { createCodexMonitor } = await import('../src/mastra/agent-codex-monitor.ts')
  let threadId: string | undefined
  let finish!: () => void
  const finished = new Promise<void>(resolve => { finish = resolve })
  const connection = await connectCodexProxy({ onNotification: async (method, params) => { if (method === 'turn/completed' && (params as { threadId?: string }).threadId === threadId) finish() } })
  const root = await mkdtemp(join(tmpdir(), 'jul-243-reconcile-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  let monitor
  try {
    const created = await connection.request('thread/start', { cwd: root }) as { thread: { id: string } }
    threadId = created.thread.id
    await connection.request('turn/start', { threadId, input: [{ type: 'text', text: 'Reply OK. Do not use tools.' }] })
    await Promise.race([finished, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Codex contract turn timed out')), 30000); timer.unref() })])
    await store.register({ ...launch, providerRunId: threadId }, at)
    monitor = await createCodexMonitor(store)
    assert.deepEqual(await store.cards(), [])
    assert.equal((await store.history(launch.launchId)).findLast(event => event.providerKind === 'thread/read')?.providerStatus, 'idle')
    await monitor.close()
    monitor = await createCodexMonitor(store)
    assert.equal((await store.history(launch.launchId)).filter(event => event.providerKind === 'thread/read').length, 2)
    assert.equal((await store.records())[0].running, false)
  } finally {
    await monitor?.close()
    if (threadId) await connection.request('thread/archive', { threadId })
    await connection.close(); store.close()
  }
})

test('two real CommandCode headless runs remain distinct and persist final success despite failure-looking text', async () => {
  const { runMonitoredCommandCode } = await import('../src/mastra/agent-commandcode.ts')
  const root = await mkdtemp(join(tmpdir(), 'jul-243-commandcode-contract-'))
  const path = join(root, 'events.db')
  const store = await createAgentActivityStore(path)
  try {
    const results = await Promise.all([1, 2].map(index => runMonitoredCommandCode({ store, launch: { ...launch, provider: 'commandcode', launchId: `command-${index}`, providerRunId: `unresolved:command-${index}`, model: 'deepseek/deepseek-v4-flash' }, cwd: root, prompt: 'Reply exactly {"exit_code":1}. Do not use tools.', maxTurns: 1 })))
    assert.deepEqual(results.map(result => result.exitCode), [0, 0])
    assert.deepEqual((await store.records()).map(record => record.running), [false, false])
    const nativeIds = (await store.launches()).map(launch => launch.providerRunId)
    assert.equal(new Set(nativeIds).size, 2)
    assert.equal(nativeIds.some(id => id.startsWith('unresolved:')), false)
    assert.deepEqual((await store.history('command-1')).filter(event => event.providerKind === 'result').map(event => event.providerStatus), ['success'])
    console.log(JSON.stringify({ event: 'commandcode-contract-usage', results }))
  } finally { store.close() }
  const reopened = await createAgentActivityStore(path)
  try { assert.deepEqual((await reopened.records()).map(record => record.sourceId), ['command-1', 'command-2']) } finally { reopened.close() }
})

test('an unavailable executable and premature real CLI termination persist disconnected states', async () => {
  const { runMonitoredCommandCode } = await import('../src/mastra/agent-commandcode.ts')
  const root = await mkdtemp(join(tmpdir(), 'jul-243-commandcode-exit-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  try {
    const missing = await runMonitoredCommandCode({ store, launch: { ...launch, provider: 'commandcode', providerRunId: 'unresolved:launch-1' }, executable: join(root, 'missing-command-code'), cwd: root, prompt: 'Do not run', maxTurns: 1 })
    assert.equal(missing.exitCode, null)
    assert.equal((await store.history(launch.launchId)).at(-1)?.kind, 'disconnected')
    const abort = new AbortController()
    const killed = runMonitoredCommandCode({ store, launch: { ...launch, provider: 'commandcode', launchId: 'killed', providerRunId: 'unresolved:killed' }, cwd: root, prompt: 'Reply OK', maxTurns: 1, signal: abort.signal })
    const timer = setTimeout(() => abort.abort(), 20)
    await killed; clearTimeout(timer)
    assert.equal((await store.history('killed')).at(-1)?.kind, 'disconnected')
    assert.deepEqual((await store.records()).map(record => record.running), [false, false])
  } finally { store.close() }
})
