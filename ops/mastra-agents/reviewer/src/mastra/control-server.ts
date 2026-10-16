import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ControlPageStateSchema } from './contracts.ts'
import { startControlPageServer } from './control-page.ts'
import { createInitializationRuntime } from './initialization.ts'
import { listReadyLinearCards } from './linear.ts'
import { discoverAcpOffers, discoverCommandCodeOffers, withAcpRoutes } from './routes.ts'

const CONTROL_PORT = 43123

function requiredSecret(name: 'LINEAR_API_KEY' | 'COMMANDCODE_API_KEY') {
  const value = process.env[name]
  if (!value) throw new Error(`${name} was not resolved by the restricted Julia vault launcher`)
  return value
}

export async function discoverControlPageState() {
  const linearKey = requiredSecret('LINEAR_API_KEY')
  const commandCodeKey = requiredSecret('COMMANDCODE_API_KEY')
  const cardsPromise = listReadyLinearCards(linearKey, fetch, trace => console.log(JSON.stringify(trace)))
  const offersPromise = withAcpRoutes(async routes => {
    const [acp, commandCode] = await Promise.all([
      discoverAcpOffers(routes, trace => console.log(JSON.stringify(trace))),
      discoverCommandCodeOffers(commandCodeKey),
    ])
    const offers = [...acp, ...commandCode]
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

export async function runControlPageServer() {
  const storagePath = process.env.JULIA_INITIALIZATION_DB ?? join(homedir(), '.julia', 'initialization.db')
  const runtime = await createInitializationRuntime({ storagePath })
  let latestState = await discoverControlPageState()
  const server = await startControlPageServer({
    port: CONTROL_PORT,
    getState: async () => { latestState = await discoverControlPageState(); return latestState },
    startInitialization: async input => {
      latestState = await discoverControlPageState()
      const result = await runtime.start(input, latestState)
      console.log(JSON.stringify({ event: 'initialization-ready-for-build', card: input.card.identifier, runId: result.runId, resumed: result.resumed, state: result.state }))
      return result
    },
    onRequest: request => console.log(JSON.stringify({ event: 'control-page-request', ...request })),
  })
  console.log(JSON.stringify({ status: 'ready', url: server.url, storage: storagePath }))
  openDefaultBrowser(server.url)
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await server.close()
    await runtime.close()
  }
  process.once('SIGINT', () => { close().then(() => process.exit(0), error => { console.error(error); process.exit(1) }) })
  process.once('SIGTERM', () => { close().then(() => process.exit(0), error => { console.error(error); process.exit(1) }) })
  return { ...server, close }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runControlPageServer().catch(error => { console.log(JSON.stringify({ event: 'control-page-fatal', error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1 })
}
