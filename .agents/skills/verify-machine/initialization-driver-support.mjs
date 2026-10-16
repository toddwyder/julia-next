import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import { InitializationBoundaryStateSchema } from '../../../ops/mastra-agents/reviewer/src/mastra/contracts.ts'

function getProcessTreePids(rootPid) {
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId | ConvertTo-Json -Compress',
  ], { encoding: 'utf8' })
  const parsed = JSON.parse(output)
  const list = Array.isArray(parsed) ? parsed : [parsed]
  const tree = new Set([rootPid])
  let added = true
  while (added) {
    added = false
    for (const processInfo of list) {
      if (tree.has(processInfo.ParentProcessId) && !tree.has(processInfo.ProcessId)) {
        tree.add(processInfo.ProcessId)
        added = true
      }
    }
  }
  return Array.from(tree)
}

async function stopCapturedPids(capturedPids, launcherProcess) {
  for (const pid of getProcessTreePids(launcherProcess.pid)) {
    if (!capturedPids.includes(pid)) capturedPids.push(pid)
  }
  try { launcherProcess.kill('SIGINT') } catch {}
  for (const pid of capturedPids.slice().reverse()) {
    try { process.kill(pid) } catch {}
  }
  const pidList = capturedPids.map(pid => Number(pid)).filter(Number.isSafeInteger)
  if (pidList.length !== capturedPids.length) throw new Error('captured PID list contained a non-integer')
  const survivorOutput = execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    `$ids=@(${pidList.join(',')}); Wait-Process -Id $ids -Timeout 5 -ErrorAction SilentlyContinue; @(Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) | ConvertTo-Json -Compress`,
  ], { encoding: 'utf8' }).trim()
  const parsedSurvivors = survivorOutput ? JSON.parse(survivorOutput) : []
  const survivors = Array.isArray(parsedSurvivors) ? parsedSurvivors : [parsedSurvivors]
  if (survivors.length > 0) throw new Error(`captured PIDs survived cleanup: ${survivors.join(', ')}`)
  return { capturedPids: [...capturedPids], survivors, allCapturedPidsStopped: survivors.length === 0 }
}

export async function readInitializationBoundary(serverUrl) {
  const response = await fetch(`${serverUrl}/api/runs`)
  const body = await response.json()
  assert.equal(response.status, 200, `initialization read boundary returned HTTP ${response.status}`)
  return InitializationBoundaryStateSchema.parse(body)
}

export function prohibitedActivity(activity) {
  return {
    roleDispatches: activity.roleDispatches,
    llmInferenceCalls: activity.llmInferenceCalls,
    linearMutations: activity.linearMutations,
  }
}

export function activityDelta(after, before) {
  return {
    roleDispatches: Object.fromEntries(Object.keys(after.roleDispatches).map(role => [role, after.roleDispatches[role] - before.roleDispatches[role]])),
    llmInferenceCalls: after.llmInferenceCalls - before.llmInferenceCalls,
    linearQueries: after.linearQueries - before.linearQueries,
    linearMutations: after.linearMutations - before.linearMutations,
  }
}

export async function launchControlServer({ boundaryLabel, launcherScript, repoRoot, storagePath }) {
  console.log(JSON.stringify({ event: 'launching-boundary', boundary: boundaryLabel }))
  const logs = []
  let serverReadyResolve
  let serverReadyReject
  const serverReadyPromise = new Promise((resolve, reject) => {
    serverReadyResolve = resolve
    serverReadyReject = reject
  })
  const launcherProcess = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherScript,
  ], {
    cwd: repoRoot,
    env: { ...process.env, JULIA_INITIALIZATION_DB: storagePath, JULIA_CONTROL_OPEN_BROWSER: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const onLine = (line, stream) => {
    logs.push({
      entry: `[${new Date().toISOString()}] [${boundaryLabel}] [${stream}] ${line}`,
      raw: line, timestamp: new Date().toISOString(), stream, boundary: boundaryLabel,
    })
    if (line.includes('"status":"ready"')) {
      try { serverReadyResolve(JSON.parse(line)) } catch (error) { serverReadyReject(error) }
    }
  }
  createInterface({ input: launcherProcess.stdout }).on('line', line => onLine(line, 'STDOUT'))
  createInterface({ input: launcherProcess.stderr }).on('line', line => onLine(line, 'STDERR'))
  launcherProcess.on('exit', code => serverReadyReject(new Error(`launcher exited prematurely with code ${code} (${boundaryLabel})`)))
  const timeoutTimer = setTimeout(() => serverReadyReject(new Error(`timeout waiting for control server to report ready (${boundaryLabel})`)), 90000)
  let serverInfo
  try { serverInfo = await serverReadyPromise } finally { clearTimeout(timeoutTimer) }
  const capturedPids = getProcessTreePids(launcherProcess.pid)
  console.log(JSON.stringify({ event: 'boundary-ready', boundary: boundaryLabel, url: serverInfo.url, launcherPid: launcherProcess.pid, capturedPids }))
  let stopPromise
  const stop = () => {
    stopPromise ??= stopCapturedPids(capturedPids, launcherProcess)
    return stopPromise
  }
  return { launcherProcess, launcherPid: launcherProcess.pid, capturedPids, serverInfo, logs, stop }
}

export function retainBoundaryMeasurements(allServerLogs, processMeasurements) {
  assert.ok(processMeasurements.length > 0, 'at least one process measurement is required')
  const boundaryEvents = allServerLogs.map(logItem => {
    const line = logItem.raw.trim()
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const parsed = JSON.parse(line)
        return { timestamp: logItem.timestamp, boundary: logItem.boundary, event: parsed.event || parsed.status || 'unknown', data: parsed }
      } catch {}
    }
    return { timestamp: logItem.timestamp, boundary: logItem.boundary, text: line }
  })
  const [first, ...remaining] = processMeasurements
  const measuredActivity = remaining.reduce((total, measurement) => ({
    roleDispatches: Object.fromEntries(Object.keys(measurement.roleDispatches).map(role => [role, total.roleDispatches[role] + measurement.roleDispatches[role]])),
    llmInferenceCalls: total.llmInferenceCalls + measurement.llmInferenceCalls,
    linearQueries: total.linearQueries + measurement.linearQueries,
    linearMutations: total.linearMutations + measurement.linearMutations,
  }), structuredClone(first))
  return { boundaryEvents, measuredActivity }
}
