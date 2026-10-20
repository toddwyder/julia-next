import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { z } from 'zod/v4'
import { CardAdmissionSchema, ConnectionsCommandSchema, ConnectionsResultSchema, DeliveryRunSnapshotSchema, InitCommandSchema, InitResultSchema, ModelsCommandSchema, ModelsResultSchema, ConnectionRecordSchema, RoleDefaultsSchema } from './contracts.ts'
import { atomicJson, ConnectionStore } from './connections.ts'
import { validateRoleDefaults } from './roles.ts'
import { ensureSelectionsOffered, loadSavedSnapshot, validateStartPreconditions } from './init.ts'
import { discoverAcpOffers, discoverCommandCodeOffers, withAcpRoutes } from './routes.ts'
import { createRoleExecutionWorkflow } from './workflows/delivery.ts'
import { cardAdmissionInput, fetchLinearIssue } from './linear.ts'

const configDirectory = process.env.JULIA_CONFIG_DIRECTORY ?? join(process.env.USERPROFILE ?? process.cwd(), '.julia')
const connectionsPath = process.env.JULIA_CONNECTIONS_PATH ?? join(configDirectory, 'connections.json')
const defaultsPath = process.env.JULIA_ROLE_DEFAULTS_PATH ?? join(configDirectory, 'role-defaults.json')
const acceptedLimits = { builderUsd: 2, reviewerUsd: 1, crashFixerUsd: 0.5, fixReviewerUsd: 0.25, builderMinutes: 90, reviewerMinutes: 30, crashFixerMinutes: 20, fixReviewerMinutes: 10 } as const

export async function connectionCommand(args: string[]) {
  const [action = 'list', id, route, company, service, secretReference] = args
  ConnectionsCommandSchema.parse(action === 'add'
    ? { action, record: { id, route, company, service, enabled: true, ...(secretReference ? { secretReference } : {}) } }
    : action === 'reconnect' ? { action, id, ...(secretReference ? { secretReference } : {}) }
      : action === 'list' ? { action } : { action, id })
  const store = new ConnectionStore(connectionsPath)
  if (action === 'add') await store.add(ConnectionRecordSchema.parse({ id, route, company, service, enabled: true, ...(secretReference ? { secretReference } : {}) }))
  else if (action === 'reconnect') await store.reconnect(id, secretReference ? { secretReference } : {})
  else if (action === 'disable') await store.disable(id)
  else if (action === 'remove') await store.remove(id)
  if (action === 'test') {
    const record = (await store.list()).find(item => item.id === id)
    if (!record || !record.enabled) throw new Error(`enabled connection ${id} not found`)
    let modelCount = 0
    if (record.route === 'commandcode') {
      const key = record.secretReference ? process.env[record.secretReference] : undefined
      if (!key) throw new Error(`secret reference ${record.secretReference ?? '(missing)'} did not resolve`)
      modelCount = (await discoverCommandCodeOffers(key)).length
    } else {
      modelCount = await withAcpRoutes(async routes => (await discoverAcpOffers(routes)).filter(item => item.route === record.route).length)
    }
    await store.recordTest(id, { ok: modelCount > 0, modelCount })
  }
  return ConnectionsResultSchema.parse({ ok: true, records: await store.list() })
}

export async function modelCommand(args: string[]) {
  const [action = 'list', value] = args
  if (action === 'save' && !value) throw new Error('$models save requires a JSON file')
  ModelsCommandSchema.parse(action === 'save'
    ? { action, defaults: RoleDefaultsSchema.parse(JSON.parse(await readFile(value, 'utf8'))) }
    : { action })
  if (action === 'save') {
    const defaults = validateRoleDefaults(RoleDefaultsSchema.parse(JSON.parse(await readFile(value, 'utf8'))))
    return withAcpRoutes(async routes => {
      const offers = await discoverAcpOffers(routes)
      const key = process.env.COMMANDCODE_API_KEY
      if (Object.values(defaults).some(selection => selection.route === 'commandcode')) {
        if (!key) throw new Error('CommandCode secret reference did not resolve')
        offers.push(...await discoverCommandCodeOffers(key))
      }
      ensureSelectionsOffered(defaults, offers)
      await atomicJson(defaultsPath, defaults)
      return ModelsResultSchema.parse({ offers, defaults })
    })
  }
  if (action === 'list') {
    return withAcpRoutes(async routes => {
      const offers = await discoverAcpOffers(routes)
      const key = process.env.COMMANDCODE_API_KEY
      if (key) offers.push(...await discoverCommandCodeOffers(key))
      return ModelsResultSchema.parse({ offers, defaults: RoleDefaultsSchema.parse(JSON.parse(await readFile(defaultsPath, 'utf8'))) })
    })
  }
  throw new Error(`unknown $models action ${action}`)
}

export async function fetchLinearCard(issueId: string, apiKey = process.env.LINEAR_API_KEY, fetchImpl: typeof fetch = fetch) {
  if (!apiKey) throw new Error('LINEAR_API_KEY was not resolved by the Julia vault launcher')
  const issue = await fetchLinearIssue(issueId, apiKey, fetchImpl)
  return CardAdmissionSchema.parse(cardAdmissionInput(issue))
}

export async function initCommand(args: string[]) {
  const [issueOrPath, decision, requestedSnapshotPath] = args
  if (!issueOrPath) throw new Error('$init requires JUL-nnn')
  const allowSameService = process.env.JULIA_ALLOW_SAME_SERVICE === 'true'
  InitCommandSchema.parse({ issueId: issueOrPath, decision, ...(allowSameService ? { allowSameService } : {}) })
  const card = await fetchLinearCard(issueOrPath)
  if (decision === undefined) {
    const choices = validateRoleDefaults(RoleDefaultsSchema.parse(JSON.parse(await readFile(defaultsPath, 'utf8'))), { allowSameService })
    return InitResultSchema.parse({ status: 'awaiting-decision', issueId: card.identifier, choices, limits: acceptedLimits })
  }
  if (decision === 'Cancel') return InitResultSchema.parse({ status: 'cancelled', issueId: card.identifier })
  if (decision !== 'Start') throw new Error('$init accepts exactly Start or Cancel')
  if (process.env.JULIA_START_AUTHORIZED !== card.identifier) throw new Error(`start authorization for ${card.identifier} is missing`)
  const snapshotPath = requestedSnapshotPath ?? join(configDirectory, 'runs', `${card.identifier}.json`)
  const records = await new ConnectionStore(connectionsPath).list()
  const commandCode = records.find(item => item.route === 'commandcode')
  const apiKey = commandCode?.secretReference ? process.env[commandCode.secretReference] : undefined
  if (!apiKey) throw new Error('CommandCode secret reference did not resolve')
  const dispatch = async (snapshot: z.infer<typeof DeliveryRunSnapshotSchema>) => {
    return withAcpRoutes(async routes => {
      const workflow = createRoleExecutionWorkflow({
        routes, commandCodeKey: () => apiKey,
        promptForRole: (role, issueId) => process.env.JULIA_VERIFY_MACHINE === '1' && process.env.JULIA_REHEARSAL_PROMPT
          ? process.env.JULIA_REHEARSAL_PROMPT
          : `${role} for ${issueId}. Follow this complete card exactly:\n\n${card.description}`,
      })
      const run = await workflow.createRun()
      return run.start({ inputData: { decision: 'Start', authorized: true, snapshot } })
    })
  }
  try {
    const saved = await loadSavedSnapshot(snapshotPath, card.identifier)
    return InitResultSchema.parse({ status: 'started', resumed: true, snapshotPath, choices: saved.roles, limits: acceptedLimits, snapshot: saved, delivery: await dispatch(saved) })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const roles = RoleDefaultsSchema.parse(JSON.parse(await readFile(defaultsPath, 'utf8')))
  await withAcpRoutes(async routes => {
    const offers = await discoverAcpOffers(routes)
    offers.push(...await discoverCommandCodeOffers(apiKey))
    validateStartPreconditions({ authorized: true, roles, records, offers }, { allowSameService })
  })
  const saved = DeliveryRunSnapshotSchema.parse({ issueId: card.identifier, roles, allowSameService, savedAt: new Date().toISOString() })
  await atomicJson(snapshotPath, saved)
  if (process.env.JULIA_VERIFY_MACHINE === '1' && process.env.JULIA_STOP_AFTER_SNAPSHOT === '1') {
    return InitResultSchema.parse({ status: 'started', resumed: false, snapshotPath, choices: saved.roles, limits: acceptedLimits, snapshot: saved, delivery: { status: 'stopped-at-safe-boundary' } })
  }
  return InitResultSchema.parse({ status: 'started', resumed: false, snapshotPath, choices: saved.roles, limits: acceptedLimits, snapshot: saved, delivery: await dispatch(saved) })
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
  main().then(() => setTimeout(() => process.exit(0), 250)).catch(error => { console.error(error.message); setTimeout(() => process.exit(1), 250) })
}
