import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentActivityStore } from '../src/mastra/agent-activity.ts'

const launch = { launchId: 'launch-1', provider: 'codex', providerRunId: 'thread-1', cardIdentifier: 'JUL-243', cardTitle: 'Dashboard', role: 'Builder', model: 'test-model', stage: 'Build', round: 1 } as const
const at = '2026-10-19T15:00:00.000Z'

test('events are retained without polling; completion removes live cards and survives reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-'))
  const path = join(root, 'events.db')
  const first = await createAgentActivityStore(path)
  try {
    await first.register(launch, at)
    await first.append({ launchId: launch.launchId, eventId: 'start', kind: 'run-started', providerKind: 'turn/started', providerStatus: 'inProgress', occurredAt: at })
    await first.append({ launchId: launch.launchId, eventId: 'item', kind: 'action-completed', providerKind: 'item/completed', providerStatus: 'completed', occurredAt: at, action: { id: 'command-1', type: 'commandExecution', name: 'Command execution', outcome: 'succeeded' } })
    await first.append({ launchId: launch.launchId, eventId: 'finish', kind: 'run-completed', providerKind: 'turn/completed', providerStatus: 'completed', occurredAt: at })
  } finally { first.close() }
  const reopened = await createAgentActivityStore(path)
  try {
    assert.deepEqual(await reopened.cards(new Date(at)), [])
    assert.deepEqual((await reopened.history('launch-1')).map(event => event.providerKind), ['turn/started', 'item/completed', 'turn/completed'])
    assert.equal((await reopened.records())[0].actions[0].outcome, 'succeeded')
    assert.equal((await reopened.launches())[0].providerRunId, 'thread-1')
  } finally { reopened.close() }
})

test('concurrent runs use lifecycle progress; repeated structured failures and disconnect are explicit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  const emit = (launchId: string, eventId: string, kind: string, occurredAt = at, action?: object) => store.append({ launchId, eventId, kind, providerKind: kind, providerStatus: kind, occurredAt, ...(action ? { action } : {}) } as never)
  try {
    await store.register(launch, '2026-10-19T10:00:00.000Z')
    await store.register({ ...launch, launchId: 'launch-2', providerRunId: 'thread-2' }, at)
    await emit('launch-1', 'old-start', 'run-started', '2026-10-19T10:00:00.000Z')
    await emit('launch-1', 'old-action', 'action-completed', '2026-10-19T10:01:00.000Z', { id: 'old', type: 'command', name: 'Command execution', outcome: 'succeeded' })
    await emit('launch-1', 'new-turn', 'run-started')
    await emit('launch-2', 'start', 'run-started')
    assert.deepEqual((await store.cards(new Date(at))).map(card => card.status), ['working', 'working'])
    for (let index = 0; index < 3; index++) await emit('launch-2', `failure-${index}`, 'action-completed', at, { id: `tool-${index}`, type: 'tool', name: 'Read', outcome: 'failed', errorCode: 'ENOENT', errorCategory: 'not-found' })
    assert.deepEqual((await store.cards(new Date(at))).map(card => card.status), ['working', 'looks-stuck'])
    await emit('launch-1', 'disconnect', 'disconnected')
    assert.deepEqual((await store.cards(new Date(at))).map(card => card.agentId), ['codex:launch-2'])
    await emit('launch-2', 'success', 'action-completed', at, { id: 'success', type: 'tool', name: 'Read', outcome: 'succeeded' })
    assert.equal((await store.cards(new Date(at)))[0].status, 'working')
    assert.equal((await store.cards(new Date('2026-10-19T15:15:00.000Z')))[0].status, 'looks-stuck')
  } finally { store.close() }
})

test('disconnect persists across service recovery until an authoritative reconciliation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  try {
    await store.register(launch, at)
    await store.append({ launchId: launch.launchId, eventId: 'start', kind: 'run-started', providerKind: 'turn/started', providerStatus: 'inProgress', occurredAt: at })
    await store.disconnectActive('service-restart')
    assert.deepEqual(await store.cards(), [])
    await store.append({ launchId: launch.launchId, eventId: 'reconcile', kind: 'run-started', providerKind: 'thread/read', providerStatus: 'inProgress', occurredAt: at })
    assert.equal((await store.cards(new Date(at)))[0].status, 'working')
    assert.equal((await store.history(launch.launchId))[1].kind, 'disconnected')
  } finally { store.close() }
})

test('dashboard production boundary never discovers provider private files or ingests on polling', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../src/mastra/control-server.ts', import.meta.url), 'utf8')
  assert.equal(server.includes('jsonlFiles'), false)
  assert.equal(server.includes('thread-writer-locks'), false)
  assert.equal(server.includes('activeCommandCodeFiles'), false)
  assert.match(server, /agentStore\.cards\(/)
})

test('CommandCode accepts official frames, preserves unknown event kinds, and uses final subtype not output text', async () => {
  const { commandCodeEvent } = await import('../src/mastra/agent-commandcode.ts')
  assert.deepEqual(commandCodeEvent({ type: 'event', event: { type: 'tool_running', toolCallId: 'read-1', toolName: 'read_file', description: 'ignored arbitrary description' } }), {
    kind: 'action-started', providerKind: 'tool_running', providerStatus: 'running', action: { id: 'read-1', type: 'tool', name: 'read_file', outcome: 'unknown' },
  })
  assert.deepEqual(commandCodeEvent({ type: 'result', subtype: 'success', finalText: '{"exit_code":1}', usage: {}, durationMs: 2 }), { kind: 'run-completed', providerKind: 'result', providerStatus: 'success' })
  assert.deepEqual(commandCodeEvent({ type: 'result', subtype: 'max_turns', usage: {}, durationMs: 2 }), { kind: 'run-failed', providerKind: 'result', providerStatus: 'max_turns' })
  assert.deepEqual(commandCodeEvent({ type: 'event', event: { type: 'new-kind', secretOutput: 'excluded' } }), { kind: 'unknown', providerKind: 'new-kind', providerStatus: 'unknown' })
})

test('structured error logging preserves nested cause and context while removing credential values', async () => {
  const { agentError } = await import('../src/mastra/agent-errors.ts')
  const error = new Error('provider wrapper', { cause: new TypeError('token=topsecret failed request') })
  const value = agentError(error, { provider: 'commandcode', runId: 'run-1', eventKind: 'stream-error' })
  assert.deepEqual(value, { provider: 'commandcode', runId: 'run-1', eventKind: 'stream-error', error: { name: 'Error', message: 'provider wrapper', cause: { name: 'TypeError', message: '[REDACTED] failed request' } } })
})

test('Codex authoritative item status ignores failure-looking stdout and turn completion is terminal', async () => {
  const { codexEvent } = await import('../src/mastra/agent-codex.ts')
  const item = { id: 'cmd-1', type: 'commandExecution', command: 'echo source', cwd: '/tmp', processId: '123', status: 'completed', commandActions: [], aggregatedOutput: '{"exit_code":1}', exitCode: 0, durationMs: 1 }
  assert.deepEqual(codexEvent('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item }), {
    kind: 'action-completed', providerKind: 'item/completed', providerStatus: 'completed', action: { id: 'cmd-1', type: 'commandExecution', name: 'Command execution', outcome: 'succeeded' },
  })
  assert.deepEqual(codexEvent('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed', items: [], error: { message: 'excluded raw provider message' } } }), { kind: 'run-failed', providerKind: 'turn/completed', providerStatus: 'failed' })
  assert.deepEqual(codexEvent('item/agentMessage/delta', { threadId: 'thread-1', delta: 'stream of words' }), { kind: 'unknown', providerKind: 'item/agentMessage/delta', providerStatus: 'unknown' })
})

test('real Mastra stream persists completed lifecycle and flushed trace across storage restart', async () => {
  const { Mastra } = await import('@mastra/core/mastra')
  const { createStep, createWorkflow } = await import('@mastra/core/workflows')
  const { z } = await import('zod/v4')
  const { LibSQLStore } = await import('@mastra/libsql')
  const { Observability, MastraStorageExporter } = await import('@mastra/observability')
  const { monitorMastraStream } = await import('../src/mastra/agent-mastra.ts')
  const root = await mkdtemp(join(tmpdir(), 'jul-243-mastra-'))
  const path = join(root, 'mastra.db')
  const storage = new LibSQLStore({ id: 'contract', url: `file:${path}` })
  const step = createStep({ id: 'add-one', inputSchema: z.object({ value: z.number() }), outputSchema: z.object({ value: z.number() }), execute: async ({ inputData }) => ({ value: inputData.value + 1 }) })
  const workflow = createWorkflow({ id: 'contract', inputSchema: step.inputSchema, outputSchema: step.outputSchema }).then(step).commit()
  const observability = new Observability({ configs: { default: { serviceName: 'jul-243-test', sampling: { type: 'always' }, exporters: [new MastraStorageExporter()] } } })
  const mastra = new Mastra({ storage, workflows: { workflow }, observability })
  const store = await createAgentActivityStore(join(root, 'events.db'))
  try {
    const run = await mastra.getWorkflow('workflow').createRun({ runId: 'real-mastra-run' })
    const stream = run.stream({ inputData: { value: 4 }, tracingOptions: { traceId: '0123456789abcdef0123456789abcdef', metadata: { cardIdentifier: 'JUL-243', role: 'Builder' } } })
    const result = await monitorMastraStream({ store, launch: { ...launch, provider: 'mastra', providerRunId: run.runId }, stream, flush: () => observability.flush() })
    assert.equal(result.status, 'success')
    assert.equal((await store.history(launch.launchId)).at(-1)?.kind, 'run-completed')
    assert.deepEqual((await store.records())[0].actions.map(action => [action.label, action.outcome]), [['add-one', 'succeeded']])
  } finally { store.close(); await observability.shutdown(); await mastra.shutdown() }
  const reopened = new LibSQLStore({ id: 'reopen', url: `file:${path}` })
  try {
    const traces = await reopened.getStore('observability')
    const trace = await traces!.getTrace({ traceId: '0123456789abcdef0123456789abcdef' })
    assert.equal(trace!.spans.some(span => span.name === 'workflow step: \'add-one\''), true)
  } finally { await reopened.close() }
})

test('390px dashboard shows provider cards, outcomes, exact source copy, single-line short times, and all actions', async () => {
  const { chromium } = await import('playwright')
  const { startControlPageServer } = await import('../src/mastra/control-page.ts')
  const root = await mkdtemp(join(tmpdir(), 'jul-243-ui-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  for (const provider of ['codex', 'commandcode', 'mastra'] as const) {
    await store.register({ ...launch, launchId: provider, provider, providerRunId: provider }, at)
    await store.append({ launchId: provider, eventId: 'start', kind: 'run-started', providerKind: 'start', providerStatus: 'running', occurredAt: at })
    for (let index = 0; index < 11; index++) await store.append({ launchId: provider, eventId: `action-${index}`, kind: 'action-completed', providerKind: 'tool-result', providerStatus: 'completed', occurredAt: at, action: { id: String(index), type: 'tool', name: 'Read file', outcome: provider === 'commandcode' ? 'failed' : 'succeeded', ...(provider === 'commandcode' ? { errorCode: 'ENOENT', errorCategory: 'not-found' } : {}) } })
  }
  const server = await startControlPageServer({ port: 0, getState: async () => ({ cards: [], offers: [{ route: 'commandcode', modelId: 'test-model', name: 'Test model', company: 'Test', service: 'CommandCode', codingCapable: true, supportedEfforts: ['low'] }] }), startInitialization: async () => { throw new Error('not used') }, getRuns: async () => ({ runs: [], totalRuns: 0 }), getActivity: () => ({ roleDispatches: { builder: 0, reviewer: 0, crashFixer: 0, crashReviewer: 0 }, llmInferenceCalls: 0, linearQueries: 0, linearMutations: 0 }), getAgentCards: async () => ({ updatedAt: at, cards: await store.cards(new Date(at)) }) })
  let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    assert.equal((await page.goto(server.url))!.status(), 200)
    await page.locator('.agent-card').nth(2).waitFor()
    assert.equal(await page.locator('.agent-card').count(), 3)
    assert.equal(await page.getByText("From the tools' own records. Newest first.", { exact: true }).count(), 3)
    assert.equal(await page.locator('.looks-stuck').count(), 1)
    await page.getByRole('button', { name: 'Show all 11 actions', exact: true }).first().click()
    assert.equal(await page.locator('.agent-card').first().locator('.activity-time').count(), 11)
    assert.equal(await page.locator('.agent-card').first().getByText('Succeeded', { exact: true }).count(), 11)
    assert.deepEqual(await page.locator('.activity-time').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element)
      return style.whiteSpace === 'nowrap' && element.textContent!.length <= 5
    })), Array(31).fill(true))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: join(root, 'dashboard-390.png'), fullPage: true })
  } finally { await browser?.close(); await server.close(); store.close() }
})

test('Mastra terminal failure and suspension use official result statuses', async () => {
  const { Mastra } = await import('@mastra/core/mastra')
  const { createStep, createWorkflow } = await import('@mastra/core/workflows')
  const { z } = await import('zod/v4')
  const { monitorMastraStream } = await import('../src/mastra/agent-mastra.ts')
  for (const status of ['failed', 'suspended'] as const) {
    const root = await mkdtemp(join(tmpdir(), 'jul-243-mastra-state-'))
    const store = await createAgentActivityStore(join(root, 'events.db'))
    const schema = z.object({})
    const step = createStep({ id: 'controlled-state', inputSchema: schema, outputSchema: schema, suspendSchema: schema, execute: async ({ suspend }) => { if (status === 'failed') throw new Error('expected contract failure'); return suspend({}) } })
    const workflow = createWorkflow({ id: `state-${status}`, inputSchema: schema, outputSchema: schema }).then(step).commit()
    const mastra = new Mastra({ workflows: { workflow } })
    try {
      const run = await mastra.getWorkflow('workflow').createRun()
      const result = await monitorMastraStream({ store, launch: { ...launch, provider: 'mastra', providerRunId: run.runId }, stream: run.stream({ inputData: {} }), flush: async () => {} })
      assert.equal(result.status, status)
      assert.equal((await store.history(launch.launchId)).at(-1)?.kind, status === 'failed' ? 'run-failed' : 'run-suspended')
      assert.equal((await store.records())[0].running, false)
    } finally { store.close(); await mastra.shutdown() }
  }
})

test('Codex collaboration preserves child thread identity without reading its prompt', async () => {
  const { codexEvent } = await import('../src/mastra/agent-codex.ts')
  const event = codexEvent('item/completed', { item: { id: 'spawn-1', type: 'collabAgentToolCall', status: 'completed', senderThreadId: 'parent-1', receiverThreadIds: ['child-1'], tool: 'spawnAgent', agentsStates: {}, prompt: 'JUL-999 must never change the launch card' } })
  assert.deepEqual(event.relatedRunIds, ['child-1'])
  assert.equal(event.action!.name, 'Agent collaboration')
})

test('provider identity is bound from the official stream once, and retained on each subsequent event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-identity-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  try {
    await store.register({ ...launch, provider: 'commandcode', providerRunId: 'unresolved:launch-1' }, at)
    await store.identify('launch-1', 'native-session-1')
    await store.append({ launchId: 'launch-1', eventId: 'start', kind: 'run-started', providerKind: 'run_start', providerStatus: 'running', occurredAt: at })
    assert.equal((await store.history('launch-1'))[0].launch?.providerRunId, 'native-session-1')
    await assert.rejects(store.identify('launch-1', 'different-session'), /already bound/)
    assert.equal((await store.launches())[0].providerRunId, 'native-session-1')
  } finally { store.close() }
})

test('CommandCode explicit tool errors produce stable failure identity; completed text is never searched', async () => {
  const { commandCodeEvent } = await import('../src/mastra/agent-commandcode.ts')
  const failed = commandCodeEvent({ type: 'event', event: { type: 'tool_errored', toolCallId: 'failed-1', toolName: 'shell_command', error: 'Directory does not exist: /tmp/missing' } })
  assert.equal(failed.action?.outcome, 'failed')
  assert.equal(failed.providerStatus, 'errored')
  const other = commandCodeEvent({ type: 'event', event: { type: 'tool_errored', toolCallId: 'failed-2', toolName: 'shell_command', error: 'Permission denied' } })
  assert.notEqual(failed.action?.errorCategory, other.action?.errorCategory)
  const completed = commandCodeEvent({ type: 'event', event: { type: 'tool_completed', toolCallId: 'completed-1', toolName: 'shell_command', result: [{ type: 'text', text: '{"exit_code":1}' }] } })
  assert.equal(completed.action?.outcome, 'unknown')
})

test('a completed action with unknown outcome breaks the consecutive explicit failure sequence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-sequence-'))
  const store = await createAgentActivityStore(join(root, 'events.db'))
  try {
    await store.register(launch, at)
    await store.append({ launchId: launch.launchId, eventId: 'start', kind: 'run-started', providerKind: 'turn/started', providerStatus: 'running', occurredAt: at })
    for (const [index, outcome] of ['failed', 'unknown', 'failed', 'failed'].entries()) await store.append({ launchId: launch.launchId, eventId: `a-${index}`, kind: 'action-completed', providerKind: 'item/completed', providerStatus: 'completed', occurredAt: at, action: { id: `a-${index}`, type: 'tool', name: 'Read', outcome: outcome as 'failed' | 'unknown', ...(outcome === 'failed' ? { errorCode: 'ENOENT', errorCategory: 'not-found' } : {}) } })
    assert.equal((await store.cards(new Date(at)))[0].status, 'working')
    assert.equal((await store.records())[0].actions[1].phase, 'completed')
  } finally { store.close() }
})
