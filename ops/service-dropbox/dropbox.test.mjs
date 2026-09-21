import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
      sentry: true, supabase: true, powersync: true, axiom: true, deepseek: true, linear: true,
    },
    usedAt: null,
  };
  assert.equal(isArmed(fresh, Date.parse('2026-09-17T01:00:00.000Z')), true);
  assert.equal(isArmed(partial, Date.parse('2026-09-17T01:00:00.000Z')), true, 'a partial round stays armed');
  assert.equal(isArmed(complete, Date.parse('2026-09-17T01:00:00.000Z')), false, 'all six received disarms regardless of time');
  assert.equal(isArmed(fresh, Date.parse('2026-09-18T00:00:01.000Z')), false, '24h + 1s later is expired');
});

test('allReceived is true only when every field in FIELDS has been received', () => {
  assert.equal(allReceived({ received: {} }), false);
  assert.equal(allReceived({ received: { sentry: true, supabase: true, powersync: true } }), false, 'axiom missing');
  assert.equal(allReceived({
    received: {
      sentry: true, supabase: true, powersync: true, axiom: true, deepseek: true, linear: true,
    },
  }), true);
  assert.equal(allReceived({
    received: {
      sentry: true, supabase: true, powersync: true, axiom: true, deepseek: true,
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
    assert.equal(firstParsed.allReceived, false, 'five fields still missing');

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
        linear: 'g'.repeat(40),
      }),
    });
    const secondParsed = JSON.parse(second.body);
    assert.equal(secondParsed.allReceived, true, 'the sixth field completes the sitting');
    assert.equal(written.length, 6);

    const now403 = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'e'.repeat(40) }),
    });
    assert.equal(now403.status, 403, 'the box is off once all six are received');
  });
});

test('a field already received can be replaced: the new value reaches the writer and the old one is not kept', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
  // Stands in for write-secret.sh, which replaces the destination file
  // atomically (mv -f), so one slot per field is exactly what the server has.
  const stored = {};
  const writeSecret = async (name, value) => { stored[name] = value; };
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'a'.repeat(40) }),
    });
    const replace = await request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentry: 'b'.repeat(40) }),
    });
    const parsed = JSON.parse(replace.body);
    assert.equal(parsed.sentry.ok, true);
    assert.equal(parsed.sentry.alreadyReceived, undefined, 'a resubmitted field is saved, not skipped');
    assert.equal(stored.sentry, 'b'.repeat(40), 'the new value overwrote the old one');
    assert.equal(Object.values(stored).includes('a'.repeat(40)), false, 'the old value is gone');
    assert.equal(JSON.stringify(parsed).includes('b'.repeat(40)), false, 'the response never contains the raw value');
    assert.equal((await loadState(statePath)).received.sentry, true, 'the field still counts as received');
  });
});

test('every received field can be replaced, not just the first one saved', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
  const stored = {};
  const writeSecret = async (name, value) => { stored[name] = value; };
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    const post = (body) => request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Leave one field unsent so the box stays armed after the first round.
    const first = {};
    const second = {};
    for (const f of FIELDS.filter((x) => x !== 'linear')) {
      first[f] = `old-${f}-`.padEnd(40, '1');
      second[f] = `new-${f}-`.padEnd(40, '2');
    }
    await post(first);
    const res = JSON.parse((await post(second)).body);
    for (const f of FIELDS.filter((x) => x !== 'linear')) {
      assert.equal(res[f].ok, true, `${f} was replaced`);
      assert.equal(stored[f], second[f], `${f} holds the new value`);
    }
  });
});

test('a bad replacement is rejected and the working value is left in place', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
  const stored = {};
  const writeSecret = async (name, value) => { stored[name] = value; };
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    const post = (body) => request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await post({ sentry: 'a'.repeat(40) });
    const bad = JSON.parse((await post({ sentry: 'too short' })).body);
    assert.equal(bad.sentry.ok, false);
    assert.equal(stored.sentry, 'a'.repeat(40), 'the earlier working value is untouched');
    assert.equal((await loadState(statePath)).received.sentry, true, 'still counted as received');
  });
});

test('a box left blank on a later round does not touch the saved value', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, { armedAt: new Date().toISOString(), received: {}, usedAt: null });
  const written = [];
  const writeSecret = async (name, value) => { written.push({ name, value }); };
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    const post = (body) => request(`${base}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await post({ sentry: 'a'.repeat(40) });
    await post({ sentry: '', supabase: 'b'.repeat(40) });
    assert.deepEqual(written.map((w) => w.name), ['sentry', 'supabase'], 'sentry was written once, never re-written blank');
  });
});

test('the form keeps every box open, including ones already received', async (t) => {
  const statePath = tmpState();
  await saveState(statePath, {
    armedAt: new Date().toISOString(),
    received: { sentry: true, supabase: true },
    usedAt: null,
  });
  const writeSecret = async () => {};
  await withServer(t, { statePath, writeSecret, now: () => Date.now() }, async (base) => {
    const res = await request(`${base}/`);
    assert.doesNotMatch(res.body, /<input[^>]*disabled/, 'no input is locked');
    assert.doesNotMatch(res.body, /locked/i, 'the page no longer tells Todd a received box is locked');
    assert.match(res.body, /id="sentry-status"[^>]*>received/, 'a received box still shows it was received');
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

test('FIELDS is exactly the six services this drop box now names (JUL-72 + JUL-77, GLM removed in JUL-93)', () => {
  assert.deepEqual(
    [...FIELDS].sort(),
    ['axiom', 'deepseek', 'linear', 'powersync', 'sentry', 'supabase'],
  );
});

test('GLM (zai) is not a drop-box field: no box, no reader group, no hint (JUL-93)', () => {
  assert.ok(!FIELDS.includes('zai'));
  assert.ok(!Object.hasOwn(FIELD_GROUPS, 'zai'));
  assert.ok(!Object.values(FIELD_GROUPS).includes('zai-readers'));
});

test('a plausible new-field value (deepseek/linear) is accepted the same as any other field', () => {
  assert.equal(validateFieldShape('deepseek', 'd'.repeat(40)).ok, true);
  assert.equal(validateFieldShape('linear', 'lin_api_'.padEnd(40, '1')).ok, true);
});

// JUL-77: two model/service keys land in different readers than the
// original four (which are all orchestrator-svc-only). This mapping is the
// single source of truth both this file and write-secret.sh's own test
// assert against, so the two can never silently drift apart.
test('FIELD_GROUPS routes each field to the exact reader(s) JUL-77 specifies', () => {
  assert.deepEqual(FIELD_GROUPS, {
    sentry: 'orchestrator-svc',
    supabase: 'orchestrator-svc',
    powersync: 'orchestrator-svc',
    axiom: 'orchestrator-svc',
    // Pi builder and reviewer (runner) AND the orchestrator-deepseek route --
    // a dedicated group with both accounts as members, never
    // orchestrator-svc's own group directly (that would let runner read the
    // orchestrator-only fields too).
    deepseek: 'deepseek-readers',
    // Orchestrator-svc only, same as the original four.
    linear: 'orchestrator-svc',
  });
});

test('every field in FIELDS has exactly one entry in FIELD_GROUPS, and vice versa', () => {
  assert.deepEqual([...FIELDS].sort(), Object.keys(FIELD_GROUPS).sort());
});

// --- Tripwires for the bind-address protections (JUL-62) ----------------
// The protections live in dropbox.mjs and dropbox.env.example. These tests
// exist so removing or weakening one turns the suite red. They were first
// written as steps in ci.yml (JUL-72, 17 Sep) and dropped when CI wiring
// moved to scripts/*.test.mjs, so they live here as ordinary tests instead.
const DROPBOX_PATH = fileURLToPath(new URL('./dropbox.mjs', import.meta.url));

function sourceText(name) {
  // Normalize CRLF -> LF: a Windows checkout with core.autocrlf can
  // materialize these files as CRLF.
  return readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

// Really starts dropbox.mjs with the given bind address (undefined = unset)
// on an OS-picked port and a throwaway state file. Resolves with what
// happened: it exited (refused) or it printed "listening" (bound), in which
// case it is killed straight away so a broken guard never leaves a server up.
function startDropbox(bindAddr) {
  const stateDir = mkdtempSync(join(tmpdir(), 'dropbox-bind-'));
  const env = {
    PATH: process.env.PATH,
    DROPBOX_PORT: '0',
    DROPBOX_STATE_PATH: join(stateDir, 'state.json'),
  };
  if (bindAddr !== undefined) env.DROPBOX_BIND_ADDR = bindAddr;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DROPBOX_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      rmSync(stateDir, { recursive: true, force: true });
      resolve({ ...result, output: out });
    };
    const timer = setTimeout(() => finish({ outcome: 'timed out' }), 10000);
    child.stdout.on('data', (d) => { out += d; if (/dropbox listening/.test(out)) finish({ outcome: 'bound' }); });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => finish({ outcome: 'exited', code }));
  });
}

test('dropbox.mjs refuses to start with an unset bind address', async () => {
  const r = await startDropbox(undefined);
  assert.equal(r.outcome, 'exited', `expected a refusal, got: ${r.outcome}\n${r.output}`);
  assert.notEqual(r.code, 0);
  assert.match(r.output, /DROPBOX_BIND_ADDR must be set/);
});

test('dropbox.mjs refuses to start with an empty bind address', async () => {
  const r = await startDropbox('');
  assert.equal(r.outcome, 'exited', `expected a refusal, got: ${r.outcome}\n${r.output}`);
  assert.notEqual(r.code, 0);
  assert.match(r.output, /DROPBOX_BIND_ADDR must be set/);
});

test('dropbox.mjs refuses to start bound to 0.0.0.0 (every IPv4 interface)', async () => {
  const r = await startDropbox('0.0.0.0');
  assert.equal(r.outcome, 'exited', `expected a refusal, got: ${r.outcome}\n${r.output}`);
  assert.notEqual(r.code, 0);
  assert.match(r.output, /refusing to bind to all interfaces/);
});

test('dropbox.mjs refuses to start bound to :: (every IPv6 interface)', async () => {
  const r = await startDropbox('::');
  assert.equal(r.outcome, 'exited', `expected a refusal, got: ${r.outcome}\n${r.output}`);
  assert.notEqual(r.code, 0);
  assert.match(r.output, /refusing to bind to all interfaces/);
});

// Control: without this, the four refusals above would also pass if the
// server could never start at all.
test('dropbox.mjs does start when given one specific address', async () => {
  const r = await startDropbox('127.0.0.1');
  assert.equal(r.outcome, 'bound', `expected it to start, got: ${r.outcome}\n${r.output}`);
});

test('dropbox.mjs only ever listens on the configured address, never a literal all-interfaces one', () => {
  const src = sourceText('./dropbox.mjs');
  const listenCalls = src.match(/\.listen\([^)]*\)/g) ?? [];
  assert.ok(listenCalls.length > 0, 'expected dropbox.mjs to call listen()');
  for (const call of listenCalls) {
    assert.doesNotMatch(call, /0\.0\.0\.0|'::'|"::"/, `listen call binds all interfaces: ${call}`);
    assert.match(call, /BIND_ADDR/, `listen call must bind the configured BIND_ADDR: ${call}`);
  }
});

test('the example env file holds only a placeholder bind address, no real address', () => {
  const lines = sourceText('./dropbox.env.example').split('\n');
  const binds = lines.filter((l) => /^DROPBOX_BIND_ADDR=/.test(l));
  assert.equal(binds.length, 1, 'expected exactly one DROPBOX_BIND_ADDR line');
  assert.match(binds[0], /^DROPBOX_BIND_ADDR=REPLACE_[A-Z_]+$/, 'bind address must be a REPLACE_... placeholder');
  const uncommented = lines.filter((l) => !l.startsWith('#')).join('\n');
  assert.doesNotMatch(uncommented, /\b\d{1,3}(\.\d{1,3}){3}\b/, 'no IPv4 address may appear in the example env file');
});
