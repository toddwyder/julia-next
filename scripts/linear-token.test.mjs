import assert from 'node:assert/strict';
import test from 'node:test';
import { TOKEN_URL, authorizationHeader, requestToken, runWithFreshToken } from './linear-token.mjs';

const clients = { clientId: 'client-abc', clientSecret: 'secret-xyz' };

const answering = (body, status = 200) => async (url, init) => {
  answering.last = { url, init };
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
};

test('the grant trades the client pair for an access token', async () => {
  const fetchImpl = answering({ access_token: 'minted-token', token_type: 'Bearer', expires_in: 2591999 });
  const token = await requestToken({ ...clients, fetchImpl });
  assert.equal(token, 'minted-token');
  assert.equal(answering.last.url, TOKEN_URL);
  assert.equal(answering.last.init.method, 'POST');
  assert.equal(answering.last.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(answering.last.init.body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), 'client-abc');
  assert.equal(body.get('client_secret'), 'secret-xyz');
  assert.equal(body.get('scope'), 'read,write,issues:create,comments:create');
});

test('a refused grant names the reason and never repeats the secret', async () => {
  const fetchImpl = answering({ error: 'invalid_scope', error_description: 'Invalid scope: Requested scope is invalid' }, 400);
  await assert.rejects(requestToken({ ...clients, fetchImpl }), error => {
    assert.match(error.message, /invalid_scope/);
    assert.match(error.message, /Invalid scope: Requested scope is invalid/);
    assert.ok(!error.message.includes('secret-xyz'));
    return true;
  });
});

test('a missing secret is named, not guessed at', async () => {
  await assert.rejects(requestToken({ clientId: 'client-abc', fetchImpl: answering({}) }), /LINEAR_CLIENT_SECRET/);
});

test('the command runs with a fresh Bearer header and without the secret', async () => {
  let seen;
  const spawn = (command, args, options) => {
    seen = { command, args, options };
    return { status: 7 };
  };
  const status = await runWithFreshToken(['node', 'scripts/linear-cli.mjs', 'get-issue', 'JUL-307'], {
    env: { PATH: '/usr/bin', LINEAR_CLIENT_ID: 'client-abc', LINEAR_CLIENT_SECRET: 'secret-xyz' },
    fetchImpl: answering({ access_token: 'minted-token', token_type: 'Bearer', expires_in: 2591999 }),
    spawn,
  });
  assert.equal(status, 7);
  assert.equal(seen.command, 'node');
  assert.deepEqual(seen.args, ['scripts/linear-cli.mjs', 'get-issue', 'JUL-307']);
  assert.equal(seen.options.env.LINEAR_API_KEY, 'Bearer minted-token');
  assert.equal(seen.options.env.LINEAR_CLIENT_SECRET, undefined);
});

test('a refused grant stops the command instead of running it without access', async () => {
  let spawned = false;
  await assert.rejects(runWithFreshToken(['node', 'x.mjs'], {
    env: { LINEAR_CLIENT_ID: clients.clientId, LINEAR_CLIENT_SECRET: clients.clientSecret },
    fetchImpl: answering({ error: 'invalid_client', error_description: 'Client authentication failed' }, 401),
    spawn: () => { spawned = true; return { status: 0 }; },
  }), /invalid_client/);
  assert.equal(spawned, false);
});

test('the header carried into the child is the Bearer form Linear accepts', () => {
  assert.equal(authorizationHeader('abc'), 'Bearer abc');
  assert.equal(authorizationHeader(''), '');
});
