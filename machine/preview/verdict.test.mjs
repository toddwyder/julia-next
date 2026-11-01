// One PASS or FAIL, built from lines the machine can point at. Every case here
// is a way a reader could have been told something better than the truth.
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNote, recordBody, stopMessage, verdictOf } from './verdict.mjs';

const passingCheck = { name: 'web', status: 'completed', conclusion: 'success', sha: 'abc', ok: true };
const passingProof = { name: 'server tests', command: 'node scripts/test-owners.mjs --run server', ok: true, code: 0, seconds: 4, skipped: 0, detail: 'exited 0' };
const unchanged = { dir: '/var/lib/julia-dashboard/state', before: { digest: 'a' }, after: { digest: 'a' }, unchanged: true };

test('every line passing is one PASS with each line named', () => {
  const judged = verdictOf({
    scope: 'dashboard',
    preview: { address: 'http://100.119.112.9:4401', buildSeconds: 33.4 },
    checks: { sha: 'abc', ok: true, items: [passingCheck], failed: [], counts: { total: 1, passed: 1, failed: 0, skipped: 0 } },
    proofs: [passingProof],
    live: unchanged,
  });

  assert.equal(judged.verdict, 'PASS');
  assert.equal(judged.ok, true);
  assert.deepEqual(judged.failing, []);
  assert.deepEqual(judged.items.map(item => item.name), ['preview', 'web', 'server tests', 'live dashboard records']);
  assert.equal(judged.items[0].detail, 'http://100.119.112.9:4401, built in 33.4s');
});

test('a check the runner skipped counts against the commit like a failure', () => {
  const judged = verdictOf({
    scope: 'machine',
    checks: {
      sha: 'abc',
      ok: false,
      items: [{ name: 'package-tests', status: 'completed', conclusion: 'skipped', sha: 'abc', ok: false }],
      failed: ['package-tests'],
      counts: { total: 1, passed: 0, failed: 1, skipped: 1 },
    },
    proofs: [passingProof],
    live: unchanged,
  });

  assert.equal(judged.verdict, 'FAIL');
  assert.deepEqual(judged.failing, ['package-tests: skipped']);
});

test('a commit the machine could not read checks for is a FAIL, not an empty list', () => {
  const never = verdictOf({ scope: 'machine', checks: null, proofs: [passingProof], live: unchanged });
  assert.equal(never.verdict, 'FAIL');
  assert.deepEqual(never.failing, ['pull request checks: the machine never read them']);

  const failedRead = verdictOf({
    scope: 'machine',
    checks: { sha: 'abc', ok: false, items: [], failed: ["the pull request's checks could not be read: gh exited 1"], counts: { total: 0, passed: 0, failed: 0, skipped: 0 } },
    proofs: [passingProof],
    live: unchanged,
  });
  assert.equal(failedRead.verdict, 'FAIL');
  assert.match(failedRead.failing[0], /gh exited 1/);
});

test('a change that never meets the dashboard needs no preview and is not marked down for one', () => {
  const judged = verdictOf({ scope: 'machine', checks: { ok: true, items: [passingCheck] }, proofs: [passingProof], live: unchanged });

  assert.equal(judged.verdict, 'PASS');
  assert.equal(judged.items[0].skip, true);
  assert.equal(judged.items[0].detail, 'not needed: the change touches no file under dashboard/');
});

test('a dashboard change whose preview never answered fails on the reason it did not', () => {
  const judged = verdictOf({
    scope: 'dashboard',
    preview: null,
    previewGap: 'the dashboard did not build: npm exited 1',
    checks: { ok: true, items: [passingCheck] },
    proofs: [passingProof],
    live: unchanged,
  });

  assert.equal(judged.verdict, 'FAIL');
  assert.deepEqual(judged.failing, ['preview: the dashboard did not build: npm exited 1']);

  const silent = verdictOf({ scope: 'dashboard', checks: { ok: true, items: [passingCheck] }, proofs: [passingProof], live: unchanged });
  assert.deepEqual(silent.failing, ['preview: the preview never answered']);
});

test('live records that moved while the preview ran fail the change', () => {
  const judged = verdictOf({
    scope: 'dashboard',
    preview: { address: 'http://127.0.0.1:4401' },
    checks: { ok: true, items: [passingCheck] },
    proofs: [passingProof],
    live: { dir: '/var/lib/julia-dashboard/state', before: { digest: 'a' }, after: { digest: 'b' }, unchanged: false },
  });

  assert.equal(judged.verdict, 'FAIL');
  assert.deepEqual(judged.failing, ['live dashboard records: changed while the preview ran']);
});

test('the live failure names the record that moved, so the reader can look at it', () => {
  const judged = verdictOf({
    scope: 'machine',
    checks: { ok: true, items: [passingCheck] },
    proofs: [passingProof],
    live: {
      dir: '/var/lib/julia-dashboard/state',
      before: { digest: 'a' },
      after: { digest: 'b' },
      unchanged: false,
      touched: [{ path: 'runs/jul-290.json', how: 'changed' }],
    },
  });

  assert.deepEqual(judged.failing, ['live dashboard records: touched while the preview ran: runs/jul-290.json changed']);
});

test('a run with no live folder to compare says so without failing the change', () => {
  const judged = verdictOf({ scope: 'machine', checks: { ok: true, items: [passingCheck] }, proofs: [passingProof], live: null });

  assert.equal(judged.verdict, 'PASS');
  assert.equal(judged.items.at(-1).skip, true);
  assert.equal(judged.items.at(-1).detail, 'not compared: no live state folder was given');
});

test('the record lists every check and proof, and what failed only when something did', () => {
  const record = {
    pr: 412,
    sha: 'abc123',
    card: { identifier: 'JUL-308' },
    scope: 'dashboard',
    scopeReason: '2 files changed under dashboard/, so this change gets a preview',
    verdict: 'PASS',
    items: [
      { kind: 'preview', name: 'preview', ok: true, detail: 'http://127.0.0.1:4401' },
      { kind: 'check', name: 'web', ok: true, detail: 'success' },
      { kind: 'proof', name: 'server tests', ok: true, detail: 'exited 0, 0 skipped' },
      { kind: 'live', name: 'live dashboard records', ok: true, detail: 'identical before and after the run', skip: false },
    ],
    failing: [],
    at: '2026-11-01T18:00:00.000Z',
  };

  const body = recordBody(record);
  assert.match(body, /^## PASS: preview and smoke test for #412/);
  assert.match(body, /Commit `abc123` of pull request #412 on JUL-308\./);
  assert.match(body, /2 files changed under dashboard\/, so this change gets a preview\./);
  assert.match(body, /- web: pass \(success\)/);
  assert.match(body, /- server tests: pass \(exited 0, 0 skipped\)/);
  assert.match(body, /Recorded 2026-11-01T18:00:00.000Z by the preview machine\./);
  assert.equal(body.includes('### What failed'), false);
});

test('a FAIL record names what failed, and a not-needed line reads as such', () => {
  const body = recordBody({
    pr: 412,
    sha: 'abc123',
    card: { identifier: 'JUL-308' },
    scope: 'machine',
    verdict: 'FAIL',
    items: [
      { kind: 'preview', name: 'preview', ok: true, detail: 'not needed', skip: true },
      { kind: 'proof', name: 'local tests', ok: false, detail: 'exited 1' },
    ],
    failing: ['local tests: exited 1'],
    at: '2026-11-01T18:00:00.000Z',
  });

  assert.match(body, /^## FAIL: preview and smoke test for #412/);
  assert.match(body, /- preview: not needed \(not needed\)/);
  assert.match(body, /- local tests: FAIL \(exited 1\)/);
  assert.match(body, /### What failed\n\n- local tests: exited 1/);
});

test('the card note sends the change back with the failing lines and the count', () => {
  const note = buildNote({ pr: 412, sha: 'abc123', failing: ['local tests: exited 1'], failCount: 1 });

  assert.match(note, /The preview and smoke test failed for #412 at `abc123`\. The card goes back to the build\./);
  assert.match(note, /- local tests: exited 1/);
  assert.match(note, /This is failure 1 of 2\. The second one stops the card\./);
});

test('the card note names the preview the failing change was driven at', () => {
  const note = buildNote({
    pr: 411,
    sha: 'abc123',
    preview: { address: 'http://100.119.112.9:4401' },
    failing: ['dashboard proofs: exited 1: lane 5 FAIL refuse to empty a panel'],
    failCount: 1,
  });
  const noPreview = buildNote({ pr: 413, sha: 'abc123', preview: null, failing: ['server tests: exited 1'], failCount: 1 });

  assert.match(note, /The second copy of the dashboard ran at http:\/\/100\.119\.112\.9:4401, with its own records folder\./);
  assert.doesNotMatch(noPreview, /second copy of the dashboard/);
});

test('the stop message reaches Todd by name and says the card is stopped', () => {
  const message = stopMessage({ pr: 412, failing: ['local tests: exited 1'], failCount: 2 });

  assert.match(message, /^https:\/\/linear\.app\/julia-next\/profiles\/toddwyder Julia stopped: the preview and smoke test failed twice for #412\./);
  assert.match(message, /- local tests: exited 1/);
  assert.match(message, /The card is stopped rather than sent back a third time\./);
});
