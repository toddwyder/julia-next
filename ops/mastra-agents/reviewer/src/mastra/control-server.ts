import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ControlPageStateSchema } from './contracts.ts'
import { startControlPageServer } from './control-page.ts'
import { createBuildRunnerClient } from './build-client.ts'
import { createInitializationRuntime } from './initialization.ts'
import { createInitializationActivityRecorder, createObservedLinearClient } from './initialization-observability.ts'
import { listReadyLinearCards } from './linear.ts'
import { discoverAcpOffers, discoverCommandCodeOffers, withAcpRoutes } from './routes.ts'
import { stockSubscriptionOffers } from '../../../../build-runner/connections.mjs'
import { createAgentActivityStore } from './agent-activity.ts'
import { createCodexMonitor } from './agent-codex-monitor.ts'
import { agentError } from './agent-errors.ts'

const CONTROL_PORT = 43123

function requiredSecret(name: 'LINEAR_API_KEY' | 'COMMANDCODE_API_KEY') {
  const value = process.env[name]
  if (!value) throw new Error(`${name} was not resolved by the restricted Julia vault launcher`)
  return value
}

type InitializationActivityRecorder = ReturnType<typeof createInitializationActivityRecorder>

export async function discoverControlPageState(activity: InitializationActivityRecorder) {
  const linearKey = requiredSecret('LINEAR_API_KEY')
  const commandCodeKey = requiredSecret('COMMANDCODE_API_KEY')
  const linear = createObservedLinearClient(linearKey, activity)
  const cardsPromise = listReadyLinearCards(linear, trace => console.log(JSON.stringify(trace)))
  const offersPromise = withAcpRoutes(async routes => {
    const [acp, commandCode, stock] = await Promise.all([
      discoverAcpOffers(routes, trace => console.log(JSON.stringify(trace))),
      discoverCommandCodeOffers(commandCodeKey, fetch, trace => console.log(JSON.stringify(trace))),
      stockSubscriptionOffers(),
    ])
    const stockKeys = new Set(stock.map(offer => `${offer.route}::${offer.modelId}`))
    const offers = [
      ...acp.filter(offer => !stockKeys.has(`${offer.route}::${offer.modelId}`)),
      ...commandCode,
      ...stock,
    ]
    console.log(JSON.stringify({ event: 'model-discovery-completed', offerCount: offers.length, routes: [...new Set(offers.map(offer => offer.route))] }))
    return offers
  })
  const [cards, offers] = await Promise.all([cardsPromise, offersPromise])
  return ControlPageStateSchema.parse({ cards, offers })
}

function openDefaultBrowser(url: string) {
  if (process.platform !== 'win32') return
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url.replaceAll("'", "''")}'`], {
    windowsHide: true,
    stdio: 'ignore',
  })
  child.unref()
}

export function shouldOpenControlBrowser(environment: NodeJS.ProcessEnv = process.env) {
  return environment.JULIA_CONTROL_OPEN_BROWSER !== '0'
}

// The operator who configures Tailscale Serve on this host sets its tailnet DNS
// name here (JUL-242). Unset means loopback only: the page still refuses a
// Serve-routed request rather than guessing a name.
export function configuredTailscaleHosts(environment: NodeJS.ProcessEnv = process.env) {
  return (environment.JULIA_CONTROL_TAILSCALE_HOST ?? '').split(',').map(name => name.trim()).filter(Boolean)
}

export async function runControlPageServer({ port = Number(process.env.JULIA_CONTROL_PORT ?? CONTROL_PORT), storagePath = process.env.JULIA_INITIALIZATION_DB ?? join(homedir(), '.julia', 'initialization.db') }: { port?: number; storagePath?: string } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid Julia control port')
  const tailscaleHosts = configuredTailscaleHosts()
  const activity = createInitializationActivityRecorder(event => console.log(JSON.stringify(event)))
  const runtime = await createInitializationRuntime({ storagePath, activity })
  const agentStore = await createAgentActivityStore(storagePath)
  let latestState = await discoverControlPageState(activity)
  await agentStore.disconnectActive('service-restart')
  let codexMonitor: Awaited<ReturnType<typeof createCodexMonitor>> | undefined
  if ((await agentStore.launches()).some(launch => launch.provider === 'codex')) {
    try { codexMonitor = await createCodexMonitor(agentStore, { socketPath: process.env.JULIA_CODEX_SOCKET }) }
    catch (error) { console.error(JSON.stringify(agentError(error, { provider: 'codex', runId: 'connection', eventKind: 'connect-failed' }))) }
  }
  const buildRunner = process.env.JULIA_BUILD_RUNNER_URL
    ? createBuildRunnerClient(process.env.JULIA_BUILD_RUNNER_URL)
    : undefined
  const server = await startControlPageServer({
    port,
    tailscaleHosts,
    getState: async () => { latestState = await discoverControlPageState(activity); return latestState },
    getRuns: () => runtime.list(),
    getActivity: () => activity.snapshot(),
    getAgentCards: async () => ({ updatedAt: new Date().toISOString(), cards: await agentStore.cards() }),
    getBuildJobs: () => buildRunner ? buildRunner.list() : Promise.resolve([]),
    startInitialization: async input => {
      latestState = await discoverControlPageState(activity)
      const result = await runtime.start(input, latestState)
      console.log(JSON.stringify({ event: 'initialization-ready-for-build', card: input.card.identifier, runId: result.runId, resumed: result.resumed, state: result.state }))
      if (buildRunner) {
        const build = await buildRunner.start(result)
        return { ...result, build }
      }
      return result
    },
    onRequest: request => console.log(JSON.stringify({ event: 'control-page-request', ...request })),
  })
  console.log(JSON.stringify({ status: 'ready', url: server.url, storage: storagePath, tailscaleHosts }))
  if (shouldOpenControlBrowser()) openDefaultBrowser(server.url)
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await server.close()
    await codexMonitor?.close()
    await agentStore.close()
    await runtime.close()
  }
  process.once('SIGINT', () => { close().then(() => process.exit(0), error => { console.error(error); process.exit(1) }) })
  process.once('SIGTERM', () => { close().then(() => process.exit(0), error => { console.error(error); process.exit(1) }) })
  return { ...server, close }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runControlPageServer().catch(error => { console.log(JSON.stringify({ event: 'control-page-fatal', error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1 })
}
