import { execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
type ProcessBackedConnection = { agentProcess?: ChildProcess }
type AcpConnections = { antigravity: { connection: object }; claude: { connection: object } }
const retainedAcpProcesses = new WeakMap<object, Set<ChildProcess>>()

export type WindowsProcessIdentity = {
  processId: number
  parentProcessId: number
  name: string
  creationDate: string
  executablePath: string | null
}

export type OwnedAcpProcesses = { roots: ChildProcess[]; descendants: WindowsProcessIdentity[] }

export function retainAcpProcessHandles(connection: object) {
  const processConnection = connection as ProcessBackedConnection
  let current = processConnection.agentProcess
  const retained = new Set<ChildProcess>()
  if (current) retained.add(current)
  retainedAcpProcesses.set(connection, retained)
  Object.defineProperty(connection, 'agentProcess', {
    configurable: true,
    get: () => current,
    set: (child: ChildProcess | undefined) => {
      current = child
      if (child) retained.add(child)
    },
  })
}

async function windowsProcesses(): Promise<WindowsProcessIdentity[]> {
  if (process.platform !== 'win32') return []
  const command = "@(Get-CimInstance Win32_Process | Select-Object @{Name='processId';Expression={$_.ProcessId}},@{Name='parentProcessId';Expression={$_.ParentProcessId}},@{Name='name';Expression={$_.Name}},@{Name='creationDate';Expression={$_.CreationDate.ToString('o')}},@{Name='executablePath';Expression={$_.ExecutablePath}}) | ConvertTo-Json -Compress"
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
  const parsed = JSON.parse(stdout.trim() || '[]') as WindowsProcessIdentity | WindowsProcessIdentity[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

export function descendantAcpProcesses(rootProcessIds: number[], processes: WindowsProcessIdentity[]) {
  const descendants = new Set(rootProcessIds)
  let changed = true
  while (changed) {
    changed = false
    for (const item of processes) {
      if (!descendants.has(item.processId) && descendants.has(item.parentProcessId)) {
        descendants.add(item.processId)
        changed = true
      }
    }
  }
  return processes.filter(item => item.name.toLowerCase() === 'agy_acp_server.exe' && descendants.has(item.processId))
}

export async function ownedAcpProcesses(
  routes: AcpConnections,
  listProcesses: () => Promise<WindowsProcessIdentity[]> = windowsProcesses,
): Promise<OwnedAcpProcesses> {
  const roots = [...new Set([routes.antigravity.connection, routes.claude.connection]
    .flatMap(connection => [
      ...(retainedAcpProcesses.get(connection) ?? []),
      (connection as ProcessBackedConnection).agentProcess,
    ])
    .filter((child): child is ChildProcess => child !== undefined))]
  const rootProcessIds = roots.flatMap(child => child.pid === undefined ? [] : [child.pid])
  return { roots, descendants: descendantAcpProcesses(rootProcessIds, await listProcesses()) }
}

export async function waitForAcpProcessExit(child: ChildProcess, graceMilliseconds = 2_000, forceMilliseconds = 2_000) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout
    const cleanup = () => {
      child.off('exit', finish)
      clearTimeout(timer)
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (message: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }
    child.once('exit', finish)
    timer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return finish()
      try {
        if (!child.kill('SIGKILL')) return fail(`ACP process ${child.pid ?? '(unknown)'} could not be terminated`)
      } catch (error) {
        return fail(`ACP process ${child.pid ?? '(unknown)'} could not be terminated: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!settled) timer = setTimeout(() => fail(`ACP process ${child.pid ?? '(unknown)'} did not exit after forced termination`), forceMilliseconds)
    }, graceMilliseconds)
  })
}

async function terminateExactWindowsProcesses(processes: WindowsProcessIdentity[]) {
  if (!processes.length || process.platform !== 'win32') return
  const encodedIdentities = Buffer.from(JSON.stringify(processes), 'utf8').toString('base64')
  const command = `$owned = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedIdentities}')) | ConvertFrom-Json; Get-CimInstance Win32_Process | Where-Object { $candidate = $_; @($owned | Where-Object { $_.processId -eq $candidate.ProcessId -and $_.name -eq $candidate.Name -and $_.creationDate -eq $candidate.CreationDate.ToString('o') -and $_.executablePath -eq $candidate.ExecutablePath }).Count -gt 0 } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  await execute('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
}

export function sameWindowsProcessIdentity(left: WindowsProcessIdentity, right: WindowsProcessIdentity) {
  return left.processId === right.processId
    && left.name === right.name
    && left.creationDate === right.creationDate
    && left.executablePath === right.executablePath
}

export async function stopExactWindowsProcesses(
  owned: WindowsProcessIdentity[],
  listProcesses: () => Promise<WindowsProcessIdentity[]> = windowsProcesses,
  terminate: (processes: WindowsProcessIdentity[]) => Promise<void> = terminateExactWindowsProcesses,
) {
  const current = await listProcesses()
  const matching = current.filter(candidate => owned.some(identity => sameWindowsProcessIdentity(candidate, identity)))
  await terminate(matching)
  const after = await listProcesses()
  const remaining = owned.filter(identity => after.some(candidate => sameWindowsProcessIdentity(candidate, identity)))
  if (remaining.length) throw new Error(`ACP cleanup failed for process identities ${remaining.map(item => `${item.processId}@${item.creationDate}`).join(', ')}`)
}

export async function stopOwnedAcpProcesses(owned: OwnedAcpProcesses) {
  const results = await Promise.allSettled([
    ...owned.roots.map(child => waitForAcpProcessExit(child)),
    stopExactWindowsProcesses(owned.descendants),
  ])
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, `ACP process cleanup failed: ${errors.map(error => error instanceof Error ? error.message : String(error)).join('; ')}`)
}
