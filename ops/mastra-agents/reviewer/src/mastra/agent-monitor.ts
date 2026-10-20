import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'
import { AgentLaunchSchema } from './agent-events.ts'
import { createAgentActivityStore } from './agent-activity.ts'
import { createCodexMonitor } from './agent-codex-monitor.ts'
import { runMonitoredCommandCode } from './agent-commandcode.ts'
import { agentError } from './agent-errors.ts'

const ConfigurationSchema = z.object({
  storagePath: z.string().min(1), cwd: z.string().min(1),
  launch: AgentLaunchSchema.omit({ providerRunId: true }),
  commandCodeExecutable: z.string().min(1).optional(), maxTurns: z.number().int().positive().default(100),
  allowTools: z.boolean().default(false), codexSocketPath: z.string().optional(),
}).strict()

/** Operator entrypoint for Julia-monitored runs; this does not start the delivery runner. */
export async function runAgentMonitor(args: string[]) {
  const [provider, configurationPath, promptPath] = args
  if (!['commandcode', 'codex'].includes(provider) || !configurationPath || !promptPath || args.length !== 3) throw new Error('Usage: agent-monitor.ts <commandcode|codex> <configuration.json> <prompt.txt>')
  const configuration = ConfigurationSchema.parse(JSON.parse(await readFile(configurationPath, 'utf8')))
  if (configuration.launch.provider !== provider) throw new Error('Provider differs from explicit launch registration')
  const prompt = await readFile(promptPath, 'utf8')
  await mkdir(dirname(configuration.storagePath), { recursive: true })
  const store = await createAgentActivityStore(configuration.storagePath)
  try {
    if (provider === 'commandcode') {
      const result = await runMonitoredCommandCode({ store, launch: { ...configuration.launch, providerRunId: `unresolved:${configuration.launch.launchId}` }, prompt, cwd: configuration.cwd, executable: configuration.commandCodeExecutable, maxTurns: configuration.maxTurns, allowTools: configuration.allowTools })
      console.log(JSON.stringify({ event: 'monitored-commandcode-result', launchId: configuration.launch.launchId, ...result }))
      return result.exitCode ?? 1
    }
    const monitor = await createCodexMonitor(store, { socketPath: configuration.codexSocketPath })
    try {
      const launch = await monitor.launch(configuration.launch, { cwd: configuration.cwd, model: configuration.launch.model })
      const done = monitor.completed(launch.launchId)
      await monitor.request('turn/start', { threadId: launch.providerRunId, input: [{ type: 'text', text: prompt }] })
      const [result] = await done
      console.log(JSON.stringify({ event: 'monitored-codex-result', launchId: launch.launchId, providerRunId: launch.providerRunId, kind: result.kind }))
      return result.kind === 'run-completed' ? 0 : 1
    } finally { await monitor.close() }
  } finally { store.close() }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runAgentMonitor(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error(JSON.stringify(agentError(error, { provider: 'launcher', runId: 'unresolved', eventKind: 'launch-failed' })))
    process.exitCode = 1
  })
}
