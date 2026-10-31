import { spawnSync } from 'node:child_process'

const ANSI = /\u001b\[[0-9;]*m/g

export function sessionArgs({ model, thinkingLevel, title, timeoutMs, settingsPath }) {
  const seconds = Math.max(60, Math.floor(timeoutMs / 1000))
  return [
    '--prompt', '-',
    '--model', model,
    '--thinking-level', thinkingLevel,
    '--title', title,
    '--output', 'json',
    '--permission-mode', 'auto',
    '--settings', settingsPath,
    '--timeout', String(seconds),
  ]
}

// A session must never inherit a colour setting that makes its JSON output
// unparsable, and it must never see another run's storage.
export function sessionEnv(base, { appData, tracePath }) {
  const env = { ...base }
  delete env.CLICOLOR_FORCE
  delete env.GH_FORCE_TTY
  delete env.FORCE_COLOR
  return { ...env, NO_COLOR: '1', CLICOLOR: '0', MASTRA_APP_DATA_DIR: appData, MASTRA_OBSERVABILITY_DB_PATH: tracePath }
}

function lastJson(text) {
  const lines = String(text).replace(ANSI, '').split('\n').map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index])
      if (parsed && typeof parsed === 'object' && 'status' in parsed) return parsed
    } catch {
      // Not the result line; keep walking back.
    }
  }
  return undefined
}

export function runSession({ prompt, model, thinkingLevel = 'low', title, timeoutMs, settingsPath, cwd, appData, tracePath, env = process.env, spawn = spawnSync }) {
  const args = sessionArgs({ model, thinkingLevel, title, timeoutMs, settingsPath })
  const child = spawn('mastracode', args, {
    cwd,
    env: sessionEnv(env, { appData, tracePath }),
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs + 120_000,
  })
  if (child.error) throw child.error
  const stdout = child.stdout ?? ''
  const stderr = (child.stderr ?? '').replace(ANSI, '')
  const result = lastJson(stdout)
  if (!result) {
    return {
      ok: false,
      status: 'error',
      error: `session printed no result line (exit ${child.status}): ${stderr.trim().split('\n').slice(-5).join(' ')}`.trim(),
      exitCode: child.status,
    }
  }
  const suspended = result.finishReason === 'suspended'
  const ok = child.status === 0 && result.exitCode === 0 && !suspended && ['completed', 'done'].includes(result.status)
  return {
    ok,
    status: result.status,
    text: result.text ?? '',
    finishReason: result.finishReason,
    usage: result.usage,
    threadId: result.threadId,
    toolCalls: result.toolCalls ?? [],
    exitCode: child.status ?? result.exitCode,
    error: ok ? undefined : suspended
      ? 'session ended asking for something an unattended run cannot approve'
      : result.error?.message ?? `session ended ${result.status ?? 'without a status'}`,
  }
}
