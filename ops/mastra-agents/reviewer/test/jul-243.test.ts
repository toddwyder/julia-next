import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'

import {
  createAgentActivityStore,
  discoverAgentActivity,
  projectAgentCards,
  readCodexActivity,
  readCommandCodeActivity,
  type AgentActivityRecord,
} from '../src/mastra/agent-activity.ts'
import { createInitializationActivityRecorder } from '../src/mastra/initialization-observability.ts'
import { createInitializationRuntime } from '../src/mastra/initialization.ts'
import { startControlPageServer } from '../src/mastra/control-page.ts'
import { jsonlFiles } from '../src/mastra/control-server.ts'

const NOW = new Date('2026-10-19T15:00:00.000Z')

function record(overrides: Partial<AgentActivityRecord>): AgentActivityRecord {
  return {
    source: 'codex', sourceId: 'run-1', running: true, cardIdentifier: 'JUL-243',
    cardTitle: 'Card 2: Dashboard A + B', role: 'Builder', model: 'Codex', service: 'ChatGPT Plus',
    stage: 'Building', round: 1, startedAt: '2026-10-19T14:00:00.000Z', updatedAt: '2026-10-19T14:59:00.000Z',
    actions: [{ id: 'a1', occurredAt: '2026-10-19T14:59:00.000Z', label: 'Ran tests', outcome: 'succeeded' }],
    ...overrides,
  }
}

test('projects one card per running agent from Codex, CommandCode, and Mastra records', () => {
  const cards = projectAgentCards([
    record({ source: 'codex', sourceId: 'codex-1' }),
    record({ source: 'commandcode', sourceId: 'cc-1', model: 'DeepSeek Flash', service: 'CommandCode' }),
    record({ source: 'mastra', sourceId: 'trace-1', model: 'Claude', service: 'Mastra' }),
    record({ source: 'codex', sourceId: 'finished', running: false }),
  ], NOW)

  assert.deepEqual(cards.map(card => card.agentId), ['codex:codex-1', 'commandcode:cc-1', 'mastra:trace-1'])
  assert.deepEqual(cards.map(card => card.status), ['working', 'working', 'working'])
  assert.equal(cards[0].actions[0].label, 'Ran tests')
  assert.equal('failureKey' in cards[0].actions[0], false)
})

test('native lifecycle uses the latest turn and finished CommandCode output is not running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-lifecycle-'))
  const codex = join(root, 'codex.jsonl')
  const commandCode = join(root, 'commandcode.jsonl')
  await writeFile(codex, [
    { timestamp: '2026-10-18T10:00:00.000Z', type: 'session_meta', payload: { id: 'multi-turn' } },
    { timestamp: '2026-10-18T10:01:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build JUL-243: Dashboard A + B' }] } },
    { timestamp: '2026-10-18T10:02:00.000Z', type: 'event_msg', payload: { type: 'task_complete' } },
    { timestamp: '2026-10-19T14:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue JUL-243' }] } },
  ].map(JSON.stringify).join('\n'))
  await writeFile(commandCode, [
    { type: 'session', id: 'finished-cc', timestamp: '2026-10-19T14:00:00.000Z' },
    { type: 'message', timestamp: '2026-10-19T14:01:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Build JUL-243' }] } },
    { type: 'message', timestamp: '2026-10-19T14:02:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'last-tool', name: 'read', input: { path: 'README.md' } }] } },
    { type: 'message', timestamp: '2026-10-19T14:02:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'last-tool', content: 'done' }] } },
  ].map(JSON.stringify).join('\n'))
  assert.equal((await readCodexActivity(codex, NOW))?.running, true)
  assert.equal((await readCommandCodeActivity(commandCode, NOW))?.running, false)
  assert.equal((await readCommandCodeActivity(commandCode, NOW, true))?.running, true)
})

test('native discovery bounds the candidate set before reading session contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-bounded-'))
  await Promise.all(Array.from({ length: 70 }, (_, index) => writeFile(join(root, `${String(index).padStart(2, '0')}.jsonl`), '{}\n')))
  assert.equal((await jsonlFiles(root)).length, 64)
})

test('native failures use explicit status, normalize volatile details, and never expose the key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-failures-'))
  const codex = join(root, 'codex.jsonl')
  const entries: object[] = [
    { timestamp: '2026-10-19T14:50:00.000Z', type: 'session_meta', payload: { id: 'failure-run' } },
    { timestamp: '2026-10-19T14:50:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build JUL-243: Dashboard A + B' }] } },
    { timestamp: '2026-10-19T14:51:00.000Z', type: 'response_item', payload: { type: 'function_call', call_id: 'ok', name: 'exec_command', arguments: '{"cmd":"npm test"}' } },
    { timestamp: '2026-10-19T14:51:01.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'ok', output: '{"exit_code":0,"output":"0 errors"}' } },
  ]
  for (let index = 1; index <= 3; index += 1) {
    entries.push(
      { timestamp: `2026-10-19T14:5${index + 1}:00.000Z`, type: 'response_item', payload: { type: 'function_call', call_id: `bad-${index}`, name: 'exec_command', arguments: '{"cmd":"npm test"}' } },
      { timestamp: `2026-10-19T14:5${index + 1}:01.000Z`, type: 'response_item', payload: { type: 'function_call_output', call_id: `bad-${index}`, output: `{"exit_code":1,"output":"Error: same assertion at 2026-10-19T14:5${index}:00.000Z after ${index * 10}ms"}` } },
    )
  }
  await writeFile(codex, entries.map(JSON.stringify).join('\n'))
  const activity = await readCodexActivity(codex, NOW)
  assert.equal(activity?.actions[0].outcome, 'succeeded')
  const card = projectAgentCards([activity!], NOW)[0]
  assert.equal(card.status, 'looks-stuck')
  assert.equal('failureKey' in card.actions.at(-1)!, false)
})

test('Looks stuck uses the settled inactivity and repeated-failure thresholds', () => {
  const inactive = projectAgentCards([record({ updatedAt: '2026-10-19T14:45:00.000Z', actions: [] })], NOW)[0]
  assert.equal(inactive.status, 'looks-stuck')
  assert.match(inactive.statusDetail, /no new action for 15 min/)

  const failures = [1, 2, 3].map(index => ({
    id: `failure-${index}`, occurredAt: `2026-10-19T14:5${index}:00.000Z`, label: 'Ran tests: 1 failed',
    outcome: 'failed' as const, failureKey: 'tests:private-recipe',
  }))
  const repeated = projectAgentCards([record({ actions: failures, updatedAt: failures[2].occurredAt })], NOW)[0]
  assert.equal(repeated.status, 'looks-stuck')
  assert.match(repeated.statusDetail, /same action failing the same way 3 times in a row/)
})

test('discovers native Codex and CommandCode JSONL plus supplied Mastra traces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-sources-'))
  const codex = join(root, 'codex.jsonl')
  const commandCode = join(root, 'commandcode.jsonl')
  await writeFile(codex, [
    { timestamp: '2026-10-19T14:58:00.000Z', type: 'session_meta', payload: { id: 'codex-native', cwd: '/work/JUL-243' } },
    { timestamp: '2026-10-19T14:58:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build JUL-243: Dashboard A + B' }] } },
    { timestamp: '2026-10-19T14:58:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'private follow-up must not become a title' }] } },
    { timestamp: '2026-10-19T14:59:00.000Z', type: 'response_item', payload: { type: 'function_call', call_id: 'call-1', name: 'exec_command', arguments: '{"cmd":"npm test"}' } },
    { timestamp: '2026-10-19T14:59:02.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: '3 passed' } },
  ].map(value => JSON.stringify(value)).join('\n'))
  await writeFile(commandCode, [
    { type: 'session', id: 'cc-native', timestamp: '2026-10-19T14:57:00.000Z' },
    { type: 'message', timestamp: '2026-10-19T14:57:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Build JUL-244' }] } },
    { type: 'message', timestamp: '2026-10-19T14:59:10.000Z', message: { role: 'assistant', model: 'deepseek-flash', content: [{ type: 'tool_use', id: 'tool-1', name: 'read', input: { path: 'app/page.jsx' } }] } },
  ].map(value => JSON.stringify(value)).join('\n'))

  const records = await discoverAgentActivity({
    codexFiles: [codex], commandCodeFiles: [commandCode], now: NOW,
    mastraTraces: [{ traceId: 'mastra-native', name: 'JUL-245 reviewer', startedAt: '2026-10-19T14:55:00.000Z',
      spans: [{ spanId: 'span-1', name: 'tool: test', spanType: 'TOOL_CALL', startedAt: '2026-10-19T14:59:20.000Z', status: 'success' }] }],
  })

  assert.deepEqual(records.map(item => item.source), ['codex', 'commandcode', 'mastra'])
  assert.equal(records[0].actions[0].label, 'Ran tests')
  assert.equal(records[0].cardTitle, 'Dashboard A + B')
  assert.equal(records[1].actions[0].label, 'Read a project file')
  assert.equal(records[2].sourceId, 'mastra-native')
})

test('retains Codex detail in the server database across a fresh store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-store-'))
  const storagePath = join(root, 'initialization.db')
  const first = await createAgentActivityStore(storagePath)
  await first.retain([record({ sourceId: 'codex-retained' })])
  await first.close()

  const reopened = await createAgentActivityStore(storagePath)
  const retained = await reopened.list()
  await reopened.close()
  assert.equal(retained.length, 1)
  assert.equal(retained[0].sourceId, 'codex-retained')
  assert.equal(retained[0].actions[0].label, 'Ran tests')
})

test('reads a real persisted Mastra workflow trace through the stock observability store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jul-243-mastra-'))
  const runtime = await createInitializationRuntime({ storagePath: join(root, 'initialization.db'), activity: createInitializationActivityRecorder() })
  const offer = { route: 'commandcode' as const, modelId: 'vendor/model', name: 'Model', company: 'Vendor', service: 'CommandCode', codingCapable: true as const, wire: 'chat' as const, supportedEfforts: ['low' as const] }
  const reviewer = { ...offer, modelId: 'other/model', company: 'Other' }
  const selection = (item: typeof offer) => ({ route: item.route, modelId: item.modelId, company: item.company, service: item.service, wire: item.wire, effort: 'low' as const })
  const card = { identifier: 'JUL-243', title: 'Dashboard A + B', state: 'Ready', description: `## Agent Brief
**Category:** Enhancement
**Summary:** Dashboard.
**Current behavior:** Missing.
**Desired behavior:** Present.
**Key interfaces:** Traces.
**Acceptance criteria:** Visible.
**Out of scope:** None.` }
  await runtime.start({ card, roles: { builder: selection(offer), reviewer: selection(reviewer), crashFixer: selection(offer), crashReviewer: selection(reviewer) } }, { cards: [{ admitted: true, card }], offers: [offer, reviewer] })
  const traces = await runtime.listMastraTraces()
  await runtime.close()
  assert.ok(traces.some(trace => trace?.spans.some(span => /WORKFLOW/i.test(span.spanType))))
})

test('the phone dashboard renders provider cards, activity, and both status labels', async t => {
  const cards = projectAgentCards([
    record({ sourceId: 'working' }),
    record({ source: 'commandcode', sourceId: 'stuck', updatedAt: '2026-10-19T14:40:00.000Z', actions: [] }),
  ], NOW)
  const server = await startControlPageServer({
    port: 0, getState: async () => ({ cards: [], offers: [{
      route: 'commandcode', modelId: 'vendor/model', name: 'Model', company: 'Vendor', service: 'CommandCode',
      codingCapable: true, wire: 'chat', supportedEfforts: ['low'],
    }] }) as never,
    startInitialization: async () => { throw new Error('not used') },
    getRuns: async () => ({ runs: [], totalRuns: 0 }),
    getActivity: () => createInitializationActivityRecorder().snapshot(),
    getAgentCards: async () => ({ updatedAt: NOW.toISOString(), cards }),
  })
  t.after(() => server.close())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors: string[] = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.url)
  await page.getByRole('heading', { name: "What's running now" }).waitFor()
  assert.equal(await page.locator('article.agent-card').count(), 2)
  assert.equal(await page.getByText('Working. Last action 1 min ago.').count(), 1)
  assert.equal(await page.getByText(/Looks stuck: no new action for 20 min/).count(), 1)
  assert.equal(await page.getByRole('heading', { name: 'What it actually did' }).count(), 2)
  assert.deepEqual(errors, [])
})
