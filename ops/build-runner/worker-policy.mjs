export function pauseReason(status, message) {
  if (status === 'max_turns') return 'runaway: reached the 100-turn limit'
  const text = String(message ?? '')
  if (/provider (?:down|request failed)/i.test(text)) return text.startsWith('provider down:') ? text : `provider down: ${text}`
  return null
}
