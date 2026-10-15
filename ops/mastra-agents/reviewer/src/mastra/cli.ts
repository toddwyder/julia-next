import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { z } from 'zod/v4'
import { CardAdmissionSchema, ConnectionRecordSchema, RoleDefaultsSchema, RunSnapshotSchema } from './contracts.ts'
import { ConnectionStore } from './connections.ts'
import { validateRoleDefaults } from './roles.ts'
import { ensureSelectionsOffered } from './init.ts'
import { createAcpRoutes, disconnectAcpRoutes, discoverAcpOffers, discoverCommandCodeOffers } from './routes.ts'
import { createRoleExecutionWorkflow } from './workflows/delivery.ts'

const configDirectory = process.env.JULIA_CONFIG_DIRECTORY ?? join(process.env.USERPROFILE ?? process.cwd(), '.julia')
const connectionsPath = process.env.JULIA_CONNECTIONS_PATH ?? join(configDirectory, 'connections.json')
const defaultsPath = process.env.JULIA_ROLE_DEFAULTS_PATH ?? join(configDirectory, 'role-defaults.json')

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}
async function connectionCommand(args: string[]) {
  const [action = 'list', id, route, company, service, secretReference] = args
  const store = new ConnectionStore(connectionsPath)
  if (action === 'list') return store.list()
  if (action === 'add') return store.add(ConnectionRecordSchema.parse({ id, route, company, service, enabled: true, ...(secretReference ? { secretReference } : {}) }))
  if (action === 'reconnect') return store.reconnect(id, secretReference ? { secretReference } : {})
  if (action === 'disable') return store.disable(id)
  if (action === 'remove') { await store.remove(id); return { removed: id } }
  if (action === 'test') {
    const record = (await store.list()).find(item => item.id === id)
    if (!record || !record.enabled) throw new Error(`enabled connection ${id} not found`)
    let modelCount = 0
    if (record.route === 'commandcode') {
      const key = record.secretReference ? process.env[record.secretReference] : undefined
      if (!key) throw new Error(`secret reference ${record.secretReference ?? '(missing)'} did not resolve`)
      modelCount = (await discoverCommandCodeOffers(key)).length
    } else {
      const routes = createAcpRoutes()
      try { modelCount = (await discoverAcpOffers(routes)).filter(item => item.route === record.route).length }
      finally { disconnectAcpRoutes(routes) }
    }
    return store.recordTest(id, { ok: modelCount > 0, modelCount })
  }
  throw new Error(`unknown $connections action ${action}`)
}

async function modelCommand(args: string[]) {
  const [action = 'list', value] = args
  if (action === 'save') {
    if (!value) throw new Error('$models save requires a JSON file')
    const defaults = validateRoleDefaults(RoleDefaultsSchema.parse(JSON.parse(await readFile(value, 'utf8'))))
    await atomicJson(defaultsPath, defaults)
    return defaults
  }
  if (action === 'list') {
    const routes = createAcpRoutes()
    try {
      const offers = await discoverAcpOffers(routes)
      const key = process.env.COMMANDCODE_API_KEY
      if (key) offers.push(...await discoverCommandCodeOffers(key))
      return { offers, defaults: RoleDefaultsSchema.parse(JSON.parse(await readFile(defaultsPath, 'utf8'))) }
    } finally { disconnectAcpRoutes(routes) }
  }
  throw new Error(`unknown $models action ${action}`)
}

async function initCommand(args: string[]) {
  const [cardPath, decision, requestedSnapshotPath] = args
  if (!cardPath) throw new Error('$init requires a saved Linear card JSON path')
  const card = CardAdmissionSchema.parse(JSON.parse(await readFile(cardPath, 'utf8')))
  if (decision === 'Cancel') return { status: 'cancelled', issueId: card.identifier }
  if (decision !== 'Start') throw new Error('$init accepts exactly Start or Cancel')
  if (process.env.JULIA_START_AUTHORIZED !== card.identifier) throw new Error(`start authorization for ${card.identifier} is missing`)
  const snapshotPath = requestedSnapshotPath ?? join(configDirectory, 'runs', `${card.identifier}.json`)
  const records = await new ConnectionStore(connectionsPath).list()
  const commandCode = records.find(item => item.route === 'commandcode')
  const apiKey = commandCode?.secretReference ? process.env[commandCode.secretReference] : undefined
  if (!apiKey) throw new Error('CommandCode secret reference did not resolve')
  const dispatch = async (snapshot: z.infer<typeof RunSnapshotSchema>) => {
    const routes = createAcpRoutes()
    try {
      const workflow = createRoleExecutionWorkflow({
        routes, commandCodeKey: () => apiKey,
        promptForRole: (role, issueId) => `${role} for ${issueId}. Follow this complete card exactly:\n\n${card.description}`,
      })
      const run = await workflow.createRun()
      return run.start({ inputData: { decision: 'Start', authorized: true, snapshot } })
    } finally { disconnectAcpRoutes(routes) }
  }
  try {
    const saved = RunSnapshotSchema.parse(JSON.parse(await readFile(snapshotPath, 'utf8')))
    if (saved.issueId !== card.identifier) throw new Error('saved snapshot belongs to another card')
    return { status: 'started', resumed: true, snapshotPath, snapshot: saved, delivery: await dispatch(saved) }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const roles = validateRoleDefaults(RoleDefaultsSchema.parse(JSON.parse(await readFile(defaultsPath, 'utf8'))))
  for (const selection of Object.values(roles)) {
    const connection = records.find(item => item.route === selection.route)
    if (!connection?.enabled || connection.lastTest?.ok !== true) throw new Error(`${selection.route} connection is disabled, failed, or stale`)
  }
  const routes = createAcpRoutes()
  try {
    const offers = await discoverAcpOffers(routes)
    offers.push(...await discoverCommandCodeOffers(apiKey))
    ensureSelectionsOffered(roles, offers)
  } finally { disconnectAcpRoutes(routes) }
  const saved = RunSnapshotSchema.parse({ issueId: card.identifier, roles, savedAt: new Date().toISOString() })
  await atomicJson(snapshotPath, saved)
  return { status: 'started', snapshotPath, snapshot: saved, delivery: await dispatch(saved) }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const result = command === '$connections' || command === 'connections'
    ? await connectionCommand(args)
    : command === '$models' || command === 'models'
      ? await modelCommand(args)
      : command === '$init' || command === 'init'
        ? await initCommand(args)
        : (() => { throw new Error('use connections, models, or init') })()
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
