import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createServer, validateFieldShape, isArmed, saveState, loadState, rearm, FIELDS,
} from './dropbox.mjs';

function tmpState() {
  const dir = mkdtempSync(join(tmpdir(), 'dropbox-test-'));
  return join(dir, 'state.json');
}

test('validateFieldShape rejects an obviously wrong paste', () => {
  assert.equal(validateFieldShape('sentry', '').ok, false, 'empty is rejected');
  assert.equal(validateFieldShape('sentry', 'https://sentry.io/settings').ok, false, 'a pasted URL is rejected');
  assert.equal(validateFieldShape('sentry', 'not a token').ok, false, 'a pasted sentence is rejected (contains whitespace)');
  assert.equal(validateFieldShape('sentry', 'short').ok, false, 'too short is rejected');
  assert.equal(validateFieldShape('sentry', 'a'.repeat(40)).ok, true, 'a plausible unbroken token is accepted');
});

test('isArmed: true when freshly armed, false once used, false after 24h', () => {
  const armedAt = new Date('2026-09-17T00:00:00.000Z').toISOString();
  const fresh = { armedAt, used: false, usedAt: null };
  assert.equal(isArmed(fresh, Date.parse('2026-09-17T01:00:00.000Z')), true);
  assert.equal(isArmed({ ...fresh, used: true }, Date.parse('2026-09-17T01:00:00.000Z')), false, 'used disarms regardless of time');
  assert.equal(isArmed(fresh, Date.parse('2026-09-18T00:00:01.000Z')), false, '24h + 1s later is expired');
});

test('rearm resets used/expiry so a prior sitting cannot block a new one', async () => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: '2020-01-01T00:00:00.000Z', used: true, usedAt: '2020-01-01T00:00:01.000Z' });
  const rearmed = await rearm(statePath, { now: () => new Date('2026-09-17T12:00:00.000Z') });
  assert.equal(rearmed.used, false);
  const reloaded = await loadState(statePath);
  assert.equal(reloaded.used, false);
  assert.equal(isArmed(reloaded, Date.parse('2026-09-17T12:00:01.000Z')), true);
});

async function withServer(t, { statePath, writeSecret, now }, fn) {
  const server = createServer({ statePath, writeSecret, now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  t.after(() => server.close());
  return fn(`http://127.0.0.1:${port}`);
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, opts, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('a valid save is written via the injected writer and reported as received, never echoed', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), used: false, usedAt: null });
  const written = [];
  const writeSecret = async (name, value) => { written.push({ name, value }); };
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    const res = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'a'.repeat(40) }),
    });
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.sentry.ok, true);
    assert.equal(JSON.stringify(parsed).includes('a'.repeat(40)), false, 'the response never contains the raw value');
    assert.equal(written.length, 1);
    assert.equal(written[0].value, 'a'.repeat(40), 'the real value did reach the writer, just never the HTTP response');
  });
});

test('an invalid field is reported as rejected and never reaches the writer', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), used: false, usedAt: null });
  const written = [];
  const writeSecret = async (name, value) => { written.push({ name, value }); };
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    const res = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supabase: 'too short' }),
    });
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.supabase.ok, false);
    assert.equal(written.length, 0);
  });
});

test('the box turns itself off after a successful save -- a second save is refused', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), used: false, usedAt: null });
  const writeSecret = async () => {};
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'a'.repeat(40) }),
    });
    const second = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'b'.repeat(40) }),
    });
    assert.equal(second.status, 403);
    const getRes = await request(`${base}/`);
    assert.match(getRes.body, /off/i);
  });
});

test('the box is off once the 24-hour window has passed, even with no save', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: '2020-01-01T00:00:00.000Z', used: false, usedAt: null });
  const writeSecret = async () => {};
  await withServer(t, { statePath, writeSecret, now: () => Date.parse('2020-01-03T00:00:00.000Z') }, async (base) => {
    const res = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'a'.repeat(40) }),
    });
    assert.equal(res.status, 403);
  });
});

test('no raw field value is ever written to console output during a save', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), used: false, usedAt: null });
  const writeSecret = async () => {};
  const secretValue = `SECRETVALUE${'x'.repeat(30)}`;
  const originalLog = console.log;
  const logged = [];
  console.log = (...args) => { logged.push(args.join(' ')); };
  try {
    await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
      await request(`${base}/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ axiom: secretValue }),
      });
    });
  } finally {
    console.log = originalLog;
  }
  const joined = logged.join('\n');
  assert.equal(joined.includes(secretValue), false, 'the raw secret value must never appear in a log line');
});

test('GET / never contains any field value from a prior save', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), used: false, usedAt: null });
  const writeSecret = async () => {};
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    const res = await request(`${base}/`);
    for (const f of FIELDS) {
      assert.equal(res.body.includes('value='), false, 'the form never pre-fills a value attribute');
    }
  });
});

test('FIELDS is exactly the four services this ticket names', () => {
  assert.deepEqual([...FIELDS].sort(), ['axiom', 'powersync', 'sentry', 'supabase']);
});
