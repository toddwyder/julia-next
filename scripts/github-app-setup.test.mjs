import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildManifest,
  conversionUrl,
  createJwt,
  installLink,
  landingHtml,
  readApp,
  readInstallation,
  readStatus,
  saveApp,
  saveInstallation,
  saveStatus,
  stateFromLandingHtml,
  statusHtml,
} from './github-app-setup.mjs';

const origin = 'http://127.0.0.1:4399';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
const CLIENT_SECRET = 'client-secret-that-never-reaches-a-page';

const conversion = {
  id: 1234,
  slug: 'julia-runner',
  name: 'Julia Runner',
  html_url: 'https://github.com/apps/julia-runner',
  client_id: 'Iv1.abcdef',
  client_secret: CLIENT_SECRET,
  pem,
  owner: { login: 'toddwyder' },
};

function decode(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function manifestValue(html) {
  const value = /name="manifest" value="([^"]*)"/.exec(html)?.[1];
  assert.ok(value, 'the form carries a manifest value');
  return value;
}

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'github-app-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('the manifest carries the origin-derived URLs, five permissions and no webhook', () => {
  const manifest = buildManifest({ origin });
  assert.equal(manifest.name, 'Julia Runner');
  assert.equal(manifest.url, 'https://github.com/toddwyder/julia-next');
  assert.match(manifest.description, /Runs the Shipping check on julia-next cards/);
  assert.equal(manifest.redirect_url, `${origin}/callback`);
  assert.equal(manifest.setup_url, `${origin}/setup`);
  assert.equal(manifest.public, false);
  assert.deepEqual(manifest.default_permissions, {
    checks: 'write',
    statuses: 'write',
    pull_requests: 'write',
    contents: 'write',
    metadata: 'read',
  });
  assert.deepEqual(manifest.default_events, []);
  assert.equal(Object.keys(manifest.default_permissions).length, 5);
  assert.equal('hook_attributes' in manifest, false);
  assert.equal('webhook' in manifest, false);
});

test('the landing page carries a state and a manifest value that parses back', () => {
  const state = 'a'.repeat(32);
  const html = landingHtml({ state, manifest: buildManifest({ origin }) });
  assert.equal(stateFromLandingHtml(html), state);
  assert.match(html, /method="post"/);
  assert.match(html, new RegExp(`action="https://github\\.com/settings/apps/new\\?state=${state}"`));
  assert.match(html, /<button type="submit">Create the Julia Runner app<\/button>/);
  assert.match(html, /<\/form>/);
  assert.deepEqual(JSON.parse(decode(manifestValue(html))), buildManifest({ origin }));
});

test('a manifest value holding a quote and an angle bracket is escaped', () => {
  const html = landingHtml({ state: 'b'.repeat(32), manifest: { name: 'A "quoted" <tag> app', default_events: [] } });
  const value = manifestValue(html);
  assert.ok(value.includes('&quot;'), `the quote is escaped: ${value}`);
  assert.ok(value.includes('&lt;tag&gt;'), `the angle brackets are escaped: ${value}`);
  assert.equal(value.includes('"'), false);
  assert.equal(value.includes('<'), false);
  assert.deepEqual(JSON.parse(decode(value)), { name: 'A "quoted" <tag> app', default_events: [] });
});

test('a landing page with no form action has no state to give', () => {
  assert.throws(() => stateFromLandingHtml('<main>nothing here</main>'), /no form action/);
});

test('a state holding markup cannot break out of the attribute it sits in', () => {
  const state = '"><script>alert(1)</script>';
  const html = landingHtml({ state, manifest: buildManifest({ origin }) });
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /action="https:\/\/github\.com\/settings\/apps\/new\?state=%22%3E%3Cscript%3Ealert\(1\)%3C%2Fscript%3E"/);
});

test('the jwt carries the required header and claims and its signature verifies', () => {
  const now = Date.UTC(2026, 9, 29, 12, 0, 0);
  const jwt = createJwt({ appId: 123456, privateKey: pem, now });
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString('utf8')), { alg: 'RS256', typ: 'JWT' });
  const issued = Math.floor(now / 1000);
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')), { iat: issued - 60, exp: issued + 540, iss: 123456 });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${claims}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, 'base64url')), true, 'the app key signed the header and claims');
});

test('saveApp writes both secret files at 0600 and readApp reads the app back', t => {
  const directory = join(scratch(t), 'config');
  const savedAt = Date.UTC(2026, 9, 29, 12, 0, 0);
  const { appFile, keyFile } = saveApp({ directory, conversion, now: savedAt });
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(appFile).mode & 0o777, 0o600);
  assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  assert.equal(readFileSync(keyFile, 'utf8'), pem);
  const app = readApp({ directory });
  assert.equal(app.id, 1234);
  assert.equal(app.slug, 'julia-runner');
  assert.equal(app.name, 'Julia Runner');
  assert.equal(app.html_url, 'https://github.com/apps/julia-runner');
  assert.equal(app.client_id, 'Iv1.abcdef');
  assert.equal(app.client_secret, CLIENT_SECRET);
  assert.equal(app.saved_at, new Date(savedAt).toISOString());
  assert.equal('pem' in app, false, 'the key is not copied into app.json');
});

test('readApp answers null for a directory nothing has been saved in', t => {
  assert.equal(readApp({ directory: scratch(t) }), null);
});

test('an installation id is saved in a file only its owner can read', t => {
  const directory = scratch(t);
  const savedAt = Date.UTC(2026, 9, 29, 12, 0, 0);
  const file = saveInstallation({ directory, installationId: 42, now: savedAt });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readInstallation({ directory }), { installation_id: 42, saved_at: new Date(savedAt).toISOString() });
  assert.equal(readInstallation({ directory: scratch(t) }), null);
});

test('each status write keeps the steps before it and stamps the time', t => {
  const directory = scratch(t);
  saveStatus({ directory, status: { app: 'created', credentials: 'saved' } });
  saveStatus({ directory, status: { installation: 42 } });
  const status = readStatus({ directory });
  assert.equal(status.app, 'created');
  assert.equal(status.credentials, 'saved');
  assert.equal(status.installation, 42);
  assert.equal(status.verified, false);
  assert.deepEqual(status.errors, []);
  assert.ok(!Number.isNaN(Date.parse(status.updated_at)), `updated_at is a time: ${status.updated_at}`);
});

test('installLink and conversionUrl point at GitHub with the value encoded', () => {
  assert.equal(installLink('julia-runner'), 'https://github.com/apps/julia-runner/installations/new');
  assert.equal(conversionUrl('a+b/c'), 'https://api.github.com/app-manifests/a%2Bb%2Fc/conversions');
});

test('the status page says Waiting until a step has happened, then shows its result and every error', () => {
  const waiting = statusHtml({ status: { app: null, credentials: null, installation: null, verified: false, login: null, errors: [] }, app: null });
  assert.equal((waiting.match(/Waiting/g) ?? []).length, 4);
  assert.equal(waiting.includes('Done'), false);

  const failed = statusHtml({
    status: { app: 'created', credentials: 'saved', installation: 42, verified: false, login: null, errors: ['https://api.github.com/app answered 401: Bad credentials'] },
    app: { name: 'Julia Runner', slug: 'julia-runner' },
  });
  assert.equal((failed.match(/Done/g) ?? []).length, 3);
  assert.match(failed, /Verified: <strong>Waiting<\/strong>/);
  assert.match(failed, /answered 401: Bad credentials/);

  const done = statusHtml({ status: { app: 'created', credentials: 'saved', installation: 42, verified: true, login: 'julia-runner', errors: [] }, app: null });
  assert.match(done, /Verified: <strong>Done<\/strong> as julia-runner/);
  assert.equal(done.includes('installations/new'), false, 'a verified page offers no install link');
});
