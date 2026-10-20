import assert from 'node:assert/strict'
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from 'playwright/test'
import { Mastra } from '@mastra/core/mastra'
import { createWorkflow, createStep } from '@mastra/core/workflows'
import { SamplingStrategyType } from '@mastra/core/observability'
import { LibSQLStore } from '@mastra/libsql'
import { Observability, MastraStorageExporter } from '@mastra/observability'
import { z } from 'zod/v4'
import { createAgentActivityStore } from '../src/mastra/agent-activity.ts'
import { createCodexMonitor } from '../src/mastra/agent-codex-monitor.ts'
import { runMonitoredCommandCode } from '../src/mastra/agent-commandcode.ts'
import { monitorMastraStream } from '../src/mastra/agent-mastra.ts'
import { cleanupProof } from '../src/mastra/agent-proof-cleanup.ts'
import { agentError } from '../src/mastra/agent-errors.ts'

const run = promisify(execFile)
const evidence = resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], 'supply an absolute evidence directory')
await mkdir(evidence, { recursive: true })
const save = (name: string, value: unknown) => writeFile(join(evidence, name), JSON.stringify(value, null, 2) + '\n')
const tasks: Promise<unknown>[] = []
const cancel: (() => Promise<unknown>)[] = []
const flush: (() => Promise<unknown>)[] = []
const close: (() => Promise<unknown>)[] = []
const own = <T>(task: Promise<T>) => {
  // A referenced deadline also keeps Node alive until this owned task settles.
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Owned Proof task exceeded 20 minutes')), 1200000) })
  const bounded = Promise.race([task, deadline]).finally(() => clearTimeout(timer))
  bounded.catch(() => {}); tasks.push(bounded); return bounded
}
const meta = (launchId: string, provider: 'codex' | 'mastra' | 'commandcode', model: string) => ({ launchId, provider, cardIdentifier: 'JUL-243', cardTitle: `Dashboard Proof: ${launchId}`, role: 'Proof', model, stage: 'Proof', round: 2 })
let failure: string | undefined
let passed = false
let candidate = ''
try {
  candidate = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const diff = (await run('git', ['diff', '--binary', 'HEAD'])).stdout
  assert.equal(diff, '', 'commit the complete candidate before Proof')
  const untracked = (await run('git', ['ls-files', '--others', '--exclude-standard'])).stdout.split('\n').filter(path => path && !path.startsWith('.artifacts/'))
  assert.deepEqual(untracked, [], 'untracked source makes candidate identity incomplete')
  const versions = await Promise.all([run('codex', ['--version']), run('command-code', ['--no-auto-update', '--version'])])
  await save('identity.json', { candidate, dirtyTreeDigest: createHash('sha256').update(diff).digest('hex'), startedAt: new Date().toISOString(), codex: versions[0].stdout.trim(), commandcode: versions[1].stdout.trim(), commandcodeCreditObservation: '$5 extra credits; Todd approved documented free model at $0 spend', approvalPolicy: 'never', sandbox: 'workspaceWrite' })
  const workspace = await mkdtemp(join(tmpdir(), 'jul243-current-proof-'))
  close.push(() => rm(workspace, { recursive: true, force: true }))
  const database = join(evidence, 'agents.db')
  const store = await createAgentActivityStore(database)
  close.push(async () => store.close())
  const storage = new LibSQLStore({ id: 'jul243-proof', url: `file:${join(evidence, 'mastra.db')}` })
  await storage.init()
  close.unshift(async () => storage.close())
  const observation = new Observability({ configs: { default: { serviceName: 'jul243-proof', sampling: { type: SamplingStrategyType.ALWAYS }, exporters: [new MastraStorageExporter()] } } })
  const schema = z.object({})
  const pause = createStep({ id: 'work-then-pause', inputSchema: schema, outputSchema: schema, suspendSchema: schema, execute: async ({ suspend, abortSignal }) => { await delay(3000, undefined, { signal: abortSignal }); return suspend({}) } })
  const workflow = createWorkflow({ id: 'jul243-real-proof', inputSchema: schema, outputSchema: schema }).then(pause).commit()
  const mastra = new Mastra({ storage, observability: observation, workflows: { workflow } })
  const observer = observation.getDefaultInstance()!
  flush.push(() => observer.flush())
  close.unshift(() => mastra.shutdown())
  const monitor = await createCodexMonitor(store)
  close.unshift(() => monitor.close())
  const models = await monitor.request('model/list', {}) as { data: { model: string; isDefault: boolean }[] }
  const model = models.data.find(item => item.isDefault)!.model
  const policy = { cwd: workspace, model, approvalPolicy: 'never', sandbox: 'workspace-write' }
  const sandbox = await monitor.request('command/exec', { command: ['/usr/bin/printf', 'sandbox-before-model'], cwd: workspace, sandboxPolicy: { type: 'workspaceWrite', writableRoots: [workspace], networkAccess: false }, timeoutMs: 10000 }) as { exitCode: number; stdout: string }
  assert.equal(sandbox.exitCode, 0)
  assert.equal(sandbox.stdout, 'sandbox-before-model')
  await save('sandbox.json', sandbox)
  let dashboard: ReturnType<typeof fork> | undefined
  let dashboardUrl = ''
  const stopDashboard = async () => { if (dashboard && dashboard.exitCode === null) { const exited = once(dashboard, 'exit', { signal: AbortSignal.timeout(15000) }); dashboard.kill('SIGTERM'); await exited } }
  close.unshift(stopDashboard)
  const startDashboard = async () => {
    dashboard = fork(fileURLToPath(new URL('./jul-243-dashboard.ts', import.meta.url)), [database], { execArgv: ['--experimental-strip-types'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    dashboard.stdout?.resume(); dashboard.stderr?.resume()
    const [message] = await once(dashboard, 'message', { signal: AbortSignal.timeout(30000) })
    dashboardUrl = (message as { url: string }).url
  }
  await startDashboard()
  const browser = await chromium.launch()
  close.unshift(() => browser.close())
  const consoleErrors: string[] = []
  const capture = async (name: string) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('pageerror', error => consoleErrors.push(error.message))
    try {
      assert.equal((await page.goto(dashboardUrl))!.status(), 200)
      await page.locator('.agent-card').first().waitFor()
      const expected: Record<string, [string, string]> = {
        'commandcode-working': ['commandcode', 'Working'], 'mastra-working': ['mastra', 'Working'],
        'codex-three-failures': ['codex-failures', 'Stopped'], 'mastra-paused': ['mastra', 'Stopped'],
        'dying-stopped': ['dying', 'Stopped'], 'idle-stopped': ['idle', 'Stopped'],
        'long-wait-after-fifteen-minutes': ['long-wait', 'Working'],
      }
      if (expected[name]) {
        const [id, label] = expected[name]
        await expect(page.locator('.agent-card').filter({ has: page.getByRole('heading', { name: `Dashboard Proof: ${id}`, exact: true }) }).locator('.agent-status')).toContainText(label)
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true })
      await save(`${name}.json`, await (await fetch(`${dashboardUrl}/api/agents`)).json())
      assert.deepEqual(consoleErrors, [])
    } finally { await page.close() }
  }
  const observations: Promise<unknown>[] = []
  const observe = (name: string) => { observations.push(own(capture(name))) }
  let commandcodeWorking = false
  let repeatedFailureSeen = false
  let mastraWorking = false
  store.subscribe(async event => {
    const cards = await store.cards()
    if (event.launchId === 'commandcode' && !commandcodeWorking && cards.some(card => card.agentId === 'commandcode:commandcode' && card.status === 'working')) { commandcodeWorking = true; observe('commandcode-working') }
    if (event.launchId === 'mastra' && !mastraWorking && cards.some(card => card.agentId === 'mastra:mastra' && card.status === 'working')) { mastraWorking = true; observe('mastra-working') }
    if (event.launchId === 'codex-failures' && !repeatedFailureSeen && cards.some(card => card.agentId === 'codex:codex-failures' && card.status === 'stopped')) { repeatedFailureSeen = true; observe('codex-three-failures') }
  })
  const idle = await monitor.launch(meta('idle', 'codex', model), policy)
  const idleStarted = Date.now()
  await save('idle-native-start.json', await monitor.request('thread/read', { threadId: idle.providerRunId }))
  const long = await monitor.launch(meta('long-wait', 'codex', model), policy)
  const longDone = own(monitor.completed(long.launchId))
  const startTurn = async (threadId: string, prompt: string) => {
    const result = await monitor.request('turn/start', { threadId, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [workspace], networkAccess: false }, input: [{ type: 'text', text: prompt }] }) as { turn: { id: string } }
    cancel.push(() => monitor.request('turn/interrupt', { threadId, turnId: result.turn.id }))
    return result
  }
  await startTurn(long.providerRunId, 'Execute sleep 920 in the foreground. Keep waiting for it until it finishes. A long wait is the entire task. Do not create files, run anything else, delegate, or request approval. Then reply done.')
  let finished = false
  longDone.then(() => { finished = true }, () => { finished = true })
  let longAfterFifteenMinutes = false
  const samples: { at: string; status: string; runningActions: number }[] = []
  const longSampling = own(expect.poll(async () => {
    const card = (await store.cards()).find(card => card.agentId === 'codex:long-wait')
    if (card) samples.push({ at: new Date().toISOString(), status: card.status, runningActions: card.actions.filter(action => action.phase === 'running').length })
    await save('long-wait-samples.json', samples)
    if (Date.now() - idleStarted >= 900000) {
      assert.equal((await store.cards()).find(card => card.agentId === 'codex:idle')!.status, 'stopped')
      if (!longAfterFifteenMinutes) { longAfterFifteenMinutes = true; await capture('long-wait-after-fifteen-minutes') }
    }
    return finished
  }, { timeout: 1050000, intervals: [1000] }).toBe(true))
  const mastraRun = await mastra.getWorkflow('workflow').createRun()
  cancel.push(() => mastraRun.cancel())
  const traceId = randomUUID().replaceAll('-', '')
  const mastraTask = own(monitorMastraStream({ store, launch: { ...meta('mastra', 'mastra', 'workflow'), providerRunId: mastraRun.runId }, stream: mastraRun.stream({ inputData: {}, tracingOptions: { traceId } }), flush: () => observer.flush() }))
  const ccFrames: unknown[] = []
  const ccAbort = new AbortController()
  cancel.push(async () => ccAbort.abort())
  const ccTask = own(runMonitoredCommandCode({ store, launch: { ...meta('commandcode', 'commandcode', 'poolside/laguna-s-2.1-free'), providerRunId: 'unresolved:commandcode' }, model: 'poolside/laguna-s-2.1-free', prompt: 'Reply exactly OK. Do not call tools.', cwd: workspace, maxTurns: 1, signal: ccAbort.signal, onFrame: async frame => { ccFrames.push(frame) } }))
  const failures = await monitor.launch(meta('codex-failures', 'codex', model), policy)
  const failuresDone = own(monitor.completed(failures.launchId))
  await startTurn(failures.providerRunId, 'Call the command execution tool exactly three times sequentially, with the exact command sh -c \'exit 7\' and the same working directory each time. All three commands must really run and fail. Do not combine them into one command, replace the command, add other commands, delegate or request approval. After the third failure reply done.')
  const ccResult = await ccTask
  await save('commandcode-native.json', { version: '1.84.0', result: ccResult, frames: ccFrames, freeTariff: '$0 input/output/cache per installed models.md', actualExtraCreditBalance: 5, authorizedSpend: 0 })
  assert.equal(ccResult.exitCode, 0)
  assert.equal(commandcodeWorking, true)
  assert.equal((await store.records()).find(record => record.sourceId === 'commandcode')!.state, 'finished')
  assert.equal((await mastraTask).status, 'suspended')
  assert.equal(mastraWorking, true)
  assert.equal((await store.cards()).find(card => card.agentId === 'mastra:mastra')!.status, 'stopped')
  await capture('mastra-paused')
  await failuresDone
  const failureTurns = await monitor.request('thread/turns/list', { threadId: failures.providerRunId, limit: 100, itemsView: 'full' }) as { data: { items: { type: string; command?: string; exitCode?: number; status?: string }[] }[] }
  const failureCommands = failureTurns.data.flatMap(turn => turn.items).filter(item => item.type === 'commandExecution').map(item => ({ command: item.command, exitCode: item.exitCode, status: item.status }))
  await save('codex-native-failure-commands.json', failureCommands)
  assert.equal(failureCommands.length, 3)
  assert.equal(failureCommands.every(item => item.exitCode === 7 && item.command === failureCommands[0].command), true)
  assert.equal(repeatedFailureSeen, true)
  let killed = false
  let pid = 0
  const dyingFrames: unknown[] = []
  const dying = await own(runMonitoredCommandCode({ store, launch: { ...meta('dying', 'commandcode', 'poolside/laguna-s-2.1-free'), providerRunId: 'unresolved:dying' }, model: 'poolside/laguna-s-2.1-free', prompt: 'Reply exactly OK. Do not call tools.', cwd: workspace, maxTurns: 1, onSpawn: value => { pid = value }, onFrame: async raw => { dyingFrames.push(raw); const frame = raw as { event?: { type: string } }; if (!killed && frame.event?.type === 'model_request_start') { killed = true; process.kill(pid, 'SIGKILL') } } }))
  assert.equal(killed, true)
  assert.equal(dying.exitCode, null)
  assert.equal((await store.cards()).find(card => card.agentId === 'commandcode:dying')!.status, 'stopped')
  await save('dying.json', { pid, killed, result: dying, nativeFrames: dyingFrames, history: await store.history('dying') })
  await capture('dying-stopped')
  await longSampling
  assert.equal(samples.length > 0, true)
  assert.equal(samples.every(sample => sample.status === 'working'), true)
  assert.equal(samples.some(sample => sample.runningActions > 0), true)
  assert.equal(Date.now() - idleStarted >= 900000, true)
  await save('idle-after-fifteen-minutes.json', { elapsedMs: Date.now() - idleStarted, cards: await store.cards(), native: await monitor.request('thread/read', { threadId: idle.providerRunId }) })
  await capture('idle-stopped')
  const history = await store.history(long.launchId)
  assert.equal(history.some(event => event.kind === 'action-started'), true)
  assert.equal(history.at(-1)?.kind === 'run-completed' || history.at(-1)?.kind === 'unknown', true)
  await save('long-wait-history.json', history)
  const longTurns = await monitor.request('thread/turns/list', { threadId: long.providerRunId, limit: 100, itemsView: 'full' }) as { data: { items: { type: string; command?: string; exitCode?: number; status?: string }[] }[] }
  const longCommands = longTurns.data.flatMap(turn => turn.items).filter(item => item.type === 'commandExecution').map(item => ({ command: item.command, exitCode: item.exitCode, status: item.status }))
  await save('codex-native-long-commands.json', longCommands)
  assert.equal(longCommands.some(item => item.command?.includes('sleep 920') && item.exitCode === 0), true)
  await observer.flush()
  const traces = await storage.getStore('observability')
  const trace = await traces!.getTrace({ traceId })
  assert.ok(trace, 'real Mastra trace must be persisted')
  await save('mastra-trace.json', trace)
  const before = await store.history('commandcode')
  await stopDashboard()
  await startDashboard()
  await capture('dashboard-after-restart')
  assert.deepEqual(await store.history('commandcode'), before)
  assert.equal((await store.cards()).some(card => ['codex:long-wait', 'commandcode:commandcode'].includes(card.agentId)), false)
  await save('retained-history.json', { commandcode: before, mastra: await store.history('mastra'), cards: await store.cards(), consoleErrors })
  assert.equal((await run('git', ['rev-parse', 'HEAD'])).stdout.trim(), candidate)
  assert.equal((await run('git', ['diff', '--binary', 'HEAD'])).stdout, '')
  await Promise.all(observations)
  passed = true
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  await save('failure.json', agentError(error, { provider: 'proof', runId: candidate, eventKind: 'journey-failed' }))
} finally {
  const cleanup = await cleanupProof({ path: join(evidence, 'cleanup.json'), tasks, cancel, flush, close, failure })
  await save('result.json', { ok: passed && cleanup.ok, candidate, failure: failure ?? null, cleanup: cleanup.ok, cost: 0, modelFunding: 'Codex existing sign-in; CommandCode documented free model; no purchases', finishedAt: new Date().toISOString() })
  if (!passed || !cleanup.ok) process.exitCode = 1
}
