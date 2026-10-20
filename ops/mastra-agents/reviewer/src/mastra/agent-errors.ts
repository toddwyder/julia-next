type ErrorRecord = { name: string; message: string; cause?: ErrorRecord }

function safeMessage(value: string) {
  let message = value.replace(/(?:Bearer\s+\S+|sk-[\w-]+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+)/gi, '[REDACTED]')
  for (const [name, secret] of Object.entries(process.env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && secret && secret.length >= 6) message = message.replaceAll(secret, '[REDACTED]')
  }
  return message.slice(0, 300)
}

export function agentError(error: unknown, context: { provider: string; runId: string; eventKind: string }) {
  const seen = new Set<unknown>()
  const serialize = (value: unknown, depth = 0): ErrorRecord => {
    if (!(value instanceof Error)) return { name: 'UnknownError', message: 'Non-Error provider failure' }
    if (seen.has(value) || depth >= 4) return { name: 'Error', message: 'Cause chain truncated' }
    seen.add(value)
    return { name: safeMessage(value.name), message: safeMessage(value.message), ...(value.cause ? { cause: serialize(value.cause, depth + 1) } : {}) }
  }
  return { provider: context.provider.slice(0, 160), runId: context.runId.slice(0, 160), eventKind: context.eventKind.slice(0, 160), error: serialize(error) }
}
