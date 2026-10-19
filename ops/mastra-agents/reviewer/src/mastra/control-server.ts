import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ControlPageStateSchema } from './contracts.ts'
import { startControlPageServer } from './control-page.ts'
import { createInitializationRuntime } from './initialization.ts'
import { createInitializationActivityRecorder, createObservedLinearClient } from './initialization-observability.ts'
import { listReadyLinearCards } from './linear.ts'
import { discoverAcpOffers, discoverCommandCodeOffers, withAcpRoutes } from './routes.ts'
import { createAgentActivityStore, discoverAgentActivity, projectAgentCards } from './agent-activity.ts'

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
    const [acp, commandCode] = await Promise.all([
      discoverAcpOffers(routes, trace => console.log(JSON.stringify(trace))),
      discoverCommandCodeOffers(commandCodeKey, fetch, trace => console.log(JSON.stringify(trace))),
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

export function shouldOpenControlBrowser(environment: NodeJS.ProcessEnv = process.env) {
  return environment.JULIA_CONTROL_OPEN_BROWSER !== '0'
}

// The operator who configures Tailscale Serve on this host sets its tailnet DNS
// name here (JUL-242). Unset means loopback only: the page still refuses a
// Serve-routed request rather than guessing a name.
export function configuredTailscaleHosts(environment: NodeJS.ProcessEnv = process.env) {
  return (environment.JULIA_CONTROL_TAILSCALE_HOST ?? '').split(',').map(name => name.trim()).filter(Boolean)
}

export async function jsonlFiles(root: string, omitCheckpoints = false, pathMarkers?: string[]) {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true })
    const paths = entries.filter(entry => entry.isFile() && entry.name.endsWith('.jsonl') && (!omitCheckpoints || !entry.name.endsWith('.checkpoints.jsonl')))
      .map(entry => join(entry.parentPath, entry.name))
      .filter(path => pathMarkers === undefined || pathMarkers.some(marker => path.toLowerCase().includes(marker.toLowerCase())))
    const dated = await Promise.all(paths.map(async path => ({ path, mtimeMs: (await stat(path)).mtimeMs })))
    return dated.sort((left, right) => right.mtimeMs - left.mtimeMs).map(item => item.path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function codexLockIds(lockRoot: string) {
  try {
    return (await readdir(lockRoot)).filter(name => name.endsWith('.lock') && name !== '.coordination.lock').map(name => name.slice(0, -5))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function activeCodexFiles(paths: string[], lockRoot: string) {
  const ids = await codexLockIds(lockRoot)
  return paths.filter(path => ids.some(id => path.includes(id)))
}

function processAlive(pid: number) {
  try { process.kill(pid, 0); return true } catch { return false }
}

export async function activeCommandCodeFiles(paths: string[], ideRoot: string) {
  try {
    const records = await Promise.all((await readdir(ideRoot)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(ideRoot, name), 'utf8')) as { pid?: number; workspaceFolders?: string[] }))
    const activeProjects = records.filter(record => Number.isInteger(record.pid) && processAlive(record.pid!)).flatMap(record => record.workspaceFolders ?? []).map(folder => folder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    return activeProjects.flatMap(project => paths.find(path => path.toLowerCase().replaceAll('\\', '/').includes(`/${project}/`)) ?? []).filter(Boolean)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function discoverAgentDashboard({ codexRoot, codexLockRoot, commandCodeRoot, commandCodeIdeRoot, mastraTraces, agentStore, controlCards, now = new Date() }: {
  codexRoot: string
  codexLockRoot?: string
  commandCodeRoot: string
  commandCodeIdeRoot?: string
  mastraTraces: Record<string, any>[]
  agentStore: Awaited<ReturnType<typeof createAgentActivityStore>>
  controlCards: Array<{ card: { identifier: string; title: string } }>
  now?: Date
}) {
  const lockRoot = codexLockRoot ?? join(homedir(), '.codex', 'thread-writer-locks')
  const ids = await codexLockIds(lockRoot)
  const [codexActive, commandCodeFiles] = await Promise.all([
    jsonlFiles(codexRoot, false, ids),
    jsonlFiles(commandCodeRoot, true),
  ])
  const commandCodeActive = await activeCommandCodeFiles(commandCodeFiles, commandCodeIdeRoot ?? join(homedir(), '.commandcode', 'ide'))
  const discovered = await discoverAgentActivity({ codexFiles: codexActive, commandCodeFiles: commandCodeActive, mastraTraces, now, activeCommandCodeFiles: commandCodeActive })
  await agentStore.retain(discovered)
  const trackerTitles = new Map(controlCards.map(item => [item.card.identifier, item.card.title]))
  const cards = projectAgentCards(discovered.map(record => ({
    ...record,
    cardTitle: record.cardIdentifier ? trackerTitles.get(record.cardIdentifier) ?? record.cardTitle : record.cardTitle,
  })), now)
  return { cards, counts: { codexLocks: ids.length, activeCodexFiles: codexActive.length, commandCodeFiles: commandCodeFiles.length, activeCommandCodeFiles: commandCodeActive.length, mastraTraces: mastraTraces.length } }
}

export async function runControlPageServer() {
  const storagePath = process.env.JULIA_INITIALIZATION_DB ?? join(homedir(), '.julia', 'initialization.db')
  const tailscaleHosts = configuredTailscaleHosts()
  const activity = createInitializationActivityRecorder(event => console.log(JSON.stringify(event)))
  const runtime = await createInitializationRuntime({ storagePath, activity })
  const agentStore = await createAgentActivityStore(storagePath)
  let latestState = await discoverControlPageState(activity)
  let agentDashboardCache: { expiresAt: number; state: { updatedAt: string; cards: ReturnType<typeof projectAgentCards> } } | undefined
  let agentDashboardRefresh: Promise<{ updatedAt: string; cards: ReturnType<typeof projectAgentCards> }> | undefined
  const server = await startControlPageServer({
    port: CONTROL_PORT,
    tailscaleHosts,
    getState: async () => { latestState = await discoverControlPageState(activity); return latestState },
    getRuns: () => runtime.list(),
    getActivity: () => activity.snapshot(),
    getAgentCards: async () => {
      if (agentDashboardCache && agentDashboardCache.expiresAt > Date.now()) return agentDashboardCache.state
      if (agentDashboardRefresh) return agentDashboardRefresh
      const startedAt = performance.now()
      agentDashboardRefresh = (async () => { try {
        const mastraTraces = await runtime.listMastraTraces()
        const { cards, counts } = await discoverAgentDashboard({
          codexRoot: process.env.JULIA_CODEX_SESSIONS ?? join(homedir(), '.codex', 'sessions'),
          commandCodeRoot: process.env.JULIA_COMMANDCODE_PROJECTS ?? join(homedir(), '.commandcode', 'projects'),
          mastraTraces: mastraTraces as Record<string, any>[], agentStore, controlCards: latestState.cards,
        })
        console.log(JSON.stringify({ event: 'agent-activity-discovery', ok: true, ...counts, runningCards: cards.length, durationMs: performance.now() - startedAt }))
        const state = { updatedAt: new Date().toISOString(), cards }
        agentDashboardCache = { expiresAt: Date.now() + 25_000, state }
        return state
      } catch (error) {
        console.log(JSON.stringify({ event: 'agent-activity-discovery', ok: false, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300), durationMs: performance.now() - startedAt }))
        throw error
      } finally { agentDashboardRefresh = undefined } })()
      return agentDashboardRefresh
    },
    startInitialization: async input => {
      latestState = await discoverControlPageState(activity)
      const result = await runtime.start(input, latestState)
      console.log(JSON.stringify({ event: 'initialization-ready-for-build', card: input.card.identifier, runId: result.runId, resumed: result.resumed, state: result.state }))
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
