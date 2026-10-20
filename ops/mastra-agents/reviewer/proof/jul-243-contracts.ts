import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { connectCodexProxy } from '../src/mastra/agent-codex-connection.ts'
import { createAgentActivityStore } from '../src/mastra/agent-activity.ts'
import { runMonitoredCommandCode } from '../src/mastra/agent-commandcode.ts'

test('installed Codex executes a sandbox command and exposes native thread records without inference', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul243-current-native-'))
  const connection = await connectCodexProxy()
  t.after(async () => { await connection.close(); await rm(root, { recursive: true, force: true }) })
  const result = await connection.request('command/exec', { command: ['/usr/bin/printf', 'sandbox-contract-ok'], cwd: root, sandboxPolicy: { type: 'workspaceWrite', writableRoots: [root], networkAccess: false }, timeoutMs: 10000 }) as { exitCode: number; stdout: string; stderr: string }
  assert.deepEqual(result, { exitCode: 0, stdout: 'sandbox-contract-ok', stderr: '' })
  const { thread } = await connection.request('thread/start', { cwd: root, approvalPolicy: 'never', sandbox: 'workspace-write' }) as { thread: { id: string } }
  const read = await connection.request('thread/read', { threadId: thread.id }) as { thread: { id: string; status: { type: string } } }
  assert.equal(read.thread.id, thread.id)
  assert.equal(read.thread.status.type, 'idle')
  await connection.request('thread/archive', { threadId: thread.id })
})

test('installed CommandCode free-model lifecycle produces Working then durable Finished', { skip: process.env.JULIA_COMMANDCODE_FREE_CONTRACT !== '1' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul243-current-cc-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }) })
  const frames: unknown[] = []
  let working = false
  store.subscribe(async event => { if (event.kind === 'run-started') working = (await store.cards()).some(card => card.status === 'working') })
  const result = await runMonitoredCommandCode({ store, launch: { launchId: 'free-contract', provider: 'commandcode', providerRunId: 'unresolved:free-contract', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'builder', model: 'poolside/laguna-s-2.1-free', stage: 'Contract', round: 1 }, model: 'poolside/laguna-s-2.1-free', prompt: 'Reply with exactly OK. Do not call tools.', cwd: root, maxTurns: 1, onFrame: async frame => { frames.push(frame) } })
  const path = process.env.JULIA_COMMANDCODE_CONTRACT_EVIDENCE
  if (path) await writeFile(path, JSON.stringify({ version: '1.84.0', result, frames }, null, 2) + '\n')
  assert.equal(result.exitCode, 0)
  assert.equal(result.terminal, true)
  assert.equal(working, true)
  assert.equal((await store.records())[0].state, 'finished')
  assert.deepEqual(await store.cards(), [])
})

test('real CommandCode killed during its model request becomes Stopped', { skip: process.env.JULIA_COMMANDCODE_FREE_CONTRACT !== '1' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul243-current-cutoff-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }) })
  let pid = 0
  let cutOff = false
  const result = await runMonitoredCommandCode({ store, launch: { launchId: 'cutoff', provider: 'commandcode', providerRunId: 'unresolved:cutoff', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'builder', model: 'poolside/laguna-s-2.1-free', stage: 'Contract', round: 1 }, model: 'poolside/laguna-s-2.1-free', prompt: 'Reply with exactly OK. Do not call tools.', cwd: root, maxTurns: 1, onSpawn: value => { pid = value }, onFrame: async frame => {
    const value = frame as { event?: { type?: string } }
    if (!cutOff && value.event?.type === 'model_request_start') { cutOff = true; process.kill(pid, 'SIGKILL') }
  } })
  assert.equal(cutOff, true)
  assert.equal(result.exitCode, null)
  assert.equal((await store.cards())[0].status, 'stopped')
  assert.equal((await store.history('cutoff')).at(-1)?.kind, 'disconnected')
})

test('real Codex exposes a foreground wait as a running command before completion', { skip: process.env.JULIA_CODEX_MODEL_CONTRACT !== '1', timeout: 120000 }, async t => {
  const { createCodexMonitor } = await import('../src/mastra/agent-codex-monitor.ts')
  const root = await mkdtemp(join(tmpdir(), 'jul243-current-wait-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  const monitor = await createCodexMonitor(store)
  t.after(async () => { await monitor.close(); store.close(); await rm(root, { recursive: true, force: true }) })
  const sandbox = await monitor.request('command/exec', { command: ['/usr/bin/printf', 'sandbox-before-model'], cwd: root, sandboxPolicy: { type: 'workspaceWrite', writableRoots: [root], networkAccess: false }, timeoutMs: 10000 }) as { exitCode: number; stdout: string }
  assert.deepEqual({ exitCode: sandbox.exitCode, stdout: sandbox.stdout }, { exitCode: 0, stdout: 'sandbox-before-model' })
  const models = await monitor.request('model/list', {}) as { data: { model: string; isDefault: boolean }[] }
  const model = models.data.find(item => item.isDefault)!.model
  const launch = await monitor.launch({ launchId: 'wait', provider: 'codex', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'Proof', model, stage: 'Contract', round: 1 }, { cwd: root, model, approvalPolicy: 'never', sandbox: 'workspace-write' })
  let running = false
  store.subscribe(async event => { if (event.kind === 'action-started' && event.action?.type === 'commandExecution') running = (await store.cards())[0].status === 'working' })
  const completed = monitor.completed('wait', AbortSignal.timeout(100000))
  const start = await monitor.request('turn/start', { threadId: launch.providerRunId, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [root], networkAccess: false }, input: [{ type: 'text', text: 'Run exactly sleep 3 using the command execution tool, wait for completion, then reply done. Do not run other commands or create files.' }] }) as { turn: { id: string } }
  t.after(async () => { try { await monitor.request('turn/interrupt', { threadId: launch.providerRunId, turnId: start.turn.id }) } catch {} })
  const [terminal] = await completed as { kind: string }[]
  assert.equal(terminal.kind, 'run-completed')
  assert.equal(running, true)
  const turns = await monitor.request('thread/turns/list', { threadId: launch.providerRunId, limit: 100, itemsView: 'full' }) as { data: { items: { type: string; command?: string; exitCode?: number }[] }[] }
  assert.equal(turns.data.flatMap(turn => turn.items).some(item => item.type === 'commandExecution' && item.command?.includes('sleep 3') && item.exitCode === 0), true)
  assert.equal((await store.records())[0].state, 'finished')
})

test('real registered idle Codex thread survives monitor restart before its first message', async t => {
  const { createCodexMonitor } = await import('../src/mastra/agent-codex-monitor.ts')
  const root = await mkdtemp(join(tmpdir(), 'jul243-current-idle-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }) })
  const monitor = await createCodexMonitor(store)
  const launch = await monitor.launch({ launchId: 'idle-restart', provider: 'codex', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'Proof', model: 'none', stage: 'Contract', round: 1 }, { cwd: root, approvalPolicy: 'never', sandbox: 'workspace-write' })
  await monitor.close()
  const reopened = await createCodexMonitor(store)
  try {
    const native = await reopened.request('thread/read', { threadId: launch.providerRunId }) as { thread: { id: string; status: { type: string } } }
    assert.equal(native.thread.id, launch.providerRunId)
    assert.equal(native.thread.status.type, 'idle')
    assert.equal((await store.cards())[0].status, 'working')
  } finally { await reopened.close() }
})
