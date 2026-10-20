import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, fork } from 'node:child_process'
import { promisify } from 'node:util'
import { once, EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from 'playwright/test'
import { Mastra } from '@mastra/core/mastra'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { LibSQLStore } from '@mastra/libsql'
import { z } from 'zod/v4'
import { createAgentActivityStore } from '../src/mastra/agent-activity.ts'
import { createCodexMonitor } from '../src/mastra/agent-codex-monitor.ts'
import { runMonitoredCommandCode } from '../src/mastra/agent-commandcode.ts'
import { monitorMastraStream } from '../src/mastra/agent-mastra.ts'

const run = promisify(execFile)
assert.ok(process.argv[2], 'supply evidence directory')
const evidence = resolve(process.argv[2])
await mkdir(evidence, { recursive: true })
const save = (name: string, value: unknown) => writeFile(join(evidence, name), JSON.stringify(value, null, 2)+'\n')
const candidate = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim()
const diff = (await run('git', ['diff', '--binary', 'HEAD'])).stdout
assert.equal(diff, '', 'commit candidate before proof')
await save('identity.json', { candidateCommit: candidate, dirtyTreeDigest: createHash('sha256').update(diff).digest('hex'), startedAt: new Date().toISOString(), node: process.version, codex: (await run('codex', ['--version'])).stdout.trim(), commandcode: (await run('command-code', ['--no-auto-update', '--version'])).stdout.trim() })
const root = await mkdtemp(join(tmpdir(), 'jul244-proof-'))
const database = join(evidence, 'agents.db')
const store = await createAgentActivityStore(database)
const storage = new LibSQLStore({ id: 'jul244-proof', url: `file:${join(evidence, 'mastra.db')}` })
await storage.init()
const signal = AbortSignal.timeout(240000)
const events = new EventEmitter()
const native: { method: string; params: unknown }[] = []
const monitor = await createCodexMonitor(store, { onNotification: async (method, params) => {
  const body = params as { item?: { type: string }; threadId?: string }
  if (['thread/tokenUsage/updated', 'turn/plan/updated'].includes(method) || body.item?.type === 'contextCompaction') { native.push({ method, params }) }
  events.emit(method, params)
} })
const browser = await chromium.launch()
const dashboard = fork(fileURLToPath(new URL('./jul-243-dashboard.ts', import.meta.url)), [database], { execArgv: ['--experimental-strip-types'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
dashboard.stdout?.resume(); dashboard.stderr?.resume()
const [message] = await once(dashboard, 'message', { signal })
const url = (message as { url: string }).url
const consoleErrors: string[] = []
const capture = async (name: string, title: string, check: (card: ReturnType<import('playwright/test').Page['locator']>) => Promise<void>) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', error => consoleErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  try {
    assert.equal((await page.goto(url))!.status(), 200)
    const card = page.locator('.agent-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    await expect(card).toBeVisible()
    await check(card)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: join(evidence, name+'.png'), fullPage: true })
    await save(name+'.json', { url, title, viewport: { width: 390, height: 844 }, body: await page.locator('main').innerText(), api: await (await fetch(url+'/api/agents')).json(), consoleErrors })
  } finally { await page.close() }
}
const meta = (launchId: string, provider: 'codex'|'commandcode'|'mastra', model: string) => ({ launchId, provider, cardIdentifier: 'JUL-244', cardTitle: `Dashboard C: ${launchId}`, role: 'Proof', model, stage: 'Proof', round: 1 })
let launch: Awaited<ReturnType<typeof monitor.launch>> | undefined
let turnId: string | undefined
let mastra: Mastra | undefined
let failure: unknown
try {
  const sandbox = await monitor.request('command/exec', { command: ['/usr/bin/printf', 'jul244-sandbox-ok'], cwd: root, sandboxPolicy: { type: 'workspaceWrite', writableRoots: [root], networkAccess: false }, timeoutMs: 10000 }) as { exitCode: number; stdout: string }
  assert.equal(sandbox.exitCode, 0); assert.equal(sandbox.stdout, 'jul244-sandbox-ok')
  await save('sandbox.json', sandbox)
  const models = await monitor.request('model/list', {}) as { data: { model: string; isDefault: boolean }[] }
  const model = models.data.find(item => item.isDefault)!.model
  launch = await monitor.launch(meta('codex', 'codex', model), { cwd: root, model, approvalPolicy: 'never', sandbox: 'workspace-write' })
  await capture('no-checklist', launch.cardTitle, async card => {
    await expect(card.getByText("No checklist: the agent didn't make one this time.", { exact: true })).toBeVisible()
    await expect(card.getByText('No compactions', { exact: true })).toBeVisible()
  })
  const planUpdated = once(events, 'turn/plan/updated', { signal })
  const tokensUpdated = once(events, 'thread/tokenUsage/updated', { signal })
  const completed = monitor.completed('codex', signal)
  const start = await monitor.request('turn/start', { threadId: launch.providerRunId, input: [{ type: 'text', text: 'This is a telemetry proof. Use update_plan to create exactly these two steps: Read proof brief (completed), Verify telemetry (in_progress). Then run exactly sleep 20 as a foreground shell command. Then use update_plan to mark both steps completed. Reply DONE. Do not read or change files, call other tools, or delegate.' }] }) as { turn: { id: string } }
  turnId = start.turn.id
  await planUpdated
  await tokensUpdated
  await capture('context-and-checklist', launch.cardTitle, async card => {
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /\d+/)
    await expect(card.getByText('✓ Read proof brief', { exact: true })).toBeVisible()
    await expect(card.getByText('□ Verify telemetry (working on)', { exact: true })).toBeVisible()
    await expect(card.getByText('Handoffs: unavailable', { exact: true })).toBeVisible()
  })
  await completed
  turnId = undefined
  await save('completed-checklist.json', await store.records())
  const compactionDone = once(events, 'turn/completed', { signal })
  const compacted = once(events, 'item/completed', { signal })
  await monitor.request('thread/compact/start', { threadId: launch.providerRunId })
  await compacted
  await compactionDone
  // A new real model turn exposes the retained compaction and records a no-checklist turn.
  const secondStarted = once(events, 'turn/started', { signal })
  const second = await monitor.request('turn/start', { threadId: launch.providerRunId, input: [{ type: 'text', text: 'Run exactly sleep 20 as a foreground shell command. Do not create a checklist, read/change files or delegate. Then reply DONE.' }] }) as { turn: { id: string } }
  turnId = second.turn.id
  await secondStarted
  const nextDone = monitor.completed('codex', signal)
  await capture('compaction-separate', launch.cardTitle, async card => {
    await expect(card.getByText(/1 compaction, /)).toBeVisible()
    await expect(card.getByText('Handoffs: unavailable', { exact: true })).toBeVisible()
  })
  await nextDone
  turnId = undefined
  const schema = z.object({})
  const free = 'poolside/laguna-s-2.1-free'
  const frames: unknown[] = []
  const step = createStep({ id: 'commandcode-telemetry', inputSchema: schema, outputSchema: z.object({ totalTokens: z.number() }), execute: async () => {
    const result = await runMonitoredCommandCode({ store, launch: { ...meta('commandcode', 'commandcode', free), providerRunId: 'unresolved:jul244-proof' }, model: free, cwd: root, prompt: 'Reply exactly OK. Do not call tools.', maxTurns: 1, signal, onFrame: async frame => { frames.push(frame) } })
    await save('commandcode.json', { result, frames })
    assert.equal(result.exitCode, 0); assert.equal(result.terminal, true)
    const usage = z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative() }).parse(result.usage)
    await capture('mastra-commandcode-unavailable', 'Dashboard C: mastra', async card => {
      for (const text of ['Context unavailable', 'Compactions: unavailable', 'Handoffs: unavailable', 'Checklist: unavailable']) await expect(card.getByText(text, { exact: true })).toBeVisible()
    })
    return { totalTokens: usage.inputTokens + usage.outputTokens }
  } })
  const workflow = createWorkflow({ id: 'jul244-real-workflow', inputSchema: schema, outputSchema: z.object({ totalTokens: z.number() }) }).then(step).commit()
  mastra = new Mastra({ storage, workflows: { workflow } })
  const workflowRun = await workflow.createRun()
  const stream = await workflowRun.stream({ inputData: {} })
  const result = await monitorMastraStream({ store, launch: { ...meta('mastra', 'mastra', free), providerRunId: workflowRun.runId }, stream, flush: async () => {} })
  assert.equal(result.status, 'success')
  await save('mastra.json', result)
  await save('native-telemetry.json', native)
  const tokens = native.filter(item => item.method === 'thread/tokenUsage/updated')
  assert.ok(tokens.length, 'real native token notifications required')
  const records = await store.records()
  assert.equal(records.find(record => record.source === 'commandcode')!.telemetry!.context, null)
  assert.equal(records.find(record => record.source === 'codex')!.telemetry!.compactions!.length, 1)
  assert.equal(records.find(record => record.source === 'codex')!.telemetry!.checklist!.length, 0)
  await save('records.json', records)
  const reopened = await createAgentActivityStore(database)
  try { assert.deepEqual(await reopened.records(), records); await save('reopened-records.json', await reopened.records()) } finally { reopened.close() }
  assert.deepEqual(consoleErrors, [])
} catch (error) { failure = error; console.error(error) }
finally {
  await save('native-telemetry.json', native)
  const errors: string[] = []
  const attempt = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(String(error)) } }
  if (turnId && launch) await attempt(() => monitor.request('turn/interrupt', { threadId: launch!.providerRunId, turnId }))
  await attempt(() => monitor.close())
  await attempt(() => mastra?.shutdown() ?? Promise.resolve()); await attempt(() => storage.close())
  await attempt(() => browser.close())
  await attempt(async () => { const exited = once(dashboard, 'exit', { signal: AbortSignal.timeout(15000) }); dashboard.kill('SIGTERM'); await exited })
  store.close()
  await attempt(() => rm(root, { recursive: true, force: true }))
  assert.equal(await readFile(join(evidence, 'identity.json'), 'utf8').then(text => JSON.parse(text).candidateCommit), candidate)
  await save('result.json', { ok: !failure && !errors.length, candidateCommit: candidate, exitCode: failure || errors.length ? 1 : 0, failure: failure ? String(failure) : null, consoleErrors, cleanupErrors: errors, dashboardExited: dashboard.exitCode !== null || dashboard.signalCode !== null, finishedAt: new Date().toISOString() })
  if (failure || errors.length) process.exitCode = 1
}
