import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createServer, validateFieldShape, isArmed, saveState, loadState, rearm, FIELDS, allReceived,
  FIELD_GROUPS,
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
  const complete = {
    armedAt,
    received: {
      sentry: true, supabase: true, powersync: true, axiom: true, deepseek: true, zai: true, linear: true,
    },
    usedAt: null,
  };
  assert.equal(isArmed(fresh, Date.parse('2026-09-17T01:00:00.000Z')), true);
  assert.equal(isArmed(partial, Date.parse('2026-09-17T01:00:00.000Z')), true, 'a partial round stays armed');
  assert.equal(isArmed(complete, Date.parse('2026-09-17T01:00:00.000Z')), false, 'all seven received disarms regardless of time');
  assert.equal(isArmed(fresh, Date.parse('2026-09-18T00:00:01.000Z')), false, '24h + 1s later is expired');
});

test('allReceived is true only when every field in FIELDS has been received', () => {
  assert.equal(allReceived({ received: {} }), false);
  assert.equal(allReceived({ received: { sentry: true, supabase: true, powersync: true } }), false, 'axiom missing');
  assert.equal(allReceived({
    received: {
      sentry: true, supabase: true, powersync: true, axiom: true, deepseek: true, zai: true, linear: true,
    },
  }), true);
  assert.equal(allReceived({
    received: {
      sentry: true, supabase: true, powersync: true, axiom: true, deepseek: true, zai: true,
    },
  }), false, 'linear missing');
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
    assert.equal(firstParsed.allReceived, false, 'six fields still missing');

    const stillOpen = await request(`${base}/`);
    assert.doesNotMatch(stillOpen.body, /page is off/i, 'a partial round must not turn the page off');

    const second = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supabase: 'b'.repeat(40),
        powersync: 'c'.repeat(40),
        axiom: 'd'.repeat(40),
        deepseek: 'e'.repeat(40),
        zai: 'f'.repeat(40),
        linear: 'g'.repeat(40),
      }),
    });
    const secondParsed = JSON.parse(second.body);
    assert.equal(secondParsed.allReceived, true, 'the seventh field completes the sitting');
    assert.equal(written.length, 7);

    const now403 = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'e'.repeat(40) }),
    });
    assert.equal(now403.status, 403, 'the box is off once all seven are received');
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

test('FIELDS is exactly the seven services this drop box now names (JUL-72 + JUL-77)', () => {
  assert.deepEqual(
    [...FIELDS].sort(),
    ['axiom', 'deepseek', 'linear', 'powersync', 'sentry', 'supabase', 'zai'],
  );
});

test('a plausible new-field value (deepseek/zai/linear) is accepted the same as any other field', () => {
  assert.equal(validateFieldShape('deepseek', 'd'.repeat(40)).ok, true);
  assert.equal(validateFieldShape('zai', 'z'.repeat(40)).ok, true);
  assert.equal(validateFieldShape('linear', 'lin_api_'.padEnd(40, '1')).ok, true);
});

// JUL-77: three model/service keys land in different readers than the
// original four (which are all orchestrator-svc-only). This mapping is the
// single source of truth both this file and write-secret.sh's own test
// assert against, so the two can never silently drift apart.
test('FIELD_GROUPS routes each field to the exact reader(s) JUL-77 specifies', () => {
  assert.deepEqual(FIELD_GROUPS, {
    sentry: 'orchestrator-svc',
    supabase: 'orchestrator-svc',
    powersync: 'orchestrator-svc',
    axiom: 'orchestrator-svc',
    // Pi builder -- the runner account only, never orchestrator-svc.
    deepseek: 'runner',
    // Pi reviewer (runner) AND the orchestrator backup -- a dedicated group
    // with both accounts as members, never orchestrator-svc's own group
    // directly (that would let runner read the orchestrator-only fields too).
    zai: 'zai-readers',
    // Orchestrator-svc only, same as the original four.
    linear: 'orchestrator-svc',
  });
});

test('every field in FIELDS has exactly one entry in FIELD_GROUPS, and vice versa', () => {
  assert.deepEqual([...FIELDS].sort(), Object.keys(FIELD_GROUPS).sort());
});
