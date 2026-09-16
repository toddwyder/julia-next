import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';

import { base64url, getPublisherInstallationToken, mintAppJwt } from './publish-via-github-app.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const publicKeyPem = publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();

test('refuses to publish when JULIA_PUBLISHER_APP_ID/PRIVATE_KEY are missing', async () => {
  await assert.rejects(() => getPublisherInstallationToken({}), /JULIA_PUBLISHER_APP_ID/);
});

test("mints a JWT signed by the App's own private key, verifiable with its public key", () => {
  const jwt = mintAppJwt('4948330', privateKeyPem, { now: () => 1_000_000 });
  const [headerB64, payloadB64, signatureB64] = jwt.split('.');

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  assert.equal(payload.iss, '4948330');
  assert.equal(payload.iat, 1_000_000 - 60);
  assert.equal(payload.exp, 1_000_000 + 540);

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64, 'base64url');
  assert.ok(verifier.verify(publicKeyPem, signature), "JWT signature must verify against the App's public key");
});

test('mints an installation token via the standard two-call GitHub App flow, scoped to the repo JULIA_PUBLISHER_REPO names', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/repos/toddwyder/julia-next/installation')) {
      assert.match(init.headers.Authorization, /^Bearer /);
      return { ok: true, json: async () => ({ id: 999 }) };
    }
    if (url.endsWith('/app/installations/999/access_tokens')) {
      assert.equal(init.method, 'POST');
      // Restrict the minted token to the target repo explicitly -- an
      // installation token defaults to every repo the App's installation
      // covers, which can be broader than the one repo this call names
      // (PR #3 review: "the access-token request supplies no repository
      // or permission restriction").
      assert.deepEqual(JSON.parse(init.body), { repositories: ['julia-next'] });
      return { ok: true, json: async () => ({ token: 'ghs_fake-installation-token' }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const token = await getPublisherInstallationToken(
    { JULIA_PUBLISHER_APP_ID: '4948330', JULIA_PUBLISHER_APP_PRIVATE_KEY: privateKeyPem, JULIA_PUBLISHER_REPO: 'julia-next' },
    fakeFetch,
  );

  assert.equal(token, 'ghs_fake-installation-token');
  assert.deepEqual(calls, [
    'https://api.github.com/repos/toddwyder/julia-next/installation',
    'https://api.github.com/app/installations/999/access_tokens',
  ]);
});

test('a repo the App is not installed on fails clearly instead of falling back to Julia', async () => {
  const fakeFetch = async (url) => {
    if (url.endsWith('/repos/toddwyder/julia-next/installation')) return { ok: false, status: 404 };
    throw new Error(`unexpected fetch: ${url}`);
  };
  await assert.rejects(
    () => getPublisherInstallationToken(
      { JULIA_PUBLISHER_APP_ID: '4948330', JULIA_PUBLISHER_APP_PRIVATE_KEY: privateKeyPem, JULIA_PUBLISHER_REPO: 'julia-next' },
      fakeFetch,
    ),
    /not installed on toddwyder\/julia-next/,
  );
});

test('base64url encodes without padding or unsafe characters', () => {
  const encoded = base64url(JSON.stringify({ a: 1 }));
  assert.ok(!encoded.includes('='));
  assert.ok(!encoded.includes('+'));
  assert.ok(!encoded.includes('/'));
});
