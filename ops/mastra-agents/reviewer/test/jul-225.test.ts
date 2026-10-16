import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  CardAdmissionSchema,
  ConnectionsCommandSchema,
  ConnectionsResultSchema,
  ConnectionRecordSchema,
  DeliveryStartSchema,
  InitCommandSchema,
  InitResultSchema,
  ModelOfferSchema,
  ModelsCommandSchema,
  ModelsResultSchema,
  RoleDefaultsSchema,
  SecretReferenceSchema,
  WorkflowInputSchema,
  WorkflowOutputSchema,
  WorkflowSnapshotSchema,
} from '../src/mastra/contracts.ts'
import { ConnectionStore } from '../src/mastra/connections.ts'
import { fetchLinearCard } from '../src/mastra/cli.ts'
import { validateRoleDefaults } from '../src/mastra/roles.ts'
import { decideStart, ensureSelectionsOffered, loadSavedSnapshot, validateStartPreconditions } from '../src/mastra/init.ts'
import { createAcpRoutes, discoverAcpOffers, discoverCommandCodeOffers, ownedAcpProcesses, selectAcpModel, stopExactWindowsProcesses, waitForAcpProcessExit, withAcpRoutes } from '../src/mastra/routes.ts'
import type { WindowsProcessIdentity } from '../src/mastra/routes.ts'
import { createRoleExecutionWorkflow } from '../src/mastra/workflows/delivery.ts'

test('secret and persisted connection contracts reject secret values', () => {
  assert.equal(SecretReferenceSchema.parse('COMMANDCODE_API_KEY'), 'COMMANDCODE_API_KEY')
  assert.throws(() => SecretReferenceSchema.parse('sk-this-is-a-secret-value'))
  assert.throws(() => ConnectionRecordSchema.parse({
    id: 'commandcode', route: 'commandcode', company: 'DeepSeek', service: 'CommandCode',
    enabled: true, secretReference: 'Bearer actual-secret',
  }))
})

test('real file-backed connection lifecycle persists only parsed records and redacted output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul-225-connections-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'connections.json')
  const store = new ConnectionStore(path)
  await store.add({ id: 'commandcode', route: 'commandcode', company: 'DeepSeek', service: 'CommandCode', enabled: true, secretReference: 'COMMANDCODE_API_KEY' })
  await store.reconnect('commandcode', { secretReference: 'COMMANDCODE_API_KEY' })
  await store.recordTest('commandcode', { ok: true, modelCount: 2 })
  await store.disable('commandcode')
  assert.equal((await store.list())[0]?.enabled, false)
  await store.remove('commandcode')
  assert.deepEqual(await store.list(), [])
  assert.doesNotMatch(await readFile(path, 'utf8'), /actual-secret|Bearer\s/i)
})

test('model offers keep duplicate IDs distinct by route', () => {
  const antigravity = ModelOfferSchema.parse({ route: 'antigravity', modelId: 'claude-sonnet-4-6', name: 'Shared', company: 'Google', service: 'Antigravity', codingCapable: true, supportedEfforts: ['low'] })
  const claude = ModelOfferSchema.parse({ route: 'claude', modelId: 'claude-sonnet-4-6', name: 'Shared', company: 'Anthropic', service: 'Claude', codingCapable: true, supportedEfforts: ['low'] })
  assert.notEqual(`${antigravity.route}:${antigravity.modelId}`, `${claude.route}:${claude.modelId}`)
})

test('Claude discovery offers only exact provider model IDs from the session config option', async () => {
  const traces: unknown[] = []
  const routes = {
    antigravity: { getAvailableModels: async () => [] },
    claude: {
      getAvailableModels: async () => [],
      connection: { session: { sessionId: 'claude-session', configOptions: [{
        id: 'model', type: 'select', currentValue: 'default', options: [
          { value: 'default', name: 'Default' },
          { value: 'opus', name: 'Opus' },
          { value: 'sonnet', name: 'Sonnet' },
          { value: 'fable', name: 'Fable' },
          { value: 'haiku', name: 'Haiku' },
          { value: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
          { value: 'claude-fable-5', name: 'Fable 5' },
          { value: 'claude-fable-5-1[1m]', name: 'Malformed terminal-styled ID' },
          { value: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
        ],
      }] },
      connection: { setSessionConfigOption: async ({ value }: { value: string }) => {
        if (value === 'claude-fable-5') throw new Error('Internal error')
        return { configOptions: [{ id: 'model', currentValue: value, options: [] }] }
      } },
    },
    },
  }
  const offers = await discoverAcpOffers(routes as never, trace => traces.push(trace))
  assert.deepEqual(offers.map(offer => [offer.route, offer.modelId]), [
    ['claude', 'claude-haiku-4-5-20251001'],
    ['claude', 'claude-sonnet-4-6'],
  ])
  assert.deepEqual(traces.filter(trace => (trace as { event?: string }).event === 'model-discovery-probe'), [{
    event: 'model-discovery-probe',
    route: 'claude',
    operation: 'session/set_config_option',
    modelId: 'claude-fable-5',
    ok: false,
    error: 'Claude model "claude-fable-5" selection failed: Internal error',
  }])
  assert.deepEqual(traces.filter(trace => (trace as { event?: string }).event === 'model-discovery').map(trace => {
    const value = trace as { route: string; ok: boolean; offerCount: number }
    return { route: value.route, ok: value.ok, offerCount: value.offerCount }
  }), [
    { route: 'antigravity', ok: true, offerCount: 0 },
    { route: 'claude', ok: true, offerCount: 2 },
  ])
})

test('Claude selection and restart reapply the same exact provider model ID', async () => {
  const requests: Array<{ sessionId: string; configId: string; value: string }> = []
  const sessions: Array<{ configOptions: Array<{ id: string; currentValue: string }> }> = []
  const makeRoutes = (sessionId: string) => {
    const options = [{ value: 'default', name: 'Default' }, { value: 'claude-sonnet-4-6', name: 'Sonnet 4.6' }]
    const session = { sessionId, configOptions: [{ id: 'model', currentValue: 'default', options }] }
    sessions.push(session)
    return {
      antigravity: {},
      claude: {
        getAvailableModels: async () => [],
        connection: {
          session,
          connection: {
            setSessionConfigOption: async (request: { sessionId: string; configId: string; value: string }) => {
              requests.push(request)
              return { configOptions: [{ id: 'model', currentValue: request.value, options }] }
            },
          },
        },
      },
    }
  }
  const selection = { route: 'claude' as const, modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' }
  await selectAcpModel(makeRoutes('initial-session') as never, selection)
  await selectAcpModel(makeRoutes('restart-session') as never, selection)
  assert.deepEqual(requests, [
    { sessionId: 'initial-session', configId: 'model', value: 'claude-sonnet-4-6' },
    { sessionId: 'restart-session', configId: 'model', value: 'claude-sonnet-4-6' },
  ])
  assert.deepEqual(sessions.map(session => session.configOptions.find(option => option.id === 'model')?.currentValue), [
    'claude-sonnet-4-6', 'claude-sonnet-4-6',
  ])
})

test('Claude aliases cannot be saved as role defaults', () => {
  const exact = { route: 'claude' as const, modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' }
  const commandcode = { route: 'commandcode' as const, modelId: 'deepseek-v3', company: 'DeepSeek', service: 'CommandCode' }
  const defaults = { builder: exact, reviewer: commandcode, crashFixer: exact, fixReviewer: commandcode }
  assert.equal(RoleDefaultsSchema.parse(defaults).builder.modelId, 'claude-sonnet-4-6')
  for (const alias of ['default', 'opus', 'sonnet', 'fable', 'haiku']) {
    assert.throws(() => RoleDefaultsSchema.parse({ ...defaults, builder: { ...exact, modelId: alias } }), /full provider model ID/)
  }
})

test('Claude selection refuses a saved model that the new session no longer offers', async () => {
  let requests = 0
  const routes = {
    antigravity: {},
    claude: {
      getAvailableModels: async () => [],
      connection: {
        session: { sessionId: 'restart-session', configOptions: [{
          id: 'model', currentValue: 'default', options: [{ value: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' }],
        }] },
        connection: { setSessionConfigOption: async () => { requests += 1; return { configOptions: [] } } },
      },
    },
  }
  await assert.rejects(selectAcpModel(routes as never, {
    route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude',
  }), /not currently offered/)
  assert.equal(requests, 0)
})

test('Claude selection refuses a bridge response that does not confirm the exact saved ID', async () => {
  const options = [{ value: 'claude-sonnet-4-6', name: 'Sonnet 4.6' }]
  const routes = {
    antigravity: {},
    claude: {
      getAvailableModels: async () => [],
      connection: {
        session: { sessionId: 'claude-session', configOptions: [{ id: 'model', currentValue: 'default', options }] },
        connection: { setSessionConfigOption: async () => ({
          configOptions: [{ id: 'model', currentValue: 'default', options }],
        }) },
      },
    },
  }
  await assert.rejects(selectAcpModel(routes as never, {
    route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude',
  }), /selected "default" instead/)
})

test('Claude route accepts only the bridge auth-status extension notification', async () => {
  const createClient = createAcpRoutes().claude.connection.options.createClient
  assert.ok(createClient)
  const client = createClient({} as never)
  const notify = client.extNotification?.bind(client)
  assert.ok(notify)
  await assert.doesNotReject(notify('_auth/status_update', { authStatus: { kind: 'account', label: 'Claude Max' } }))
  await assert.rejects(notify('unknown/notification', {}), /unsupported Claude ACP notification/)
})

test('CommandCode discovery keeps coding endpoints and rejects decision-only models', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ data: [
    { id: 'claude-a', supported_endpoints: ['/v1/messages'] },
    { id: 'gpt-a', supported_endpoints: ['/v1/responses'] },
    { id: 'legacy-a', supported_endpoints: ['/v1/chat/completions'] },
    { id: 'systemone', supported_endpoints: ['/systemone'] },
  ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  const offers = await discoverCommandCodeOffers('reference-only', fetchImpl as typeof fetch)
  assert.deepEqual(offers.map(({ modelId, wire }) => [modelId, wire]), [
    ['claude-a', 'messages'], ['gpt-a', 'responses'], ['legacy-a', 'chat'],
  ])
})

test('standalone ACP route scope disconnects and cleans only processes it created', async () => {
  const ownedProcess = { pid: 20 }
  const ownedIdentity = { processId: 30, parentProcessId: 20, name: 'agy_acp_server.exe', creationDate: '2026-10-15T00:00:00.0000000-07:00', executablePath: 'C:\\agy_acp_server.exe' }
  const owned = await ownedAcpProcesses({
    antigravity: { connection: { agentProcess: ownedProcess } },
    claude: { connection: {} },
  } as never, async () => [
    ownedIdentity,
    { processId: 40, parentProcessId: 19, name: 'agy_acp_server.exe', creationDate: '2026-10-15T00:00:01.0000000-07:00', executablePath: 'C:\\agy_acp_server.exe' },
  ])
  assert.deepEqual(owned, { roots: [ownedProcess], descendants: [ownedIdentity] })

  const initializationFailureRoutes = createAcpRoutes()
  const clearedConnection = initializationFailureRoutes.antigravity.connection as unknown as { agentProcess?: unknown }
  const failedLauncher = { pid: 50 }
  clearedConnection.agentProcess = failedLauncher
  clearedConnection.agentProcess = undefined
  const orphanIdentity = { ...ownedIdentity, processId: 60, parentProcessId: 50 }
  const failedInitializationOwned = await ownedAcpProcesses(initializationFailureRoutes, async () => [orphanIdentity])
  assert.deepEqual(failedInitializationOwned, { roots: [failedLauncher], descendants: [orphanIdentity] })

  const exitedLauncher = { pid: 50, exitCode: 1, signalCode: null }
  const reusedLauncherIdentity = { ...ownedIdentity, processId: 50, parentProcessId: 4, name: 'unrelated.exe' }
  const unrelatedDescendant = { ...orphanIdentity, processId: 61 }
  const reusedLauncherOwned = await ownedAcpProcesses({
    antigravity: { connection: { agentProcess: exitedLauncher } },
    claude: { connection: {} },
  } as never, async () => [reusedLauncherIdentity, unrelatedDescendant])
  assert.deepEqual(reusedLauncherOwned, { roots: [exitedLauncher], descendants: [] })

  const reusedPid = { ...ownedIdentity, creationDate: '2026-10-15T00:00:02.0000000-07:00' }
  const changedPath = { ...ownedIdentity, executablePath: 'C:\\unrelated\\agy_acp_server.exe' }
  const terminated: WindowsProcessIdentity[] = []
  let inventoryRead = 0
  await stopExactWindowsProcesses([ownedIdentity], async () => {
    inventoryRead += 1
    return inventoryRead === 1 ? [ownedIdentity, reusedPid, changedPath] : [reusedPid, changedPath]
  }, async processes => { terminated.push(...processes) })
  assert.deepEqual(terminated, [ownedIdentity])

  const forcedSignals: Array<NodeJS.Signals | number | undefined> = []
  const listeners: Array<() => void> = []
  const exitingProcess = {
    pid: 20, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    once: (_event: string, listener: () => void) => { listeners.push(listener); return exitingProcess },
    off: (_event: string, listener: () => void) => { listeners.splice(listeners.indexOf(listener), 1); return exitingProcess },
    kill: (signal?: NodeJS.Signals | number) => { forcedSignals.push(signal); exitingProcess.exitCode = 0; for (const listener of [...listeners]) listener(); return true },
  }
  await waitForAcpProcessExit(exitingProcess as never, 0)
  assert.deepEqual(forcedSignals, ['SIGKILL'])

  const events: string[] = []
  const routes = { antigravity: {}, claude: {} }
  const lateOwnedIdentity = { ...ownedIdentity, processId: 31, parentProcessId: 20, creationDate: '2026-10-15T00:00:03.0000000-07:00' }
  const rootExitOwnedIdentity = { ...ownedIdentity, processId: 32, parentProcessId: 20, creationDate: '2026-10-15T00:00:04.0000000-07:00' }
  let ownedCaptureCount = 0
  const result = await withAcpRoutes(async active => {
    assert.equal(active, routes)
    events.push('use')
    return 'done'
  }, {
    captureOwnedProcesses: async () => {
      events.push('capture-owned')
      ownedCaptureCount += 1
      const descendants = ownedCaptureCount === 1
        ? [ownedIdentity]
        : ownedCaptureCount === 2 ? [ownedIdentity, lateOwnedIdentity] : [ownedIdentity, lateOwnedIdentity, rootExitOwnedIdentity]
      return { roots: [ownedProcess], descendants } as never
    },
    createRoutes: () => routes as never,
    disconnectRoutes: () => { events.push('disconnect') },
    stopOwnedProcesses: async processes => {
      events.push(`cleanup:roots=${processes.roots.length};descendants=${processes.descendants.map(process => process.processId).join(',')}`)
    },
  })
  assert.equal(result, 'done')
  assert.deepEqual(events, [
    'use',
    'capture-owned',
    'disconnect',
    'capture-owned',
    'cleanup:roots=1;descendants=',
    'capture-owned',
    'cleanup:roots=0;descendants=30,31,32',
  ])

  events.length = 0
  await assert.rejects(withAcpRoutes(async () => { throw new Error('route failed') }, {
    captureOwnedProcesses: async () => ({ roots: [ownedProcess], descendants: [ownedIdentity] }) as never,
    createRoutes: () => routes as never,
    disconnectRoutes: () => { events.push('disconnect') },
    stopOwnedProcesses: async () => { events.push('cleanup') },
  }), /route failed/)
  assert.deepEqual(events, ['disconnect', 'cleanup', 'cleanup'])

  await assert.rejects(withAcpRoutes(async () => { throw new Error('route failed') }, {
    captureOwnedProcesses: async () => ({ roots: [ownedProcess], descendants: [ownedIdentity] }) as never,
    createRoutes: () => routes as never,
    disconnectRoutes: () => {},
    stopOwnedProcesses: async () => { throw new Error('cleanup failed') },
  }), error => error instanceof AggregateError
    && error.errors.some(item => item instanceof Error && item.message === 'route failed')
    && error.errors.some(item => item instanceof Error && item.message === 'cleanup failed'))

  await assert.rejects(withAcpRoutes(async () => { throw undefined }, {
    captureOwnedProcesses: async () => ({ roots: [ownedProcess], descendants: [ownedIdentity] }) as never,
    createRoutes: () => routes as never,
    disconnectRoutes: () => {},
    stopOwnedProcesses: async () => { throw new Error('cleanup failed') },
  }), error => error instanceof AggregateError
    && error.errors[0] === undefined
    && error.errors.some(item => item instanceof Error && item.message === 'cleanup failed'))
})

test('four-role company and normal service rules are exhaustive', () => {
  const selection = (company: string, service: string, route: 'antigravity' | 'claude' | 'commandcode') => ({
    route, modelId: route === 'claude' ? 'claude-sonnet-4-6' : 'm', company, service,
  })
  const valid = RoleDefaultsSchema.parse({
    builder: selection('Google', 'Antigravity', 'antigravity'), reviewer: selection('DeepSeek', 'CommandCode', 'commandcode'),
    crashFixer: selection('Anthropic', 'Claude', 'claude'), fixReviewer: selection('Google', 'Antigravity', 'antigravity'),
  })
  for (const builderCompany of ['Google', 'Anthropic']) for (const reviewerCompany of ['Google', 'Anthropic']) {
    for (const builderService of ['Antigravity', 'Claude']) for (const reviewerService of ['Antigravity', 'Claude']) {
      const candidate = { ...valid, builder: selection(builderCompany, builderService, 'antigravity'), reviewer: selection(reviewerCompany, reviewerService, 'commandcode') }
      const accepted = builderCompany !== reviewerCompany && builderService !== reviewerService
      assert.equal(assertionPasses(() => validateRoleDefaults(candidate)), accepted)
      assert.equal(assertionPasses(() => validateRoleDefaults(candidate, { allowSameService: true })), builderCompany !== reviewerCompany)
    }
  }
  for (const crashCompany of ['Google', 'Anthropic']) for (const reviewCompany of ['Google', 'Anthropic']) {
    const candidate = { ...valid, crashFixer: selection(crashCompany, 'Claude', 'claude'), fixReviewer: selection(reviewCompany, 'Antigravity', 'antigravity') }
    assert.equal(assertionPasses(() => validateRoleDefaults(candidate)), crashCompany !== reviewCompany)
  }
  assert.doesNotThrow(() => validateRoleDefaults({ ...valid, reviewer: selection('DeepSeek', 'Antigravity', 'antigravity') }, { allowSameService: true }))
})

function assertionPasses(assertion: () => unknown) {
  try { assertion(); return true } catch { return false }
}

test('admission requires the complete settled card shape and Ready state', () => {
  const complete = { identifier: 'JUL-225', state: 'Ready', description: '# Outcome\nA\n# Requirements\nB\n# Contracts\nC\n# Finish conditions\nD\n# Proof\nE' }
  assert.equal(CardAdmissionSchema.parse(complete).identifier, 'JUL-225')
  assert.throws(() => CardAdmissionSchema.parse({ ...complete, state: 'Backlog' }))
  assert.throws(() => CardAdmissionSchema.parse({ ...complete, description: '# Outcome\nA' }))
  const nonReadyIncomplete = CardAdmissionSchema.safeParse({ ...complete, state: 'Backlog', description: '# Outcome\nA' })
  assert.equal(nonReadyIncomplete.success, false)
  if (!nonReadyIncomplete.success) {
    const messages = nonReadyIncomplete.error.issues.map(issue => issue.message)
    assert.ok(messages.includes('expected Ready state'))
    assert.ok(messages.includes('missing nonempty Requirements section'))
    assert.ok(messages.includes('missing nonempty Contracts section'))
    assert.ok(messages.includes('missing nonempty Finish conditions section'))
    assert.ok(messages.includes('missing nonempty Proof section'))
  }
  assert.throws(() => CardAdmissionSchema.parse({ ...complete, description: `${complete.description}\nTODO: decision` }))
  const linear = { ...complete, description: '**Outcome**\nA\n\n**Requirements**\nB\n\n**Contracts**\nC\n\n**Finish conditions**\nD\n\n**Proof**\nE' }
  assert.throws(() => CardAdmissionSchema.parse(linear), /missing nonempty Outcome section/)
})

test('admission keeps ordinary bold paragraphs inside a section', () => {
  const description = [
    '# Outcome',
    '**Requirements**',
    '**Important:** bold lines are body text, not section headings.',
    'A complete outcome.',
    '# Requirements',
    'B',
    '# Contracts',
    'C',
    '# Finish conditions',
    'D',
    '# Proof',
    'E',
  ].join('\n')
  assert.equal(CardAdmissionSchema.parse({ identifier: 'JUL-225', state: 'Ready', description }).identifier, 'JUL-225')
  assert.throws(() => CardAdmissionSchema.parse({
    identifier: 'JUL-225', state: 'Ready', description: description.replace('# Outcome', '**Outcome**'),
  }), /missing nonempty Outcome section/)
  assert.throws(() => CardAdmissionSchema.parse({
    identifier: 'JUL-225', state: 'Ready',
    description: description.replace('**Requirements**\n**Important:** bold lines are body text, not section headings.\nA complete outcome.', '# Notes\nNotes are not Outcome content.'),
  }), /empty Outcome section/)
  assert.throws(() => CardAdmissionSchema.parse({
    identifier: 'JUL-225', state: 'Ready',
    description: description.replace('# Outcome\n**Requirements**\n**Important:** bold lines are body text, not section headings.\nA complete outcome.', '#\nOutcome\nA complete outcome.'),
  }), /missing nonempty Outcome section/)
})

test('admission rejects unresolved decision markers embedded in prose', () => {
  const description = '# Outcome\nA\n# Requirements\nStatus: TBD before delivery.\n# Contracts\nC\n# Finish conditions\nD\n# Proof\nE'
  assert.throws(() => CardAdmissionSchema.parse({ identifier: 'JUL-225', state: 'Ready', description }), /unresolved decision marker/)
  assert.throws(() => CardAdmissionSchema.parse({ identifier: 'JUL-225', state: 'Ready', description: description.replace('Status: TBD before delivery.', '- TODO choose provider') }), /unresolved decision marker/)
  assert.throws(() => CardAdmissionSchema.parse({ identifier: 'JUL-225', state: 'Ready', description: description.replace('Status: TBD before delivery.', 'Status: unresolved decision — choose provider') }), /unresolved decision marker/)
  assert.throws(() => CardAdmissionSchema.parse({ identifier: 'JUL-225', state: 'Ready', description: description.replace('Status: TBD before delivery.', 'Status: unresolved decision marker: choose provider') }), /unresolved decision marker/)
  assert.throws(() => CardAdmissionSchema.parse({ identifier: 'JUL-225', state: 'Ready', description: description.replace('Status: TBD before delivery.', 'Provider remains an unresolved-decision marker in this line.') }), /unresolved decision marker/)
  assert.throws(() => CardAdmissionSchema.parse({ identifier: 'JUL-225', state: 'Ready', description: description.replace('Status: TBD before delivery.', 'TODOs: choose provider') }), /unresolved decision marker/)
  assert.throws(() => CardAdmissionSchema.parse({ identifier: 'JUL-225', state: 'Ready', description: description.replace('Status: TBD before delivery.', 'Unresolved decisions: choose provider') }), /unresolved decision marker/)
  assert.doesNotThrow(() => CardAdmissionSchema.parse({
    identifier: 'JUL-225', state: 'Ready',
    description: '# Outcome\nA\n# Requirements\nA complete card has no unresolved decision marker.\n# Contracts\nC\n# Finish conditions\nD\n# Proof\nE',
  }))
})

test('serialized Linear intake rejects an incomplete Ready card', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ data: { issue: {
    identifier: 'JUL-227', state: { name: 'Ready' }, description: '# Outcome\nOnly one section',
  } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  await assert.rejects(fetchLinearCard('JUL-227', 'reference-only', fetchImpl as typeof fetch), /missing nonempty Requirements section/)
})

test('Cancel never dispatches and restart reuses the immutable snapshot', async () => {
  let dispatches = 0
  const snapshot = RoleDefaultsSchema.parse({
    builder: { route: 'antigravity', modelId: 'a', company: 'Google', service: 'Antigravity' },
    reviewer: { route: 'commandcode', modelId: 'b', company: 'DeepSeek', service: 'CommandCode' },
    crashFixer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
    fixReviewer: { route: 'antigravity', modelId: 'd', company: 'Google', service: 'Antigravity' },
  })
  assert.deepEqual(await decideStart({ decision: 'Cancel', snapshot, dispatch: async () => { dispatches += 1 } }), { status: 'cancelled' })
  assert.equal(dispatches, 0)
  const started = await decideStart({ decision: 'Start', snapshot, dispatch: async saved => { dispatches += 1; return saved } })
  snapshot.builder.modelId = 'changed-after-save'
  assert.equal(started.status, 'started')
  assert.equal(started.snapshot.builder.modelId, 'a')
  assert.equal(dispatches, 1)
})

test('admission refuses stale defaults that are not in the current route offers', () => {
  const roles = RoleDefaultsSchema.parse({
    builder: { route: 'antigravity', modelId: 'a', company: 'Google', service: 'Antigravity' },
    reviewer: { route: 'commandcode', modelId: 'b', company: 'DeepSeek', service: 'CommandCode' },
    crashFixer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
    fixReviewer: { route: 'antigravity', modelId: 'd', company: 'Google', service: 'Antigravity' },
  })
  const offers = Object.values(roles).map(selection => ModelOfferSchema.parse({
    ...selection, name: selection.modelId, codingCapable: true, supportedEfforts: ['low'],
  }))
  assert.doesNotThrow(() => ensureSelectionsOffered(roles, offers))
  assert.throws(() => ensureSelectionsOffered(roles, offers.slice(0, 3)), /fixReviewer.*unavailable/)
  assert.throws(() => ensureSelectionsOffered(roles, [{ route: 'antigravity', modelId: 'a' }]), /name/)
})

test('restart reuses the exact persisted four-role snapshot after live defaults change', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul-225-restart-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'JUL-225.json')
  const roles = RoleDefaultsSchema.parse({
    builder: { route: 'antigravity', modelId: 'saved-a', company: 'Google', service: 'Antigravity' },
    reviewer: { route: 'commandcode', modelId: 'saved-b', company: 'Anthropic', service: 'CommandCode' },
    crashFixer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
    fixReviewer: { route: 'antigravity', modelId: 'saved-d', company: 'Google', service: 'Antigravity' },
  })
  await writeFile(path, JSON.stringify({ issueId: 'JUL-225', savedAt: new Date().toISOString(), roles }))
  const changedDefaults = structuredClone(roles)
  changedDefaults.builder.modelId = 'new-live-default'
  const resumed = await loadSavedSnapshot(path, 'JUL-225')
  assert.equal(resumed.roles.builder.modelId, 'saved-a')
  assert.notDeepEqual(resumed.roles, changedDefaults)
})

test('every named Start precondition fails before dispatch', () => {
  const roles = RoleDefaultsSchema.parse({
    builder: { route: 'antigravity', modelId: 'a', company: 'Google', service: 'Antigravity' },
    reviewer: { route: 'commandcode', modelId: 'b', company: 'Anthropic', service: 'CommandCode' },
    crashFixer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
    fixReviewer: { route: 'antigravity', modelId: 'd', company: 'Google', service: 'Antigravity' },
  })
  const records = ['antigravity', 'claude', 'commandcode'].map(route => ({ route, enabled: true, lastTest: { ok: true } }))
  const offers = Object.values(roles).map(selection => ModelOfferSchema.parse({
    ...selection, name: selection.modelId, codingCapable: true, supportedEfforts: ['low'],
  }))
  assert.throws(() => validateStartPreconditions({ authorized: false, roles, records, offers }), /authorization/)
  assert.throws(() => validateStartPreconditions({ authorized: true, roles, records: records.map(record => record.route === 'claude' ? { ...record, enabled: false } : record), offers }), /disabled/)
  assert.throws(() => validateStartPreconditions({ authorized: true, roles, records: records.map(record => record.route === 'claude' ? { ...record, lastTest: { ok: false } } : record), offers }), /failed/)
  assert.throws(() => validateStartPreconditions({ authorized: true, roles, records, offers: offers.slice(1) }), /unavailable/)
  assert.throws(() => validateStartPreconditions({ authorized: true, roles: { ...roles, reviewer: { ...roles.reviewer, company: 'Google' } }, records, offers }), /different companies/)
  assert.throws(() => InitCommandSchema.parse({ issueId: 'JUL-225', decision: 'Go' }))
})

test('every CLI and workflow handoff contract accepts its exact shape and rejects drift', () => {
  const roles = RoleDefaultsSchema.parse({
    builder: { route: 'antigravity', modelId: 'a', company: 'Google', service: 'Antigravity' },
    reviewer: { route: 'commandcode', modelId: 'b', company: 'Anthropic', service: 'CommandCode' },
    crashFixer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
    fixReviewer: { route: 'antigravity', modelId: 'd', company: 'Google', service: 'Antigravity' },
  })
  const snapshot = { issueId: 'JUL-225', roles, allowSameService: false, savedAt: new Date().toISOString() }
  const input = { decision: 'Start' as const, authorized: true as const, snapshot }
  const trace = { route: 'antigravity' as const, modelId: 'a', startedAt: new Date().toISOString(), durationMs: 1, ok: true }
  const output = { status: 'completed' as const, runId: 'run-1', results: { builder: 'ok' }, traces: { builder: trace } }
  assert.deepEqual(DeliveryStartSchema.parse(input), WorkflowInputSchema.parse(input))
  assert.equal(WorkflowOutputSchema.parse(output).status, 'completed')
  assert.equal(WorkflowSnapshotSchema.parse({ runId: 'run-1', input, output }).runId, 'run-1')
  assert.equal(ConnectionsCommandSchema.parse({ action: 'list' }).action, 'list')
  assert.equal(ConnectionsResultSchema.parse({ ok: true, records: [] }).ok, true)
  assert.equal(ModelsCommandSchema.parse({ action: 'save', defaults: roles }).action, 'save')
  assert.equal(ModelsResultSchema.parse({ offers: [], defaults: roles }).offers.length, 0)
  assert.equal(InitCommandSchema.parse({ issueId: 'JUL-225' }).issueId, 'JUL-225')
  assert.equal(InitResultSchema.parse({ status: 'cancelled', issueId: 'JUL-225' }).status, 'cancelled')
  for (const schema of [DeliveryStartSchema, WorkflowInputSchema]) assert.throws(() => schema.parse({ ...input, authorized: false }))
  assert.throws(() => WorkflowOutputSchema.parse({ ...output, traces: {} , extra: true }))
  assert.throws(() => WorkflowSnapshotSchema.parse({ runId: '', input, output }))
  assert.throws(() => ConnectionsCommandSchema.parse({ action: 'delete-all' }))
  assert.throws(() => ConnectionsResultSchema.parse({ ok: true, records: [{ secret: 'value' }] }))
  assert.throws(() => ModelsCommandSchema.parse({ action: 'save', defaults: {} }))
  assert.throws(() => ModelsResultSchema.parse({ offers: [{ route: 'commandcode', modelId: 'x' }] }))
  assert.throws(() => InitCommandSchema.parse({ issueId: 'not-an-issue', decision: 'Start' }))
  assert.throws(() => InitResultSchema.parse({ status: 'started' }))
})

test('a route failure emits correlated role, route, model, timing, and error evidence', async () => {
  const lines: string[] = []
  const savedError = console.error
  console.error = value => { lines.push(String(value)) }
  try {
    const failing = { setModel: async () => {}, generate: async () => { throw new Error('controlled route failure') } }
    const workflow = createRoleExecutionWorkflow({ routes: { antigravity: failing, claude: failing } as never, commandCodeKey: () => 'reference-only' })
    const run = await workflow.createRun()
    const result = await run.start({ inputData: {
      decision: 'Start', authorized: true,
      snapshot: { issueId: 'JUL-225', allowSameService: false, savedAt: new Date().toISOString(), roles: {
        builder: { route: 'antigravity', modelId: 'a', company: 'Google', service: 'Antigravity' },
        reviewer: { route: 'commandcode', modelId: 'b', company: 'Anthropic', service: 'CommandCode' },
        crashFixer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
        fixReviewer: { route: 'antigravity', modelId: 'd', company: 'Google', service: 'Antigravity' },
      } },
    } })
    assert.equal(result.status, 'failed')
  } finally {
    console.error = savedError
  }
  const trace = lines.map(line => { try { return JSON.parse(line) } catch { return null } }).find(item => item?.event === 'delivery-route-failed')
  assert.deepEqual({ role: trace.role, route: trace.route, modelId: trace.modelId, error: trace.error }, { role: 'builder', route: 'antigravity', modelId: 'a', error: 'controlled route failure' })
  assert.equal(typeof trace.durationMs, 'number')
  assert.match(trace.startedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('later workflow roles receive the exact earlier role outputs', async () => {
  const prompts: Record<string, string> = {}
  const route = {
    setModel: async () => {},
    generate: async (prompt: string) => ({ text: prompt === 'build JUL-208' ? 'PROPOSED CHANGE' : `reviewed: ${prompt}` }),
  }
  const claudeOptions = [
    { value: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
    { value: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
  ]
  const claudeRoute = {
    ...route,
    getAvailableModels: async () => [],
    connection: {
      session: { sessionId: 'workflow-session', configOptions: [{ id: 'model', currentValue: 'claude-sonnet-4-6', options: claudeOptions }] },
      connection: { setSessionConfigOption: async ({ value }: { value: string }) => ({
        configOptions: [{ id: 'model', currentValue: value, options: claudeOptions }],
      }) },
    },
  }
  const workflow = createRoleExecutionWorkflow({
    routes: { antigravity: route, claude: claudeRoute } as never,
    promptForRole: (role, issueId, priorResults) => {
      const prompt = role === 'builder' ? `build ${issueId}` : `${role} sees ${priorResults.builder}`
      prompts[role] = prompt
      return prompt
    },
  })
  const run = await workflow.createRun()
  const result = await run.start({ inputData: {
    decision: 'Start', authorized: true,
    snapshot: { issueId: 'JUL-208', allowSameService: false, savedAt: new Date().toISOString(), roles: {
      builder: { route: 'antigravity', modelId: 'a', company: 'Google', service: 'Antigravity' },
      reviewer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
      crashFixer: { route: 'claude', modelId: 'claude-haiku-4-5-20251001', company: 'Anthropic', service: 'Claude' },
      fixReviewer: { route: 'antigravity', modelId: 'd', company: 'Google', service: 'Antigravity' },
    } },
  } })
  assert.equal(result.status, 'success')
  assert.equal(prompts.reviewer, 'reviewer sees PROPOSED CHANGE')
  assert.equal(result.result?.results.reviewer, 'reviewed: reviewer sees PROPOSED CHANGE')
})

test('workflow rejects a route response truncated by its model limit', async () => {
  const complete = { setModel: async () => {}, generate: async () => ({ text: 'complete', finishReason: 'stop' }) }
  const options = [
    { value: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
    { value: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
  ]
  const truncated = {
    generate: async () => ({ text: 'High: cut off mid-sentence', finishReason: 'length' }),
    getAvailableModels: async () => [],
    connection: {
      session: { sessionId: 'truncated-session', configOptions: [{ id: 'model', currentValue: 'claude-sonnet-4-6', options }] },
      connection: { setSessionConfigOption: async ({ value }: { value: string }) => ({
        configOptions: [{ id: 'model', currentValue: value, options }],
      }) },
    },
  }
  const workflow = createRoleExecutionWorkflow({ routes: { antigravity: complete, claude: truncated } as never })
  const run = await workflow.createRun()
  const result = await run.start({ inputData: {
    decision: 'Start', authorized: true,
    snapshot: { issueId: 'JUL-208', allowSameService: false, savedAt: new Date().toISOString(), roles: {
      builder: { route: 'antigravity', modelId: 'a', company: 'Google', service: 'Antigravity' },
      reviewer: { route: 'claude', modelId: 'claude-sonnet-4-6', company: 'Anthropic', service: 'Claude' },
      crashFixer: { route: 'claude', modelId: 'claude-haiku-4-5-20251001', company: 'Anthropic', service: 'Claude' },
      fixReviewer: { route: 'antigravity', modelId: 'd', company: 'Google', service: 'Antigravity' },
    } },
  } })
  assert.equal(result.status, 'failed')
})
