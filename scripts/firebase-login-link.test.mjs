import assert from 'node:assert/strict';
import test from 'node:test';
import scopes from 'firebase-tools/lib/scopes.js';
import { CALLBACK, SCOPES, codeFromPaste, loginUrl, readTokenAnswer } from './firebase-login-link.mjs';

const jwt = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

test('the link asks for exactly the permissions the firebase CLI asks for', () => {
  assert.deepEqual(SCOPES, [
    scopes.EMAIL,
    scopes.OPENID,
    scopes.CLOUD_PROJECTS_READONLY,
    scopes.FIREBASE_PLATFORM,
    scopes.CLOUD_PLATFORM,
  ]);
  const asked = new URL(loginUrl()).searchParams;
  assert.equal(asked.get('scope'), SCOPES.join(' '));
});

test('the link carries no token of its own, so waiting does not break it', () => {
  const asked = new URL(loginUrl()).searchParams;
  assert.equal(asked.has('attest'), false);
  assert.equal(asked.get('response_type'), 'code');
  assert.equal(asked.get('redirect_uri'), CALLBACK);
  assert.equal(asked.get('access_type'), 'offline');
  assert.match(asked.get('prompt'), /select_account/);
  assert.match(asked.get('prompt'), /consent/);
});

test('a refused code says what Google said', () => {
  assert.throws(() => readTokenAnswer(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' }), /invalid_grant/);
});

test('a login that would forget itself is refused', () => {
  assert.throws(() => readTokenAnswer(200, { access_token: 'a', id_token: jwt({ email: 'a@b.test' }) }), /no refresh token/);
});

test('a good answer names the account that approved it', () => {
  const answer = readTokenAnswer(200, { refresh_token: 'refresh', id_token: jwt({ email: 'second@example.test', sub: '42' }) });
  assert.deepEqual(answer, { email: 'second@example.test', userId: '42', refresh: 'refresh' });
});

test('the code can be pasted bare or with the browser address around it', () => {
  assert.equal(codeFromPaste('4/0AeanS0abc'), '4/0AeanS0abc');
  assert.equal(codeFromPaste('http://localhost:9005/?state=julia-next&code=4%2F0AeanS0abc&scope=email'), '4/0AeanS0abc');
  assert.equal(codeFromPaste('localhost:9005/?code=4%2F0AeanS0abc'), '4/0AeanS0abc');
  assert.throws(() => codeFromPaste('   '), /No code given/);
});
