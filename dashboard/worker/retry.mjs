import { setTimeout } from 'node:timers/promises';

export function isConnectionReset(error) {
  if (!error) return false;
  return /ECONNRESET|connection reset|socket hang up|read reset/i.test(`${error.code ?? ''} ${error.message ?? ''}`) || isConnectionReset(error.cause);
}

export async function retryTurn(turn, { signal, sleep = setTimeout, note = () => {} } = {}) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    signal?.throwIfAborted();
    try {
      const result = await turn(attempt);
      if (result.exitCode !== 0 || result.finishReason === 'suspended' || result.status === 'suspended') throw Object.assign(new Error(result.error?.message ?? result.reason ?? result.status), { cause: result.error, result });
      return result;
    } catch (error) {
      if (signal?.aborted || !isConnectionReset(error) || attempt === 5) throw error;
      const waitMs = Math.min(2000 * 2 ** (attempt - 1), 30000);
      note({ type: 'reset_retry', attempt, waitMs, message: error.message });
      await sleep(waitMs, undefined, { signal });
    }
  }
}
