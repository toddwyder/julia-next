export function isObserverError(event) {
  const text = `${event.source ?? ''} ${event.name ?? ''} ${event.error?.message ?? ''} ${event.message ?? ''}`;
  return /memory:\s*(?:observe|reflect)|(?:background )?(?:observer|reflector)(?:\b|_)/i.test(text) && (event.type === 'error' || event.error != null);
}

export function mapStatus({ phase, result, stopped = false, error }) {
  if (stopped) return 'stopped';
  if (error) return 'failed';
  if (result) return result.exitCode === 0 && result.finishReason !== 'suspended' && result.status !== 'suspended' ? 'exited' : 'failed';
  return phase === 'running' ? 'running' : 'starting';
}

export function classifyEvent(event) {
  if (isObserverError(event)) return { type: 'observer_note', message: event.error?.message ?? event.message, statusChanged: false };
  if (event.type === 'error') return { type: 'turn_error', message: event.error?.message, code: event.error?.code, cause: event.error?.cause?.message };
  if (/subagent|tool_|agent_end|usage_update|model|mode/.test(event.type)) return event;
  return { type: event.type };
}
