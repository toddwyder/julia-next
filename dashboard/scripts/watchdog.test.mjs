import test from 'node:test';
import assert from 'node:assert/strict';
import { FAILURES_BEFORE_NOTICE, NOTICE_RETRY_MS, VAULT_WRAPPER, healthAddress, nextWatchdogState, probeHealth, runWatchdog, sendThroughVault } from './watchdog.mjs';

const ok = { ok: true, detail: 'answered ok' };
const bad = { ok: false, detail: 'HTTP 503 from /api/health (failing: runs)' };
const clock = () => {
  let minute = 0;
  return () => new Date(Date.UTC(2026, 9, 29, 10, minute++, 0)).toISOString();
};

const failingFetch = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));

test('the address probed comes from the env file, with the documented defaults', () => {
  assert.deepEqual(healthAddress({ DASHBOARD_HOST: '100.119.112.9', DASHBOARD_PORT: '4313' }), { host: '100.119.112.9', port: '4313', url: 'http://100.119.112.9:4313/api/health' });
  assert.equal(healthAddress({}).url, 'http://127.0.0.1:4313/api/health');
});

test('a single blip sends nothing and resets the count', () => {
  const first = nextWatchdogState(null, bad, '2026-10-29T10:00:00.000Z');
  assert.equal(first.notice, null);
  assert.equal(first.state.consecutiveFailures, 1);
  const second = nextWatchdogState(first.state, ok, '2026-10-29T10:01:00.000Z');
  assert.equal(second.notice, null);
  assert.equal(second.state.consecutiveFailures, 0);
  assert.equal(second.state.down, false);
});

test('the third consecutive failure notifies once, and nothing repeats while it stays down', () => {
  const now = clock();
  let state = null;
  const notices = [];
  for (let index = 1; index <= 6; index += 1) {
    const next = nextWatchdogState(state, bad, now());
    state = next.state;
    notices.push(next.notice);
    assert.equal(state.consecutiveFailures, index);
    assert.equal(state.down, index >= FAILURES_BEFORE_NOTICE);
  }
  assert.deepEqual(notices, [null, null, 'down', null, null, null]);
  assert.equal(state.downSince, '2026-10-29T10:02:00.000Z');
});

test('health returning after a notified outage is one recovery notice, then quiet', () => {
  let state = null;
  for (let index = 0; index < FAILURES_BEFORE_NOTICE; index += 1) state = nextWatchdogState(state, bad, '2026-10-29T10:00:00.000Z').state;
  const recovery = nextWatchdogState(state, ok, '2026-10-29T10:03:00.000Z');
  assert.equal(recovery.notice, 'recovery');
  assert.equal(recovery.downSince, '2026-10-29T10:00:00.000Z');
  assert.equal(recovery.state.down, false);
  assert.equal(recovery.state.consecutiveFailures, 0);
  assert.equal(nextWatchdogState(recovery.state, ok, '2026-10-29T10:04:00.000Z').notice, null);
  assert.equal(nextWatchdogState(recovery.state, bad, '2026-10-29T10:04:00.000Z').notice, null);
});

test('a probe needs a 200 that says ok, and names why anything else is not', async () => {
  const json = body => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  assert.equal((await probeHealth({ url: 'http://x/api/health', fetchImpl: json({ status: 'ok' }) })).ok, true);
  const failed = await probeHealth({ url: 'http://x/api/health', fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ status: 'failed', failing: ['runs'] }), { status: 503 })) });
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /HTTP 503.*failing: runs/);
  const mislabelled = await probeHealth({ url: 'http://x/api/health', fetchImpl: json({ status: 'failed', failing: ['linear'] }) });
  assert.equal(mislabelled.ok, false);
  assert.match(mislabelled.detail, /body said "failed"/);
  const refused = await probeHealth({ url: 'http://x/api/health', fetchImpl: failingFetch });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /did not answer \(ECONNREFUSED\)/);
});

test('three failing probes send exactly one notice and a return sends one recovery', async () => {
  const now = clock();
  const sent = [];
  let stored = null;
  const store = { read: () => stored, write: state => { stored = state; } };
  const log = [];
  const notices = [];
  for (const result of [bad, bad, bad, bad, ok, ok]) {
    const finished = await runWatchdog({ env: {}, probe: () => Promise.resolve(result), send: notice => { sent.push(notice.kind); return Promise.resolve({ delivered: 'ok' }); }, store, now, log: line => log.push(line) });
    notices.push(finished.notice);
  }
  assert.deepEqual(notices, [null, null, 'down', null, 'recovery', null]);
  assert.deepEqual(sent, ['down', 'recovery']);
  assert.equal(stored.down, false);
  assert.equal(stored.consecutiveFailures, 0);
  assert.equal(log.length, 6);
});

test('a notice that could not be sent stays pending until the retry cooldown expires', async () => {
  let stored = null;
  const store = { read: () => stored, write: state => { stored = state; } };
  const attempts = [];
  const send = () => {
    attempts.push('attempt');
    return Promise.reject(new Error('the notice sender exited 1'));
  };
  for (let index = 0; index < 3; index += 1) {
    await runWatchdog({ env: {}, probe: () => Promise.resolve(bad), send, store, now: () => '2026-10-29T10:00:00.000Z', log: () => {} });
  }
  assert.equal(attempts.length, 1);
  assert.equal(stored.down, false);
  assert.equal(stored.consecutiveFailures, 3);
  assert.equal(stored.lastNoticeFailureAt, '2026-10-29T10:00:00.000Z');
  const waiting = await runWatchdog({ env: {}, probe: () => Promise.resolve(bad), send, store, now: () => '2026-10-29T10:01:00.000Z', log: () => {} });
  assert.equal(waiting.notice, 'down');
  assert.equal(waiting.sent, null);
  assert.equal(attempts.length, 1);
  const retried = await runWatchdog({ env: {}, probe: () => Promise.resolve(bad), send: () => Promise.resolve({ delivered: 'ok' }), store, now: () => '2026-10-29T11:00:00.000Z', log: () => {} });
  assert.equal(retried.notice, 'down');
  assert.equal(retried.sent.delivered, 'ok');
  assert.equal(stored.down, true);
  assert.equal(stored.lastNoticeKind, 'down');
  assert.equal(stored.lastNoticeFailureAt, null);
});

test('failed recovery delivery survives repeated healthy probes and retries at the persisted deadline', async () => {
  let stored = JSON.stringify({ down: true, downSince: '2026-10-29T09:00:00.000Z' });
  const store = { read: () => JSON.parse(stored), write: state => { stored = JSON.stringify(state); } };
  let attempts = 0;
  let current = Date.parse('2026-10-29T10:00:00.000Z');
  const send = () => { attempts += 1; throw new Error('the notice sender exited 1'); };
  const options = { env: {}, probe: async () => ok, send, store, now: () => new Date(current).toISOString(), log: () => {} };
  for (let minute = 0; minute < 60; minute += 1) {
    current = Date.parse('2026-10-29T10:00:00.000Z') + minute * 60000;
    const result = await runWatchdog(options);
    assert.equal(result.notice, 'recovery');
    assert.equal(result.state.down, true);
    assert.equal(result.state.downSince, '2026-10-29T09:00:00.000Z');
    assert.equal(result.state.lastNoticeFailureAt, '2026-10-29T10:00:00.000Z');
    assert.equal(result.state.lastNoticeAt, null);
  }
  assert.equal(attempts, 1);
  current = Date.parse('2026-10-29T10:00:00.000Z') + NOTICE_RETRY_MS;
  await runWatchdog(options);
  assert.equal(attempts, 2);
  current += NOTICE_RETRY_MS;
  const recovered = await runWatchdog({ ...options, send: () => { attempts += 1; return { delivered: 'ok' }; } });
  assert.equal(recovered.sent.delivered, 'ok');
  assert.equal(recovered.state.down, false);
  assert.equal(recovered.state.lastNoticeFailureAt, null);
  current += 60000;
  assert.equal((await runWatchdog(options)).notice, null);
  assert.equal(attempts, 3);
});

test('notification delivery uses the deployed wrapper with Linear-only scope', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  assert.equal(VAULT_WRAPPER, '/home/ubuntu/julia-dashboard/scripts/julia-agents.mjs');
  const root = mkdtempSync(join(tmpdir(), 'watchdog-vault-'));
  try {
    const wrapper = join(root, 'wrapper.mjs');
    writeFileSync(wrapper, 'console.log(JSON.stringify(process.argv.slice(2)))');
    const result = sendThroughVault({ kind: 'recovery' }, { env: { ...process.env, DASHBOARD_VAULT_WRAPPER: wrapper } });
    const args = JSON.parse(result.delivered);
    assert.deepEqual(args.slice(0, 3), ['--linear', '--', process.execPath]);
    assert.equal(args[4], '--notify');
    assert.equal(args[5], 'recovery');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the state file lives under the state folder from the env file', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'jul-276-watchdog-'));
  try {
    await runWatchdog({ env: { DASHBOARD_STATE_DIR: root }, probe: () => Promise.resolve(bad), send: () => Promise.resolve({}), log: () => {}, now: () => '2026-10-29T10:00:00.000Z' });
    const written = JSON.parse(readFileSync(join(root, 'state', 'watchdog.json'), 'utf8'));
    assert.equal(written.consecutiveFailures, 1);
    assert.equal(written.lastProbeAt, '2026-10-29T10:00:00.000Z');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
