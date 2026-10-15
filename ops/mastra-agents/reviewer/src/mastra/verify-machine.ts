import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { z } from 'zod/v4'
import { WorkflowSnapshotSchema } from './contracts.ts'
import { createAcpRoutes, createCommandCodeAgent, disconnectAcpRoutes, discoverAcpOffers, discoverCommandCodeOffers, selectAcpModel } from './routes.ts'
import { createRoleExecutionWorkflow } from './workflows/delivery.ts'

const PartsSchema = z.object({
  version: z.literal(1),
  policy: z.string().optional(),
  parts: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), kind: z.enum(['executable', 'package', 'sign-in']),
    location: z.string().min(1), expectedVersion: z.string().optional(), permanent: z.literal(true),
  }).strict()).min(1),
}).strict()

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const execute = promisify(execFile)
export const defaultFrameworkMapPath = resolve(moduleDirectory, '../../../../../docs/agents/jul-225-framework-map.md')

async function inventoryFromFrameworkMap(frameworkMapPath: string) {
  const map = await readFile(frameworkMapPath, 'utf8')
  const match = /^Doctor inventory: `([^`]+)`\.$/m.exec(map)
  if (!match) throw new Error('framework map does not name the Doctor inventory')
  return resolve(moduleDirectory, '../../../../..', match[1])
}

export async function doctor(frameworkMapPath = defaultFrameworkMapPath) {
  const inventoryPath = await inventoryFromFrameworkMap(frameworkMapPath)
  const inventory = PartsSchema.parse(JSON.parse(await readFile(inventoryPath, 'utf8')))
  const missing = [] as typeof inventory.parts
  const versionMismatches: Array<{ id: string; expected: string; actual: string }> = []
  for (const part of inventory.parts) {
    try {
      await access(part.location)
      if (part.expectedVersion) {
        const manifest = JSON.parse(await readFile(resolve(part.location, 'package.json'), 'utf8')) as { version?: unknown }
        if (manifest.version !== part.expectedVersion) versionMismatches.push({ id: part.id, expected: part.expectedVersion, actual: String(manifest.version) })
      }
    } catch { missing.push(part) }
  }
  return { ok: missing.length === 0 && versionMismatches.length === 0, inventoryPath, checked: inventory.parts.length, missing, versionMismatches }
}
export async function liveModelProof(apiKey: string, cwd = resolve(moduleDirectory, '../../../../..')) {
  const routes = createAcpRoutes(cwd)
  try {
    const [acpOffers, commandCodeOffers] = await Promise.all([
      discoverAcpOffers(routes),
      discoverCommandCodeOffers(apiKey),
    ])
    const antigravity = acpOffers.find(offer => offer.route === 'antigravity')
    const claude = acpOffers.find(offer => offer.route === 'claude')
    const commandcode = commandCodeOffers[0]
    if (!antigravity || !claude || !commandcode) throw new Error('all three routes must advertise at least one coding model')
    await selectAcpModel(routes, antigravity)
    await selectAcpModel(routes, claude)
    for (const offer of acpOffers) await selectAcpModel(routes, offer)
    for (const offer of commandCodeOffers) createCommandCodeAgent(offer, apiKey)
    return { routes, offers: [...acpOffers, ...commandCodeOffers], selected: { antigravity, claude, commandcode } }
  } catch (error) {
    disconnectAcpRoutes(routes)
    throw error
  }
}

async function cliJourneyProof(apiKey: string, evidenceDirectory: string, roles: Record<string, unknown>) {
  const configDirectory = resolve(evidenceDirectory, `cli-state-${process.pid}`)
  const cli = resolve(moduleDirectory, 'cli.ts')
  const environment = { ...process.env, COMMANDCODE_API_KEY: apiKey, JULIA_CONFIG_DIRECTORY: configDirectory }
  const expectFailure = async (args: string[], env = environment) => {
    try {
      await execute(process.execPath, ['--experimental-strip-types', cli, ...args], { env, windowsHide: true })
      throw new Error(`expected CLI failure for ${args.join(' ')}`)
    } catch (error) {
      const failure = error as Error & { stderr?: string; code?: number }
      if (failure.message.startsWith('expected CLI failure')) throw failure
      return { args, exitCode: failure.code, message: String(failure.stderr || failure.message).trim() }
    }
  }
  const commands = [
    ['connections', 'add', 'commandcode', 'commandcode', 'CommandCode', 'CommandCode', 'COMMANDCODE_API_KEY'],
    ['connections', 'reconnect', 'commandcode', 'COMMANDCODE_API_KEY'],
    ['connections', 'test', 'commandcode'],
    ['connections', 'disable', 'commandcode'],
    ['connections', 'remove', 'commandcode'],
  ]
  const outputs = []
  for (const command of commands) {
    const { stdout } = await execute(process.execPath, ['--experimental-strip-types', cli, ...command], { env: environment, windowsHide: true })
    outputs.push(JSON.parse(stdout))
  }
  const persisted = JSON.parse(await readFile(resolve(configDirectory, 'connections.json'), 'utf8'))
  const serialized = JSON.stringify({ outputs, persisted })
  const defaultsPath = resolve(evidenceDirectory, 'role-defaults-proof.json')
  await writeFile(defaultsPath, `${JSON.stringify(roles, null, 2)}\n`, 'utf8')
  const save = await execute(process.execPath, ['--experimental-strip-types', cli, 'models', 'save', defaultsPath], { env: environment, windowsHide: true })
  const list = await execute(process.execPath, ['--experimental-strip-types', cli, 'models', 'list'], { env: environment, windowsHide: true })
  const preview = await execute(process.execPath, ['--experimental-strip-types', cli, 'init', 'JUL-225'], { env: environment, windowsHide: true })
  const cancel = await execute(process.execPath, ['--experimental-strip-types', cli, 'init', 'JUL-225', 'Cancel'], { env: environment, windowsHide: true })
  const negative = [
    await expectFailure(['init', 'JUL-225', 'Go']),
    await expectFailure(['init', 'JUL-225', 'Start']),
  ]
  const connectionSpecs: Array<[string, string, string, string, string?]> = [
    ['antigravity', 'antigravity', 'Google', 'Antigravity', undefined],
    ['claude', 'claude', 'Anthropic', 'Claude', undefined],
    ['commandcode', 'commandcode', 'Anthropic', 'CommandCode', 'COMMANDCODE_API_KEY'],
  ]
  for (const [id, route, company, service, reference] of connectionSpecs) {
    const add = ['--experimental-strip-types', cli, 'connections', 'add', id, route, company, service]
    if (reference) add.push(reference)
    await execute(process.execPath, add, { env: environment, windowsHide: true })
    await execute(process.execPath, ['--experimental-strip-types', cli, 'connections', 'test', id], { env: environment, windowsHide: true })
  }
  const startEnvironment = { ...environment, JULIA_START_AUTHORIZED: 'JUL-225', JULIA_VERIFY_MACHINE: '1', JULIA_STOP_AFTER_SNAPSHOT: '1', JULIA_REHEARSAL_PROMPT: 'Read no files and change nothing. Reply exactly JUL-225 ROUTE OK.' }
  await execute(process.execPath, ['--experimental-strip-types', cli, 'connections', 'disable', 'claude'], { env: environment, windowsHide: true })
  negative.push(await expectFailure(['init', 'JUL-225', 'Start'], startEnvironment))
  await execute(process.execPath, ['--experimental-strip-types', cli, 'connections', 'reconnect', 'claude'], { env: environment, windowsHide: true })
  const invalidRoles = structuredClone(roles) as Record<string, { company?: string; modelId?: string }>
  if (invalidRoles.reviewer) invalidRoles.reviewer.company = 'Google'
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(invalidRoles, null, 2)}\n`, 'utf8')
  negative.push(await expectFailure(['init', 'JUL-225', 'Start'], startEnvironment))
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(roles, null, 2)}\n`, 'utf8')
  const staleRoles = structuredClone(roles) as Record<string, { modelId?: string }>
  if (staleRoles.builder) staleRoles.builder.modelId = 'unavailable-model'
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(staleRoles, null, 2)}\n`, 'utf8')
  negative.push(await expectFailure(['init', 'JUL-225', 'Start'], startEnvironment))
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(roles, null, 2)}\n`, 'utf8')
  const prepared = await execute(process.execPath, ['--experimental-strip-types', cli, 'init', 'JUL-225', 'Start'], { env: startEnvironment, windowsHide: true })
  const changed = structuredClone(roles) as Record<string, { modelId?: string }>
  if (changed.builder) changed.builder.modelId = 'changed-after-safe-boundary'
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(changed, null, 2)}\n`, 'utf8')
  const { JULIA_STOP_AFTER_SNAPSHOT: _stopped, ...resumeEnvironment } = startEnvironment
  const resumed = await execute(process.execPath, ['--experimental-strip-types', cli, 'init', 'JUL-225', 'Start'], { env: resumeEnvironment, windowsHide: true })
  const preparedResult = JSON.parse(prepared.stdout)
  const resumedResult = JSON.parse(resumed.stdout)
  return {
    connections: { commands: commands.map(command => command[1]), outputs, persisted, secretValueAbsent: !serialized.includes(apiKey) },
    models: { save: JSON.parse(save.stdout), list: JSON.parse(list.stdout) },
    init: {
      preview: JSON.parse(preview.stdout), cancel: JSON.parse(cancel.stdout), prepared: preparedResult, resumed: resumedResult,
      negativePreconditions: negative,
      exactSnapshotReused: JSON.stringify(preparedResult.snapshot) === JSON.stringify(resumedResult.snapshot),
      defaultsChangedAfterBoundary: changed.builder?.modelId === 'changed-after-safe-boundary',
    },
  }
}

async function antigravityProcessIds() {
  if (process.platform !== 'win32') return new Set<number>()
  const command = "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'agy_acp_server.exe' } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress"
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
  const parsed = JSON.parse(stdout.trim() || '[]') as number | number[]
  return new Set(Array.isArray(parsed) ? parsed : [parsed])
}

async function stopNewAntigravityProcesses(previous: Set<number>) {
  const current = await antigravityProcessIds()
  const created = [...current].filter(processId => !previous.has(processId))
  if (!created.length) return
  await execute('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${created.join(',')} -Force`], { windowsHide: true })
}

export async function rehearsal(apiKey: string, evidencePath: string) {
  const previousAntigravityProcesses = await antigravityProcessIds()
  let proof: Awaited<ReturnType<typeof liveModelProof>> | undefined
  try {
    proof = await liveModelProof(apiKey)
    const expected = 'JUL-225 ROUTE OK'
    const workflow = createRoleExecutionWorkflow({
      routes: proof.routes,
      commandCodeKey: () => apiKey,
      promptForRole: () => `Read no files and change nothing. Reply exactly ${expected}.`,
    })
    type SelectedOffer = Awaited<ReturnType<typeof liveModelProof>>['selected'][keyof Awaited<ReturnType<typeof liveModelProof>>['selected']]
    const selection = (offer: SelectedOffer) => ({
      route: offer.route, modelId: offer.modelId, company: offer.company, service: offer.service,
      ...(offer.wire ? { wire: offer.wire } : {}),
    })
    const inputData = {
      decision: 'Start', authorized: true,
      snapshot: {
        issueId: 'JUL-208', allowSameService: false, savedAt: new Date().toISOString(), roles: {
          builder: selection(proof.selected.antigravity),
          reviewer: selection(proof.selected.commandcode),
          crashFixer: selection(proof.selected.claude),
          fixReviewer: selection(proof.selected.antigravity),
        },
      },
    } as const
    const workflowRun = await workflow.createRun()
    const workflowResult = await workflowRun.start({ inputData })
    if (workflowResult.status !== 'success') throw new Error(`real workflow rehearsal ended ${workflowResult.status}`)
    const output = workflowResult.result
    const workflowSnapshot = WorkflowSnapshotSchema.parse({ runId: workflowRun.runId, input: inputData, output })
    const cli = await cliJourneyProof(apiKey, dirname(evidencePath), inputData.snapshot.roles)
    const result = {
      recordedAt: new Date().toISOString(),
      productMutation: false,
      workflowStatus: workflowResult.status,
      workflowRunId: output.runId,
      workflowSnapshot,
      traces: output.traces,
      modelOffers: { count: proof.offers.length, everyDisplayedOfferSelectable: true },
      cli,
      routes: {
        antigravity: { model: proof.selected.antigravity.modelId, ok: output.results.builder.includes(expected) && output.results.fixReviewer.includes(expected) },
        claude: { model: proof.selected.claude.modelId, ok: output.results.crashFixer.includes(expected) },
        commandcode: { model: proof.selected.commandcode.modelId, ok: output.results.reviewer.includes(expected) },
      },
    }
    await mkdir(dirname(evidencePath), { recursive: true })
    await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    if (!Object.values(result.routes).every(route => route.ok)) throw new Error('one or more real routes returned an unexpected rehearsal result')
    return result
  } finally {
    if (proof) disconnectAcpRoutes(proof.routes)
    await stopNewAntigravityProcesses(previousAntigravityProcesses)
  }
}

async function main() {
  const command = process.argv[2] ?? 'doctor'
  if (command === 'doctor') {
    const result = await doctor(process.argv[3] || defaultFrameworkMapPath)
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
    return
  }
  const apiKey = process.env.COMMANDCODE_API_KEY
  if (!apiKey) throw new Error('COMMANDCODE_API_KEY was not resolved by the Julia vault launcher')
  if (command === 'rehearsal') {
    const evidencePath = process.argv[3]
    if (!evidencePath) throw new Error('rehearsal requires an evidence path')
    console.log(JSON.stringify(await rehearsal(apiKey, evidencePath), null, 2))
    return
  }
  throw new Error(`unknown verify-machine command: ${command}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1) })
}
