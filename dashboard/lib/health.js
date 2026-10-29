// health.js -- the three checks behind /api/health (JUL-276 PR-2, decision D7).
//
// The route, the watchdog and the tests all ask the same question here: is Linear
// answering, is the state folder writable, and does every run file parse? A check never
// throws: each one answers `{name, ok, detail}` so the failure is named rather than blank.
// The Linear key is never echoed: every message from the provider is redacted first.
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRuns, stateFolder } from './state.js';

const ENDPOINT = 'https://api.linear.app/graphql';
const QUERY = 'query DashboardHealth { viewer { id } }';

export function redact(text, secret) {
  const message = typeof text === 'string' ? text : String(text ?? '');
  return secret ? message.split(secret).join('[redacted]') : message;
}

export async function checkLinear({ apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) return { name: 'linear', ok: false, detail: 'LINEAR_API_KEY is missing' };
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY }),
    });
  } catch (error) {
    const slow = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { name: 'linear', ok: false, detail: slow ? 'Linear did not answer within 10 seconds.' : `Linear connection failure (${redact(error?.message, apiKey)}).` };
  }
  let text;
  try {
    text = await response.text();
  } catch {
    return { name: 'linear', ok: false, detail: 'Linear ended its reply before it was complete.' };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const reason = Array.isArray(body?.errors)
    ? redact(body.errors.map(error => (typeof error?.message === 'string' ? error.message : 'unknown provider error')).join('; '), apiKey).slice(0, 400)
    : '';
  if (!response.ok) return { name: 'linear', ok: false, detail: `Linear request failed. HTTP ${response.status}${reason ? ` ${reason}` : ''}` };
  if (body === undefined) return { name: 'linear', ok: false, detail: 'Linear returned a malformed response. Expected JSON.' };
  if (reason) return { name: 'linear', ok: false, detail: `Linear request failed. ${reason}` };
  if (typeof body?.data?.viewer?.id !== 'string') return { name: 'linear', ok: false, detail: 'Linear answered without a viewer.' };
  return { name: 'linear', ok: true, detail: 'Linear answered' };
}

// Writability is proven by writing, not by asking about permissions: the service user owns
// the folder and a mode bit is not the same thing as a successful write.
export function checkStateFolder(env = process.env) {
  const dir = stateFolder(env);
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.health-${process.pid}.probe`);
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
    return { name: 'state', ok: true, detail: `${dir} is writable` };
  } catch (error) {
    return { name: 'state', ok: false, detail: `${dir} is not writable (${error.code ?? error.message})` };
  }
}

export function checkRuns(env = process.env) {
  const { dir, entries, listError } = readRuns(env);
  if (listError) return { name: 'runs', ok: false, detail: `${dir} ${listError}`, files: [dir] };
  const broken = entries.filter(entry => entry.error);
  if (broken.length) {
    return { name: 'runs', ok: false, detail: `${broken.length} of ${entries.length} run files do not parse`, files: broken.map(entry => entry.file) };
  }
  return { name: 'runs', ok: true, detail: `${entries.length} run ${entries.length === 1 ? 'file' : 'files'} parse`, files: [] };
}

export async function checkHealth({ env = process.env, apiKey = env.LINEAR_API_KEY, fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  const checks = [await checkLinear({ apiKey, fetchImpl }), checkStateFolder(env), checkRuns(env)];
  const failing = checks.filter(check => !check.ok);
  return {
    status: failing.length ? 'failed' : 'ok',
    checkedAt: now(),
    checks,
    failing: failing.map(check => check.name),
    files: failing.flatMap(check => check.files ?? []),
  };
}
