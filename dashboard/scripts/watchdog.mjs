#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJsonRecord, watchdogRecordFile, writeJsonRecord } from '../lib/state.js';
import { sendDashboardNotice } from '../lib/ping.js';

export const FAILURES_BEFORE_NOTICE = 3;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = '4313';
export const VAULT_WRAPPER = '/home/ubuntu/julia-mastra/scripts/julia-agents.mjs';

const self = fileURLToPath(import.meta.url);

export function healthAddress(env = process.env) {
  const host = env.DASHBOARD_HOST || DEFAULT_HOST;
  const port = env.DASHBOARD_PORT || DEFAULT_PORT;
  return { host, port, url: `http://${host}:${port}/api/health` };
}

export const EMPTY_WATCHDOG_STATE = Object.freeze({
  consecutiveFailures: 0, down: false, downSince: null, lastProbeAt: null, lastOkAt: null,
  lastDetail: null, lastNoticeAt: null, lastNoticeKind: null, lastRecoveredAt: null,
});

export async function probeHealth({ url, fetchImpl = fetch, timeoutMs = 5000 }) {
  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  } catch (error) {
    const slow = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const reason = error?.cause?.code ?? error?.code ?? error?.message;
    return { ok: false, detail: slow ? `${url} did not answer within ${timeoutMs} ms` : `${url} did not answer (${reason})` };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (response.status !== 200) {
    const failing = Array.isArray(body?.failing) && body.failing.length ? ` (failing: ${body.failing.join(', ')})` : '';
    return { ok: false, detail: `HTTP ${response.status} from ${url}${failing}` };
  }
  if (body?.status !== 'ok') return { ok: false, detail: `HTTP 200 from ${url} but the body said ${JSON.stringify(body?.status ?? 'nothing')}` };
  return { ok: true, detail: `${url} answered ok` };
}

export function nextWatchdogState(previous, result, now = new Date().toISOString()) {
  const state = { ...EMPTY_WATCHDOG_STATE, ...(previous ?? {}) };
  if (result.ok) {
    const notice = state.down ? 'recovery' : null;
    return {
      state: {
        ...state, consecutiveFailures: 0, down: false, downSince: null, lastProbeAt: now,
        lastOkAt: now, lastDetail: result.detail, lastRecoveredAt: notice ? now : state.lastRecoveredAt,
      },
      notice,
      downSince: notice ? state.downSince : null,
    };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  const notice = !state.down && consecutiveFailures >= FAILURES_BEFORE_NOTICE ? 'down' : null;
  return {
    state: {
      ...state, consecutiveFailures, down: state.down || notice === 'down',
      downSince: state.downSince ?? (notice === 'down' ? now : null), lastProbeAt: now, lastDetail: result.detail,
    },
    notice,
    downSince: notice ? now : null,
  };
}

export function sendThroughVault(notice, { env = process.env } = {}) {
  const wrapper = env.DASHBOARD_VAULT_WRAPPER || VAULT_WRAPPER;
  const child = spawnSync(process.execPath, [wrapper, '--', process.execPath, self, '--notify', notice.kind, JSON.stringify({
    detail: notice.detail ?? '', address: notice.address ?? '', at: notice.at ?? '', downSince: notice.downSince ?? null,
  })], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 180000, env });
  if (child.error) throw new Error(`could not run the notice sender: ${child.error.message}`);
  if (child.status !== 0) throw new Error(`the notice sender exited ${child.status ?? child.signal}`);
  return { delivered: child.stdout.trim().split('\n').slice(-1)[0] ?? '' };
}

export async function runWatchdog({ env = process.env, probe, send, store, log = line => console.log(`julia-dashboard: ${line}`), now = () => new Date().toISOString() } = {}) {
  const address = healthAddress(env);
  const file = watchdogRecordFile(env);
  const read = store?.read ?? (() => readJsonRecord(file).value);
  const write = store?.write ?? (state => writeJsonRecord(file, state));
  const deliver = send ?? (notice => sendThroughVault(notice, { env }));

  const previous = read();
  const result = await (probe ?? (() => probeHealth({ url: address.url })))();
  const { state, notice, downSince } = nextWatchdogState(previous, result, now());

  let sent = null;
  let sendError = '';
  if (notice) {
    try {
      sent = await deliver({ kind: notice, detail: result.detail, address: address.url, at: state.lastProbeAt, downSince });
      state.lastNoticeAt = state.lastProbeAt;
      state.lastNoticeKind = notice;
    } catch (error) {
      sendError = String(error.message ?? error);
      state.down = previous?.down ?? false;
    }
  }
  write(state);
  log(JSON.stringify({ phase: 'watchdog', address: address.url, probe: result.ok ? 'ok' : 'failed', detail: result.detail, consecutiveFailures: state.consecutiveFailures, down: state.down, notice, sent, error: sendError || undefined, file }));
  return { state, notice, sent, error: sendError };
}

async function notify(argv) {
  const [kind, payload] = argv;
  const details = JSON.parse(payload ?? '{}');
  const result = await sendDashboardNotice({ kind, ...details }, { apiKey: process.env.LINEAR_API_KEY });
  console.log(`julia-dashboard: notice ${JSON.stringify(result)}`);
}

async function main(argv = process.argv.slice(2)) {
  if (argv[0] === '--notify') {
    await notify(argv.slice(1));
    return;
  }
  if (argv[0] === '--probe') {
    const result = await probeHealth({ url: healthAddress().url });
    console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  const result = await runWatchdog();
  process.exitCode = result.error ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`julia-dashboard: watchdog failed: ${error.message}`);
    process.exitCode = 1;
  });
}
