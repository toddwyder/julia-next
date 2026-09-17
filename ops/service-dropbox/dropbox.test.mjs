import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createServer, validateFieldShape, isArmed, saveState, loadState, rearm, FIELDS, allReceived,
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

test('isArmed: true when freshly armed, false once all four received, false after 24h', () => {
  const armedAt = new Date('2026-09-17T00:00:00.000Z').toISOString();
  const fresh = { armedAt, received: {}, usedAt: null };
  const partial = { armedAt, received: { sentry: true, supabase: true }, usedAt: null };
  const complete = { armedAt, received: { sentry: true, supabase: true, powersync: true, axiom: true }, usedAt: null };
  assert.equal(isArmed(fresh, Date.parse('2026-09-17T01:00:00.000Z')), true);
  assert.equal(isArmed(partial, Date.parse('2026-09-17T01:00:00.000Z')), true, 'a partial round stays armed');
  assert.equal(isArmed(complete, Date.parse('2026-09-17T01:00:00.000Z')), false, 'all four received disarms regardless of time');
  assert.equal(isArmed(fresh, Date.parse('2026-09-18T00:00:01.000Z')), false, '24h + 1s later is expired');
});

test('allReceived is true only when every field in FIELDS has been received', () => {
  assert.equal(allReceived({ received: {} }), false);
  assert.equal(allReceived({ received: { sentry: true, supabase: true, powersync: true } }), false, 'axiom missing');
  assert.equal(allReceived({ received: { sentry: true, supabase: true, powersync: true, axiom: true } }), true);
});

test('rearm resets received/expiry so a prior sitting cannot block a new one', async () => {
  const statePath = tmpState();
  await saveState(statePath, {
    armedAt: '2020-01-01T00:00:00.000Z',
    received: { sentry: true, supabase: true, powersync: true, axiom: true },
    usedAt: '2020-01-01T00:00:01.000Z',
  });
  const rearmed = await rearm(statePath, { now: () => new Date('2026-09-17T12:00:00.000Z') });
  assert.deepEqual(rearmed.received, {});
  const reloaded = await loadState(statePath);
  assert.deepEqual(reloaded.received, {});
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
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
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
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
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

test('a partial round (one box filled) stays armed, and a later round can save the rest', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
  const written = [];
  const writeSecret = async (name, value) => { written.push({ name, value }); };
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    const first = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'a'.repeat(40) }),
    });
    const firstParsed = JSON.parse(first.body);
    assert.equal(firstParsed.sentry.ok, true);
    assert.equal(firstParsed.allReceived, false, 'three fields still missing');

    const stillOpen = await request(`${base}/`);
    assert.doesNotMatch(stillOpen.body, /page is off/i, 'a partial round must not turn the page off');

    const second = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supabase: 'b'.repeat(40), powersync: 'c'.repeat(40), axiom: 'd'.repeat(40),
      }),
    });
    const secondParsed = JSON.parse(second.body);
    assert.equal(secondParsed.allReceived, true, 'the fourth field completes the sitting');
    assert.equal(written.length, 4);

    const now403 = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'e'.repeat(40) }),
    });
    assert.equal(now403.status, 403, 'the box is off once all four are received');
  });
});

test('a field already received is never overwritten by a later round, even if resubmitted', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
  const written = [];
  const writeSecret = async (name, value) => { written.push({ name, value }); };
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'a'.repeat(40) }),
    });
    const resubmit = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'DIFFERENT'.repeat(5) }),
    });
    const parsed = JSON.parse(resubmit.body);
    assert.equal(parsed.sentry.alreadyReceived, true);
    assert.equal(written.length, 1, 'the helper is never invoked a second time for the same field');
    assert.equal(written[0].value, 'a'.repeat(40), 'the original value is untouched');
  });
});

test('the box is off once the 24-hour window has passed, even with no save', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: '2020-01-01T00:00:00.000Z', received: {}, usedAt: null });
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
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
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
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
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
