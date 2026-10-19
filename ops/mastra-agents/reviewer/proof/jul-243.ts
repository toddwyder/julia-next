import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
import { Mastra } from '@mastra/core/mastra'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { SamplingStrategyType } from '@mastra/core/observability'
import { LibSQLStore } from '@mastra/libsql'
import { Observability, MastraStorageExporter } from '@mastra/observability'
import { z } from 'zod/v4'
import { createAgentActivityStore } from '../src/mastra/agent-activity.ts'
import { createCodexMonitor } from '../src/mastra/agent-codex-monitor.ts'
import { runMonitoredCommandCode } from '../src/mastra/agent-commandcode.ts'
import { monitorMastraStream } from '../src/mastra/agent-mastra.ts'
import { candidateIdentity, assertStableCandidateIdentity } from '../src/mastra/verify-machine.ts'

// Run only AFTER a passing Gemini candidate review. All dashboard rows come from live providers.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const evidence = resolve(process.argv[2] ?? join(repositoryRoot, '.artifacts/jul-243-round1-proof'))
await mkdir(evidence, { recursive: true })
const identity = await candidateIdentity()
const workspace = await mkdtemp(join(tmpdir(), 'jul-243-live-'))
const db = join(workspace, 'events.db')
const commandCode = process.env.JULIA_COMMANDCODE_BIN ?? 'command-code'
const commandCodeVersion = execFileSync(commandCode, ['--version'], { encoding: 'utf8' }).trim()
assert.equal(commandCodeVersion, '1.72.3')
const schemaDirectory = join(evidence, 'codex-schema')
execFileSync('codex', ['app-server', 'generate-json-schema', '--out', schemaDirectory])
const schemaHash = createHash('sha256').update(await readFile(join(schemaDirectory, 'codex_app_server_protocol.v2.schemas.json'))).digest('hex')
await writeFile(join(evidence, 'launch.json'), JSON.stringify({ identity, workspace, db, os: process.platform, node: process.version, commandCodeVersion, codexVersion: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(), schemaHash, sampling: 'always', persistent: true, daemon: JSON.parse(execFileSync('codex', ['app-server', 'daemon', 'version'], { encoding: 'utf8' })) }, null, 2))

async function serverProcess(stem: string) {
  const child = spawn(process.execPath, ['--experimental-strip-types', resolve(repositoryRoot, 'ops/mastra-agents/reviewer/src/mastra/control-server.ts')], { env: { ...process.env, JULIA_INITIALIZATION_DB: db, JULIA_CONTROL_PORT: '0', JULIA_CONTROL_OPEN_BROWSER: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = createWriteStream(join(evidence, `${stem}.log`))
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
  const url = await new Promise<string>((resolveReady, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGTERM'); log.end(); reject(new Error('Candidate dashboard startup timed out')) }, 30000)
    child.once('error', reject)
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Candidate dashboard exited ${code} before ready`)) })
    createInterface({ input: child.stdout }).on('line', line => {
      try { const value = JSON.parse(line); if (value.status === 'ready') { clearTimeout(timeout); resolveReady(value.url) } } catch {}
    })
  })
  await writeFile(join(evidence, `${stem}-process.json`), JSON.stringify({ identity, pid: child.pid, url, executable: process.execPath }))
  let closed = false
  return { url, async close() { if (closed) return; closed = true; const exited = once(child, 'exit'); child.kill('SIGTERM'); const [code] = await exited; log.end(); assert.equal(code, 0) } }
}
async function port() {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening')
  const address = listener.address(); assert.ok(address && typeof address !== 'string')
  const selected = address.port; await new Promise<void>(resolveClose => listener.close(() => resolveClose())); return selected
}
const codexPort = await port(); const commandPort = await port()
const barrier = join(workspace, 'barrier.cjs')
await writeFile(barrier, "const http=require('node:http');const server=http.createServer((req,res)=>{res.end(req.url==='/release'?'released':'ready');if(req.url==='/release')server.close()});server.listen(Number(process.argv[2]),'127.0.0.1');setTimeout(()=>{server.close();process.exitCode=1},90000).unref();")
const cleanup: Array<() => Promise<unknown>> = []
function retainCleanup(action: () => Promise<unknown>) { let closed = false; const close = async () => { if (closed) return; closed = true; await action() }; cleanup.push(close); return close }
let passed = false
let failed = false
let failuresObserved = 0
try {
let dashboard = await serverProcess('before-restart')
let closeDashboard = retainCleanup(() => dashboard.close())
let store = await createAgentActivityStore(db)
let closeStore = retainCleanup(async () => store.close())
const monitor = await createCodexMonitor(store)
const closeMonitor = retainCleanup(() => monitor.close())
const selectedModels = z.object({ data: z.array(z.object({ id: z.string(), model: z.string(), isDefault: z.boolean() })) }).parse(await monitor.request('model/list', {}))
const model = selectedModels.data.find(item => item.isDefault)?.model
assert.ok(model, 'Official model/list must identify the installed default')
const round = Number(process.env.JULIA_REVIEW_ROUND ?? 1)
assert.ok(round === 1 || round === 2, 'Only two authorized rounds')
const prefix = `jul-243-${randomUUID()}`
const metadata = { cardIdentifier: 'JUL-243', cardTitle: 'Julia-monitored agent runs', role: 'Proof', stage: 'Proof', round }
const commandLaunch = { ...metadata, launchId: `${prefix}-commandcode`, provider: 'commandcode' as const, providerRunId: `unresolved:${prefix}-commandcode`, model: 'deepseek/deepseek-v4-flash' }
let failures = 0
let ready!: () => void
const commandReady = new Promise<void>(resolveReady => { ready = resolveReady })
const unsubscribe = store.subscribe(event => {
  if (event.launchId !== commandLaunch.launchId) return
  if (event.kind === 'action-completed' && event.action?.outcome === 'failed') failures++
  if (failures >= 3 && event.kind === 'action-started') ready()
})
const commandAbort = new AbortController()
const commandRun = runMonitoredCommandCode({ signal: commandAbort.signal, store, launch: commandLaunch, executable: commandCode, cwd: workspace, maxTurns: 6, allowTools: true, prompt: `This is an authorized short lifecycle proof. Make exactly THREE separate sequential shell_command calls with command pwd and cwd ${workspace}/does-not-exist. Those failures are deliberate; do not repair or retry beyond those three. Then make ONE shell_command call with command node ${barrier} ${commandPort}, timeout 90000, run_in_background false. Wait for that command to finish, then reply DONE. Do not use other tools.` })
retainCleanup(async () => { commandAbort.abort(); await commandRun.catch(() => {}) })
await Promise.race([commandReady, commandRun.then(() => { throw new Error('CommandCode ended before three explicit failures and pending action') }), new Promise<never>((_, reject) => { const timeout = setTimeout(() => reject(new Error('CommandCode did not reach the controlled pending action within 60 seconds')), 60000); timeout.unref() })])
unsubscribe()
const codexLaunch = await monitor.launch({ ...metadata, launchId: `${prefix}-codex`, provider: 'codex', model }, { cwd: workspace, model })
const codexDone = monitor.completed(codexLaunch.launchId)
await monitor.request('turn/start', { threadId: codexLaunch.providerRunId, input: [{ type: 'text', text: `Run node ${barrier} ${codexPort} as a foreground command. Wait until it finishes, then reply DONE. This is an authorized short lifecycle proof; use no other tools.` }] })
let releaseMastra!: () => void
const barrierPromise = new Promise<void>(resolveBarrier => { releaseMastra = resolveBarrier })
const empty = z.object({})
const step = createStep({ id: 'controlled-barrier', inputSchema: empty, outputSchema: empty, execute: async () => { await barrierPromise; return {} } })
const workflow = createWorkflow({ id: 'jul-243-proof', inputSchema: empty, outputSchema: empty }).then(step).commit()
const storage = new LibSQLStore({ id: 'jul-243-proof', url: `file:${db}` })
const observability = new Observability({ configs: { default: { serviceName: 'jul-243-proof', sampling: { type: SamplingStrategyType.ALWAYS }, exporters: [new MastraStorageExporter()] } } })
const mastra = new Mastra({ storage, workflows: { workflow }, observability })
const closeMastra = retainCleanup(async () => { releaseMastra(); await observability.shutdown(); await mastra.shutdown() })
const traceId = randomUUID().replaceAll('-', '')
const run = await mastra.getWorkflow('workflow').createRun()
const mastraLaunch = { ...metadata, launchId: `${prefix}-mastra`, provider: 'mastra' as const, providerRunId: run.runId, model: 'Workflow' }
let allReady!: () => void
const allRunning = new Promise<void>(resolveReady => { allReady = resolveReady })
const stopListening = store.subscribe(() => { void store.cards().then(cards => { if (cards.length === 3 && cards.some(card => card.source === 'codex') && cards.some(card => card.source === 'mastra')) allReady() }) })
const mastraRun = monitorMastraStream({ store, launch: mastraLaunch, stream: run.stream({ inputData: {}, tracingOptions: { traceId, metadata: mastraLaunch } }), flush: () => observability.flush() })
await Promise.race([allRunning, new Promise<never>((_, reject) => { const timeout = setTimeout(() => reject(new Error('Three providers did not become live within 30 seconds')), 30000); timeout.unref() })]); stopListening()
const browser = await chromium.launch()
const closeBrowser = retainCleanup(() => browser.close())
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const consoleErrors: string[] = []
  page.on('pageerror', error => consoleErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  assert.equal((await page.goto(dashboard.url))!.status(), 200)
  await page.locator('.agent-card').nth(2).waitFor()
  for (const pendingPort of [commandPort, codexPort]) await expect.poll(async () => fetch(`http://127.0.0.1:${pendingPort}/ready`).then(response => response.status).catch(() => 0), { timeout: 20000 }).toBe(200)
  const state = await (await fetch(`${dashboard.url}/api/agents`)).json()
  assert.deepEqual(state.cards.map((card: { source: string }) => card.source).sort(), ['codex', 'commandcode', 'mastra'])
  assert.ok(state.cards.some((card: { status: string }) => card.status === 'working'))
  assert.ok(state.cards.some((card: { status: string }) => card.status === 'looks-stuck'))
  assert.equal(await page.locator('.activity-time').evaluateAll(elements => elements.every(element => { const range = document.createRange(); range.selectNodeContents(element); return range.getClientRects().length === 1 })), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(consoleErrors, [])
  await page.screenshot({ path: join(evidence, 'dashboard-390.png'), fullPage: true })
  await writeFile(join(evidence, 'browser.json'), JSON.stringify({ identity, state, consoleErrors, http: 200, viewport: 390, noWrapping: true, noOverflow: true }, null, 2))
  for (const releasePort of [commandPort, codexPort]) assert.equal((await fetch(`http://127.0.0.1:${releasePort}/release`)).status, 200)
  releaseMastra()
  const [commandResult, [codexResult], mastraResult] = await Promise.all([commandRun, codexDone, mastraRun])
  assert.equal(commandResult.exitCode, 0); assert.equal(codexResult.kind, 'run-completed'); assert.equal(mastraResult.status, 'success')
  const usage = z.object({ inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number(), cacheWriteTokens: z.number() }).parse(commandResult.usage)
  const estimatedUsd = usage.cacheWriteTokens === 0 ? ((usage.inputTokens - usage.cacheReadTokens) * 0.15 + usage.cacheReadTokens * 0.003 + usage.outputTokens * 0.60) / 1_000_000 : null
  await writeFile(join(evidence, 'commandcode-cost.json'), JSON.stringify({ usage, estimatedUsd, billingCost: null, priceSource: 'https://commandcode.ai/docs/resources/pricing-limits', priceChecked: '2026-10-19', model: commandLaunch.model, note: 'Published off-peak token-price estimate; native CLI does not expose the billed USD charge.' }, null, 2))
  await page.reload(); assert.deepEqual((await (await fetch(`${dashboard.url}/api/agents`)).json()).cards, [])
  await closeBrowser(); await closeMonitor(); await closeMastra(); await closeDashboard(); await closeStore()
  dashboard = await serverProcess('after-restart'); closeDashboard = retainCleanup(() => dashboard.close())
  store = await createAgentActivityStore(db); closeStore = retainCleanup(async () => store.close())
  assert.deepEqual((await (await fetch(`${dashboard.url}/api/agents`)).json()).cards, [])
  const histories = await Promise.all([commandLaunch, codexLaunch, mastraLaunch].map(async launch => ({ launchId: launch.launchId, events: await store.history(launch.launchId) })))
  for (const history of histories) assert.ok(history.events.length > 1)
  const reopened = new LibSQLStore({ id: 'jul-243-readback', url: `file:${db}` })
  try { const traces = await reopened.getStore('observability'); const trace = await traces!.getTrace({ traceId }); assert.ok(trace!.spans.some(span => span.entityId === 'controlled-barrier')) } finally { await reopened.close() }
  await writeFile(join(evidence, 'retained-events.json'), JSON.stringify({ identity, traceId, histories }, null, 2))
  assertStableCandidateIdentity(identity, await candidateIdentity())
  failuresObserved = failures
  passed = true
}

} catch (error) {
  failed = true
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ identity, verdict: 'FAIL', error: error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownError' } }, null, 2))
  throw error
} finally {
  const cleanupErrors: string[] = []
  for (const close of cleanup.reverse()) { try { await close() } catch (error) { cleanupErrors.push(error instanceof Error ? error.name + ': ' + error.message : 'Unknown cleanup error') } }
  await writeFile(join(evidence, 'cleanup.json'), JSON.stringify({ identity, cleanupErrors, evidenceRetained: true }, null, 2))
  if (cleanupErrors.length && !failed) { await writeFile(join(evidence, 'result.json'), JSON.stringify({ identity, verdict: 'FAIL', cleanupErrors }, null, 2)); throw new Error('Proof cleanup failed') }
}

if (passed) {
  assertStableCandidateIdentity(identity, await candidateIdentity())
  const browserReadback = JSON.parse(await readFile(join(evidence, 'browser.json'), 'utf8'))
  assert.deepEqual(browserReadback.identity, identity)
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ identity, verdict: 'PASS', failures: failuresObserved, retainedRuns: 3, dashboardRestarted: true, completedCards: 0, cleanupPassed: true }, null, 2))
  console.log(JSON.stringify({ verdict: 'PASS', identity, evidence }))
}
