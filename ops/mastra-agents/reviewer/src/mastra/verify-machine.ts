import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { z } from 'zod/v4'
import { fetchLinearCard } from './cli.ts'
import { fetchLinearIssue } from './linear.ts'
import type { LinearReadTrace } from './linear.ts'
import { ConnectionRecordSchema, ConnectionsResultSchema, InitResultSchema, ModelsResultSchema, WorkflowSnapshotSchema } from './contracts.ts'
import { cleanupAcpRoutes, createAcpRoutes, createCommandCodeAgent, discoverAcpOffers, discoverCommandCodeOffers, rethrowAfterCleanup, selectAcpModel, withFinalCleanup } from './routes.ts'
import { createRoleExecutionWorkflow } from './workflows/delivery.ts'
import type { DeliveryRole } from './workflows/delivery.ts'

const PartsSchema = z.object({
  version: z.literal(1),
  policy: z.string().optional(),
  parts: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), kind: z.enum(['executable', 'package', 'sign-in']),
    location: z.string().min(1), expectedVersion: z.string().optional(), permanent: z.literal(true),
  }).strict()).min(1),
}).strict()

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(moduleDirectory, '../../../../..')
const execute = promisify(execFile)
export const defaultFrameworkMapPath = resolve(moduleDirectory, '../../../../../docs/agents/jul-225-framework-map.md')
export type CandidateIdentity = { candidateCommit: string; dirtyTreeDigest: string }
type IdentityProvider = () => Promise<CandidateIdentity>

const RehearsalCardSchema = z.object({
  identifier: z.literal('JUL-208'),
  title: z.string().min(1),
  state: z.string().min(1),
  description: z.string().min(1),
}).strict()
type RehearsalCard = z.infer<typeof RehearsalCardSchema>

export async function fetchRehearsalCard(apiKey = process.env.LINEAR_API_KEY, fetchImpl: typeof fetch = fetch, recordTrace?: (trace: LinearReadTrace) => void | Promise<void>) {
  if (!apiKey) throw new Error('LINEAR_API_KEY was not resolved by the Julia vault launcher')
  const issue = await fetchLinearIssue('JUL-208', apiKey, fetchImpl, recordTrace)
  return RehearsalCardSchema.parse({ identifier: issue.identifier, title: issue.title, state: issue.state.name, description: issue.description })
}

export function jul208Prompt(role: DeliveryRole, card: RehearsalCard, priorResults: Readonly<Record<string, string>>) {
  const cardText = `Card: ${card.identifier} — ${card.title}\nState: ${card.state}\n\n${card.description}`
  const boundary = 'This is a read-only rehearsal. Do not create, edit, or delete files; do not change product, tracker, git, configuration, or external state.'
  switch (role) {
    case 'builder': return `${boundary}\n\nAnalyze the repository against the card below and produce a concrete proposed change. Include likely files, behavior, edge cases, and verification. The proposal is your response only; do not implement it.\n\n${cardText}`
    case 'reviewer': return `${boundary}\n\nReview the builder proposal below against the card. Use the supplied card and proposal directly; do not call tools, inspect the workspace, or announce future work. Return at most the three highest-severity findings in no more than 350 words, with file references where possible; say explicitly if there are no findings. Do not implement fixes.\n\n${cardText}\n\nBuilder proposal:\n${priorResults.builder ?? '(missing builder proposal)'}`
    case 'crashFixer': return `${boundary}\n\nIdentify failure modes and recovery gaps in the proposed JUL-208 design and reviewer findings. Return analysis only.\n\nBuilder proposal:\n${priorResults.builder ?? '(missing builder proposal)'}\n\nReviewer findings:\n${priorResults.reviewer ?? '(missing reviewer findings)'}`
    case 'fixReviewer': return `${boundary}\n\nPerform a final read-only review of the JUL-208 proposal, findings, and failure analysis. Return remaining findings only.\n\nBuilder proposal:\n${priorResults.builder ?? '(missing builder proposal)'}\n\nReviewer findings:\n${priorResults.reviewer ?? '(missing reviewer findings)'}\n\nFailure analysis:\n${priorResults.crashFixer ?? '(missing failure analysis)'}`
  }
}

export function assertReviewerFindings(text: string) {
  const findings = text.trim()
  if (/^(?:i(?:'ll| will)|let me|i need to)\b/i.test(findings) || !/\b(?:findings?|critical|high|medium|low)\b/i.test(findings)) {
    throw new Error('JUL-208 reviewer did not return findings')
  }
  return findings
}

export async function candidateIdentity(cwd = repositoryRoot): Promise<CandidateIdentity> {
  const [{ stdout: commit }, { stdout: diff }, { stdout: untracked }] = await Promise.all([
    execute('git', ['-C', cwd, 'rev-parse', '--verify', 'HEAD'], { windowsHide: true }),
    execute('git', ['-C', cwd, 'diff', '--binary', 'HEAD'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }),
    execute('git', ['-C', cwd, 'ls-files', '--others', '--exclude-standard', '-z'], { windowsHide: true }),
  ])
  const hash = createHash('sha256').update(diff)
  for (const relativePath of untracked.split('\0').filter(Boolean).sort()) {
    hash.update(relativePath)
    hash.update(await readFile(resolve(cwd, relativePath)))
  }
  return {
    candidateCommit: commit.trim(),
    dirtyTreeDigest: `sha256:${hash.digest('hex')}`,
  }
}

export function assertStableCandidateIdentity(start: CandidateIdentity, end: CandidateIdentity) {
  if (end.candidateCommit !== start.candidateCommit || end.dirtyTreeDigest !== start.dirtyTreeDigest) {
    throw new Error('candidate identity changed during rehearsal')
  }
  return end
}

async function inventoryFromFrameworkMap(frameworkMapPath: string) {
  const map = await readFile(frameworkMapPath, 'utf8')
  const match = /^Doctor inventory: `([^`]+)`\.$/m.exec(map)
  if (!match) throw new Error('framework map does not name the Doctor inventory')
  return resolve(moduleDirectory, '../../../../..', match[1])
}

export async function doctor(frameworkMapPath = defaultFrameworkMapPath, identityProvider: IdentityProvider = candidateIdentity) {
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
  return { ...await identityProvider(), ok: missing.length === 0 && versionMismatches.length === 0, inventoryPath, checked: inventory.parts.length, missing, versionMismatches }
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
    return rethrowAfterCleanup(error, () => cleanupAcpRoutes(routes))
  }
}

async function cliJourneyProof(apiKey: string, evidenceDirectory: string, roles: Record<string, unknown>) {
  const configDirectory = resolve(evidenceDirectory, `cli-state-${process.pid}`)
  const cli = resolve(moduleDirectory, 'cli.ts')
  const environment: NodeJS.ProcessEnv = { ...process.env, COMMANDCODE_API_KEY: apiKey, JULIA_CONFIG_DIRECTORY: configDirectory }
  const linearKey = environment.LINEAR_API_KEY
  if (!linearKey) throw new Error('LINEAR_API_KEY was not resolved for serialized incomplete-card proof')
  const realCard = await fetchLinearCard('JUL-225', linearKey)
  let incompleteReadyRefusal: { sourceIdentifier: string; sourceState: string; refused: boolean; error: string } | undefined
  try {
    await fetchLinearCard(realCard.identifier, linearKey, async () => new Response(JSON.stringify({ data: { issue: {
      identifier: realCard.identifier, state: { name: realCard.state }, description: '# Outcome\nOnly one section',
    } } }), { status: 200, headers: { 'content-type': 'application/json' } }))
  } catch (error) {
    incompleteReadyRefusal = {
      sourceIdentifier: realCard.identifier,
      sourceState: realCard.state,
      refused: /missing nonempty Requirements section/.test((error as Error).message),
      error: (error as Error).message,
    }
  }
  if (!incompleteReadyRefusal?.refused) throw new Error('serialized incomplete Ready Linear intake was not refused')
  const expectFailure = async (name: string, args: string[], env = environment, expected?: RegExp) => {
    try {
      await execute(process.execPath, ['--experimental-strip-types', cli, ...args], { env, windowsHide: true })
      throw new Error(`expected CLI failure for ${args.join(' ')}`)
    } catch (error) {
      const failure = error as Error & { stderr?: string; code?: number }
      if (failure.message.startsWith('expected CLI failure')) throw failure
      const message = String(failure.stderr || failure.message).trim()
      if (expected && !expected.test(message)) throw new Error(`${name} failed for the wrong reason: ${message}`)
      return { name, args, exitCode: failure.code, message }
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
    outputs.push(ConnectionsResultSchema.parse(JSON.parse(stdout)))
  }
  const persisted = ConnectionRecordSchema.array().parse(JSON.parse(await readFile(resolve(configDirectory, 'connections.json'), 'utf8')))
  const serialized = JSON.stringify({ outputs, persisted })
  const defaultsPath = resolve(evidenceDirectory, 'role-defaults-proof.json')
  await writeFile(defaultsPath, `${JSON.stringify(roles, null, 2)}\n`, 'utf8')
  const save = await execute(process.execPath, ['--experimental-strip-types', cli, 'models', 'save', defaultsPath], { env: environment, windowsHide: true })
  const list = await execute(process.execPath, ['--experimental-strip-types', cli, 'models', 'list'], { env: environment, windowsHide: true })
  const preview = await execute(process.execPath, ['--experimental-strip-types', cli, 'init', 'JUL-225'], { env: environment, windowsHide: true })
  const cancel = await execute(process.execPath, ['--experimental-strip-types', cli, 'init', 'JUL-225', 'Cancel'], { env: environment, windowsHide: true })
  const negative = [
    await expectFailure('invalid-decision', ['init', 'JUL-225', 'Go']),
    await expectFailure('missing-authorization', ['init', 'JUL-225', 'Start']),
    await expectFailure('non-ready-incomplete-card', ['init', 'JUL-228', 'Start'], { ...environment, JULIA_START_AUTHORIZED: 'JUL-228' }, /(?=[\s\S]*expected Ready state)(?=[\s\S]*missing nonempty Outcome section)/),
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
  const startEnvironment = { ...environment, JULIA_START_AUTHORIZED: 'JUL-225', JULIA_VERIFY_MACHINE: '1', JULIA_STOP_AFTER_SNAPSHOT: '1', JULIA_REHEARSAL_PROMPT: 'Perform a concise read-only route health assessment. Do not change files or external state.' }
  await execute(process.execPath, ['--experimental-strip-types', cli, 'connections', 'disable', 'claude'], { env: environment, windowsHide: true })
  negative.push(await expectFailure('disabled-connection', ['init', 'JUL-225', 'Start'], startEnvironment))
  await execute(process.execPath, ['--experimental-strip-types', cli, 'connections', 'reconnect', 'claude'], { env: environment, windowsHide: true })
  const failedRecords = ConnectionRecordSchema.array().parse(JSON.parse(await readFile(resolve(configDirectory, 'connections.json'), 'utf8')))
    .map(record => record.route === 'claude' ? { ...record, enabled: true, lastTest: { ok: false, testedAt: new Date().toISOString(), modelCount: 0 } } : record)
  await writeFile(resolve(configDirectory, 'connections.json'), `${JSON.stringify(failedRecords, null, 2)}\n`, 'utf8')
  negative.push(await expectFailure('failed-connection', ['init', 'JUL-225', 'Start'], startEnvironment))
  await execute(process.execPath, ['--experimental-strip-types', cli, 'connections', 'test', 'claude'], { env: environment, windowsHide: true })
  const invalidRoles = structuredClone(roles) as Record<string, { company?: string; modelId?: string }>
  if (invalidRoles.reviewer) invalidRoles.reviewer.company = 'Google'
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(invalidRoles, null, 2)}\n`, 'utf8')
  negative.push(await expectFailure('invalid-roles', ['init', 'JUL-225', 'Start'], startEnvironment))
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(roles, null, 2)}\n`, 'utf8')
  const staleRoles = structuredClone(roles) as Record<string, { modelId?: string }>
  if (staleRoles.builder) staleRoles.builder.modelId = 'unavailable-model'
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(staleRoles, null, 2)}\n`, 'utf8')
  negative.push(await expectFailure('stale-model', ['init', 'JUL-225', 'Start'], startEnvironment))
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(roles, null, 2)}\n`, 'utf8')
  const prepared = await execute(process.execPath, ['--experimental-strip-types', cli, 'init', 'JUL-225', 'Start'], { env: startEnvironment, windowsHide: true })
  const changed = structuredClone(roles) as Record<string, { modelId?: string }>
  if (changed.builder) changed.builder.modelId = 'changed-after-safe-boundary'
  await writeFile(resolve(configDirectory, 'role-defaults.json'), `${JSON.stringify(changed, null, 2)}\n`, 'utf8')
  const { JULIA_STOP_AFTER_SNAPSHOT: _stopped, ...resumeEnvironment } = startEnvironment
  const resumed = await execute(process.execPath, ['--experimental-strip-types', cli, 'init', 'JUL-225', 'Start'], { env: resumeEnvironment, windowsHide: true })
  const preparedResult = InitResultSchema.parse(JSON.parse(prepared.stdout))
  const resumedResult = InitResultSchema.parse(JSON.parse(resumed.stdout))
  if (preparedResult.status !== 'started' || resumedResult.status !== 'started') throw new Error('Start proof did not return started results')
  return {
    connections: { commands: commands.map(command => command[1]), outputs, persisted, secretValueAbsent: !serialized.includes(apiKey) },
    models: { save: ModelsResultSchema.parse(JSON.parse(save.stdout)), list: ModelsResultSchema.parse(JSON.parse(list.stdout)) },
    init: {
      preview: InitResultSchema.parse(JSON.parse(preview.stdout)), cancel: InitResultSchema.parse(JSON.parse(cancel.stdout)), prepared: preparedResult, resumed: resumedResult,
      negativePreconditions: negative,
      serializedIncompleteIntake: { method: 'fetchLinearCard parser over a serialized incomplete variant of the real Ready source card', productMutation: false, ...incompleteReadyRefusal },
      exactSnapshotReused: JSON.stringify(preparedResult.snapshot) === JSON.stringify(resumedResult.snapshot),
      defaultsChangedAfterBoundary: changed.builder?.modelId === 'changed-after-safe-boundary',
    },
  }
}

export async function rehearsal(apiKey: string, evidencePath: string, identityProvider: IdentityProvider = candidateIdentity) {
  let proof: Awaited<ReturnType<typeof liveModelProof>> | undefined
  return withFinalCleanup(async () => {
    const evidenceDirectory = dirname(evidencePath)
    await mkdir(evidenceDirectory, { recursive: true })
    const identityAtStart = await identityProvider()
    proof = await liveModelProof(apiKey)
    const linearTracePath = resolve(evidenceDirectory, 'jul-208-linear-read.json')
    const card = await fetchRehearsalCard(undefined, fetch, trace => writeFile(linearTracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8'))
    const workflow = createRoleExecutionWorkflow({
      routes: proof.routes,
      commandCodeKey: () => apiKey,
      promptForRole: (role, _issueId, priorResults) => jul208Prompt(role, card, priorResults),
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
    const builderProposalPath = resolve(evidenceDirectory, 'jul-208-builder-proposal.md')
    const reviewerFindingsPath = resolve(evidenceDirectory, 'jul-208-review-findings.md')
    await writeFile(builderProposalPath, `${output.results.builder.trim()}\n`, 'utf8')
    await writeFile(reviewerFindingsPath, `${output.results.reviewer.trim()}\n`, 'utf8')
    assertStableCandidateIdentity(identityAtStart, await identityProvider())
    assertReviewerFindings(output.results.reviewer)
    const cli = await cliJourneyProof(apiKey, dirname(evidencePath), inputData.snapshot.roles)
    const identityAtEnd = assertStableCandidateIdentity(identityAtStart, await identityProvider())
    const result = {
      recordedAt: new Date().toISOString(),
      ...identityAtEnd,
      productMutation: false,
      workflowStatus: workflowResult.status,
      workflowRunId: output.runId,
      workflowSnapshot,
      jul208: {
        card: { identifier: card.identifier, title: card.title, state: card.state },
        linearReadTrace: linearTracePath,
        builderProposal: { path: builderProposalPath, bytes: Buffer.byteLength(output.results.builder, 'utf8') },
        reviewerFindings: { path: reviewerFindingsPath, bytes: Buffer.byteLength(output.results.reviewer, 'utf8'), reviewedExactBuilderOutput: true },
      },
      traces: output.traces,
      modelOffers: { count: proof.offers.length, everyDisplayedOfferSelectable: true },
      cli,
      routes: {
        antigravity: { model: proof.selected.antigravity.modelId, ok: Boolean(output.results.builder.trim() && output.results.fixReviewer.trim()) },
        claude: { model: proof.selected.claude.modelId, ok: Boolean(output.results.crashFixer.trim()) },
        commandcode: { model: proof.selected.commandcode.modelId, ok: Boolean(output.results.reviewer.trim()) },
      },
    }
    await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    if (!Object.values(result.routes).every(route => route.ok)) throw new Error('one or more real routes returned an empty rehearsal result')
    return result
  }, async () => { if (proof) await cleanupAcpRoutes(proof.routes) })
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
