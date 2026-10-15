import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { z } from 'zod/v4'
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
export const defaultPartsPath = resolve(moduleDirectory, '../../../../../docs/agents/permanent-machine-parts.json')

export async function doctor(inventoryPath = defaultPartsPath) {
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
    return { routes, offers: [...acpOffers, ...commandCodeOffers], selected: { antigravity, claude, commandcode } }
  } catch (error) {
    disconnectAcpRoutes(routes)
    throw error
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
    const workflowRun = await workflow.createRun()
    const workflowResult = await workflowRun.start({ inputData: {
      decision: 'Start', authorized: true,
      snapshot: {
        issueId: 'JUL-208', savedAt: new Date().toISOString(), roles: {
          builder: selection(proof.selected.antigravity),
          reviewer: selection(proof.selected.commandcode),
          crashFixer: selection(proof.selected.claude),
          fixReviewer: selection(proof.selected.antigravity),
        },
      },
    } })
    if (workflowResult.status !== 'success') throw new Error(`real workflow rehearsal ended ${workflowResult.status}`)
    const output = workflowResult.result
    const result = {
      recordedAt: new Date().toISOString(),
      productMutation: false,
      workflowStatus: workflowResult.status,
      workflowRunId: output.runId,
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
    const result = await doctor(process.argv[3] || defaultPartsPath)
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
