// The normal runner's isolated, interruptible laptop Provider API request.
// Auth is inherited from op run, never stdin/argv or durable evidence.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function commandCodeRequest(payload, { environment = process.env, fetchImpl = fetch } = {}) {
  const secret = environment.COMMANDCODE_API_KEY;
  if (!secret || secret.startsWith('op://')) return { error: 'Julia vault CommandCode credential is not resolved', uncertain: false };
  if (['max_tokens', 'max_completion_tokens', 'max_output_tokens'].some(field => Object.hasOwn(payload.body ?? {}, field))) return { error: 'CommandCode review requests must not set an output-token cap', uncertain: false };
  try {
    if (payload.endpoint !== 'https://api.commandcode.ai/provider/v1/chat/completions') return { error: 'CommandCode endpoint is not authorized', uncertain: false };
    const response = await fetchImpl(payload.endpoint, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.body), signal: AbortSignal.timeout(1200000),
    });
    return { httpStatus: response.status, body: (await response.text()).replaceAll(secret, '[REDACTED]') };
  } catch (cause) {
    // Provider exceptions can contain headers/URLs. Persist only a safe class;
    // the caller already records the authorized endpoint and request identity.
    const category = cause?.name === 'TimeoutError' ? 'timeout'
      : cause?.name === 'AbortError' ? 'aborted'
        : ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(cause?.cause?.code ?? cause?.code) ? 'network'
          : 'local';
    return { error: `CommandCode laptop request ${category} failure; outcome is uncertain`, uncertain: true };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try { result = await commandCodeRequest(JSON.parse(readFileSync(0, 'utf8'))); }
  catch { result = { error: 'Invalid CommandCode request input', uncertain: false }; }
  console.log(JSON.stringify(result));
  if (result.error) process.exitCode = 2;
}
