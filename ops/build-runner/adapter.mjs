import { readFile, mkdir, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CardLedger } from './ledger.mjs'
import { createTransport } from './transport.mjs'

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'"
let opened = false

export async function openRunner({ card, settingsPath, cwd, stateDir, role = 'builder', hostInstructions, subagents, helpers, helperDefinitions, subagentDefinitions }) {
  if (opened) throw Error('one runner per process required')
  if (!/^[A-Z]+-\d+$/.test(card)) throw Error('valid card ID required')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  if (!settings.roles?.[role] || !settings.models?.[settings.roles[role]]) throw Error('configured role required')
  cwd = await realpath(cwd)
  stateDir = resolve(stateDir)
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  stateDir = await realpath(stateDir)
  const inside = relative(cwd, stateDir)
  if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('adapter state must be outside builder workspace')
  const appDir = join(stateDir, 'sdk')
  const sdkHome = join(stateDir, 'home')
  const commandHome = join(cwd, '.builder-home')
  await mkdir(commandHome, { recursive: true })
  await mkdir(sdkHome, { recursive: true, mode: 0o700 })
  await mkdir(appDir, { recursive: true, mode: 0o700 })
  const runtimeProviders = (settings.providers ?? []).map(provider => {
    const { credentialEnv, ...publicProvider } = provider
    const apiKey = credentialEnv ? process.env[credentialEnv] : undefined
    if (credentialEnv && !apiKey) throw Error('provider unavailable: runtime credential missing')
    if ('apiKey' in publicProvider || 'headers' in publicProvider) throw Error('provider settings must not contain credentials')
    return { ...publicProvider, ...(apiKey ? { apiKey } : {}) }
  })
  let authPath = settings.authPath ? resolve(settings.authPath) : join(stateDir, 'auth.json')
  await mkdir(dirname(authPath), { recursive: true, mode: 0o700 })
  try { authPath = await realpath(authPath) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    authPath = join(await realpath(dirname(authPath)), basename(authPath))
  }
  const authInside = relative(cwd, authPath)
  if (!authInside.startsWith('..') && !isAbsolute(authInside)) throw Error('credentials must be outside builder workspace')
  const path = process.env.PATH
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, { PATH: path ?? '/usr/local/bin:/usr/bin:/bin', HOME: stateDir, LANG: 'C.UTF-8', MASTRA_APP_DATA_DIR: appDir })
  if (settings.memory === false) process.env.MASTRACODE_DISABLE_OBSERVATIONAL_MEMORY = '1'
  const ledger = new CardLedger({ path: join(stateDir, 'cards.sqlite'), card })
  const originalFetch = globalThis.fetch
  globalThis.fetch = createTransport({ settings, ledger, role, fetch: originalFetch, trial: true })
  opened = true
  let runtime
  let workspace
  const providedSubagents = (subagents ?? helpers ?? helperDefinitions ?? subagentDefinitions) ?? []
  try {
    const [{ bootLocalAgentController, runMC }, { setCredentialStoreProvider }, { setCustomProvidersSource }, { AuthStorage }, { loadSettings, saveSettings }, { Workspace, LocalFilesystem, LocalSandbox, createWorkspaceTools }, { RequestContext }] = await Promise.all([
      import('@mastra/code-sdk'),
      import('@mastra/code-sdk/agents/credential-resolver'),
      import('@mastra/code-sdk/agents/custom-provider-source'),
      import('@mastra/code-sdk/auth/storage'),
      import('@mastra/code-sdk/onboarding/settings'),
      import('@mastra/core/workspace'),
      import('@mastra/core/request-context'),
    ])
    const auth = new AuthStorage(authPath)
    auth.allowEnvironmentFallback = false
    setCredentialStoreProvider(() => auth, async () => ({ userId: card, credentialScope: 'user' }))
    setCustomProvidersSource(() => runtimeProviders)
    const sdkSettings = loadSettings()
    sdkSettings.models.activeOmPackId = null
    sdkSettings.models.omModelOverride = 'auto'
    sdkSettings.models.observerModelSelection = 'auto'
    sdkSettings.models.reflectorModelSelection = 'auto'
    sdkSettings.models.observerModelOverride = null
    sdkSettings.models.reflectorModelOverride = null
    sdkSettings.models.omObservationThreshold = null
    sdkSettings.models.omReflectionThreshold = null
    sdkSettings.customProviders = runtimeProviders.map(({ apiKey, ...provider }) => provider)
    saveSettings(sdkSettings)
    const sandbox = new LocalSandbox({ workingDirectory: cwd, env: { HOME: commandHome, TMPDIR: commandHome }, timeout: 30_000 })
    const spawn = sandbox.processes.spawn.bind(sandbox.processes)
    const launcher = fileURLToPath(new URL('./command-boundary.py', import.meta.url))
    sandbox.processes.spawn = (command, options = {}) => {
      const config = JSON.stringify({ workspace: cwd, home: commandHome, cwd: resolve(cwd, options.cwd ?? '.'), executable: process.execPath })
      return spawn(`/usr/bin/python3 ${quote(launcher)} ${quote(config)} ${quote(command)}`, { ...options, env: {} })
    }
    workspace = new Workspace({ filesystem: new LocalFilesystem({ basePath: cwd, contained: true }), sandbox, tools: { mastra_workspace_execute_command: { name: 'execute_command' } }, skills: ['.agents/skills'] })
    await workspace.init()
    runtime = await bootLocalAgentController({
      cwd, homeDir: sdkHome, workspace, modes: false, subagents: providedSubagents, intervalHandlers: [],
      hostInstructions, disableMcp: true, disablePlugins: true, disableEnvFile: true, disableHooks: true, disableGithubSignals: true,
    })
    const tools = await createWorkspaceTools(workspace)
    const availableSkills = await workspace.skills?.list?.() ?? []
    return {
      snapshot: () => ledger.snapshot(),
      execute: async command => tools.execute_command.execute({ command }, {}),
      memory: async () => {
        const requestContext = new RequestContext()
        requestContext.set('controller', { session: { modelId: runtime.session.model.get() }, state: runtime.session.state.get(), getState: () => runtime.session.state.get(), threadId: runtime.session.thread.requireId() })
        return typeof runtime.memory === 'function' ? runtime.memory({ requestContext }) : runtime.memory
      },
      skills: workspace.skills,
      availableSkills,
      runtime,
      async run({ prompt, threadId, maxTurns = 6, timeoutMs = 180_000 }) {
        if (typeof prompt !== 'string' || !prompt.trim()) throw Error('prompt required')
        const thread = threadId ? { id: threadId } : await runtime.session.thread.create({ title: card })
        await runtime.session.model.switch(settings.roles[role])
        const result = await runMC({ controller: runtime.controller, session: runtime.session, thread: { id: thread.id }, prompt, maxTurns, timeoutMs }).result
        return { result, threadId: thread.id, account: ledger.snapshot() }
      },
      async close() {
        await runtime.memory?.settled?.()
        await runtime.controller.destroy()
        await runtime.observability.shutdown()
        await workspace.destroy()
        setCredentialStoreProvider(undefined)
        setCustomProvidersSource(undefined)
        globalThis.fetch = originalFetch
        ledger.close()
      },
    }
  } catch (error) {
    await runtime?.controller.destroy()
    await workspace?.destroy()
    globalThis.fetch = originalFetch
    ledger.close()
    throw error
  }
}

if (fileURLToPath(import.meta.url)===process.argv[1]) {
  const [card, cwd, stateDir, settingsPath, prompt] = process.argv.slice(2)
  ;(async () => {
    try {
      const runner = await openRunner({ card, cwd, stateDir, settingsPath })
      try {
        const receipt = await runner.run({ prompt })
        console.log(JSON.stringify(receipt))
      } finally {
        await runner.close()
      }
    } catch (error) {
      console.error(error?.message ?? String(error))
      process.exitCode = 1
    }
  })()
}
