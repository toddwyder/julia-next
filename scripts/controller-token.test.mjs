// controller-token.test.mjs -- JUL-98 step 2, item 1. The controller writes to
// Linear as its OWN OAuth app ("Julia controller"), whose client id and secret
// live in the drop box under `linear-app-id` / `linear-app-secret` and are
// readable by `orchestrator-svc` ONLY (ops/service-dropbox/read-secret.mjs
// KNOWN_FIELDS; JUL-98 readiness review 12:37Z). A builder runs as `runner` and
// cannot read them, so nothing here touches the real drop box: the credentials
// are read at RUN TIME, in-process, by an injected reader, and every test
// injects a fake.
//
// The token lasts 30 days (proven live 12:20Z on this card: status 200,
// `Bearer`, 30-day life, scopes `comments:create read write`). Two things must
// therefore hold and are pinned here: a new token is fetched BEFORE expiry, and
// a refused call fetches a new token and retries EXACTLY ONCE.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LINEAR_OAUTH_TOKEN_URL,
  APP_TOKEN_SCOPE,
  RENEW_BEFORE_MS,
  isAuthRefusal,
  createAppTokenProvider,
  createAuthedLinearCall,
  readAppCredentials,
  APP_CLIENT_ID_FIELD,
  APP_CLIENT_SECRET_FIELD,
} from '../graph/controller/token.mjs';

const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

// A stand-in for Linear's OAuth token endpoint. It hands out a new opaque
// token per call so "did it fetch again?" is answerable by looking at the token.
function fakeTokenEndpoint({ expiresIn = THIRTY_DAYS_S } = {}) {
  const calls = [];
  async function fetchImpl(url, init) {
    calls.push({ url, init, body: String(init?.body ?? '') });
    return {
      ok: true,
      status: 200,
      async json() {
        return { access_token: `tok-${calls.length}`, token_type: 'Bearer', expires_in: expiresIn };
      },
    };
  }
  return { fetchImpl, calls };
}

// Linear refuses an expired/absent token with HTTP 401 and a GraphQL
// authentication error. The controller's own client attaches `status` and
// `body` to the thrown error (see graph/controller/token.mjs), and that is what
// isAuthRefusal reads.
function expiredTokenRefusal() {
  const error = new Error('Linear API error: 401 {"errors":[{"message":"Authentication required, but not passed"}]}');
  error.status = 401;
  error.body = {
    errors: [{
      message: 'Authentication required, but not passed',
      extensions: { type: 'authentication', code: 'AUTHENTICATION_ERROR', userError: true },
    }],
  };
  return error;
}

test('the credentials are read at run time, in-process, from the two drop-box fields -- never at import', () => {
  const reads = [];
  const creds = readAppCredentials({
    readSecretImpl: (field) => {
      reads.push(field);
      return `value-of-${field}`;
    },
  });
  assert.deepEqual(reads, [APP_CLIENT_ID_FIELD, APP_CLIENT_SECRET_FIELD]);
  assert.equal(APP_CLIENT_ID_FIELD, 'linear-app-id');
  assert.equal(APP_CLIENT_SECRET_FIELD, 'linear-app-secret');
  assert.deepEqual(creds, { clientId: 'value-of-linear-app-id', clientSecret: 'value-of-linear-app-secret' });
});

test('creating the provider reads no credential: a process that cannot read them only fails when it actually calls', async () => {
  let reads = 0;
  const { fetchImpl } = fakeTokenEndpoint();
  const provider = createAppTokenProvider({
    readCredentials: () => {
      reads += 1;
      throw new Error('EACCES: permission denied, open \'/etc/orca-runner/dropbox-secrets/linear-app-id.env\'');
    },
    fetchImpl,
    now: () => 0,
  });
  assert.equal(reads, 0, 'constructing the provider must not touch the drop box');
  await assert.rejects(() => provider.getToken(), /EACCES/);
  assert.equal(reads, 1, 'the credentials are read only when a token is actually fetched');
});

test('the first call fetches a client-credentials token from the app id and secret, and caches it', async () => {
  const { fetchImpl, calls } = fakeTokenEndpoint();
  const provider = createAppTokenProvider({
    readCredentials: () => ({ clientId: 'the-id', clientSecret: 'the-secret' }),
    fetchImpl,
    now: () => 1_000,
  });

  assert.equal(await provider.getToken(), 'tok-1');
  assert.equal(await provider.getToken(), 'tok-1', 'a cached, unexpired token is reused');
  assert.equal(calls.length, 1);

  const [call] = calls;
  assert.equal(call.url, LINEAR_OAUTH_TOKEN_URL);
  assert.equal(call.init.method, 'POST');
  const sent = new URLSearchParams(call.body);
  assert.equal(sent.get('grant_type'), 'client_credentials');
  assert.equal(sent.get('client_id'), 'the-id');
  assert.equal(sent.get('client_secret'), 'the-secret');
  assert.equal(sent.get('scope'), APP_TOKEN_SCOPE);
  assert.equal(sent.get('actor'), 'app', 'the token must act as the app, not as a person');
  assert.equal(provider.expiresAtMs(), 1_000 + THIRTY_DAYS_S * 1_000);
});

test('the token is renewed BEFORE it expires, not after -- a 30-day token is replaced inside the safety window', async () => {
  const { fetchImpl, calls } = fakeTokenEndpoint();
  let clock = 0;
  const provider = createAppTokenProvider({
    readCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
    fetchImpl,
    now: () => clock,
  });

  assert.equal(await provider.getToken(), 'tok-1');
  const expiresAt = provider.expiresAtMs();

  // One millisecond before the safety window opens: still the same token.
  clock = expiresAt - RENEW_BEFORE_MS - 1;
  assert.equal(await provider.getToken(), 'tok-1');
  assert.equal(calls.length, 1);

  // Inside the window, and still a day short of the real expiry: renewed.
  clock = expiresAt - RENEW_BEFORE_MS;
  assert.equal(await provider.getToken(), 'tok-2', 'the controller must not wait for the token to actually expire');
  assert.equal(calls.length, 2);
  assert.ok(clock < expiresAt, 'renewal happened while the old token was still valid');
});

test('a refused call fetches a new token and retries EXACTLY ONCE -- the retry succeeds and nothing loops', async () => {
  const { fetchImpl, calls: tokenCalls } = fakeTokenEndpoint();
  const provider = createAppTokenProvider({
    readCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
    fetchImpl,
    now: () => 0,
  });

  // The stand-in refuses `tok-1` the way Linear refuses an expired token, and
  // accepts anything newer.
  const attempts = [];
  const call = async (token, body) => {
    attempts.push(token);
    if (token === 'tok-1') throw expiredTokenRefusal();
    return { ok: true, body };
  };

  const authed = createAuthedLinearCall({ tokenProvider: provider, call });
  const result = await authed('a column-move comment');

  assert.deepEqual(result, { ok: true, body: 'a column-move comment' });
  assert.deepEqual(attempts, ['tok-1', 'tok-2'], 'one refusal, one renewal, one retry');
  assert.equal(tokenCalls.length, 2, 'exactly one extra token fetch');
});

test('a second refusal is raised, not retried again: the renewal loop is bounded at one', async () => {
  const { fetchImpl, calls: tokenCalls } = fakeTokenEndpoint();
  const provider = createAppTokenProvider({
    readCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
    fetchImpl,
    now: () => 0,
  });

  // A stand-in that refuses EVERY token: a retry-on-refusal that is not bounded
  // would spin here forever.
  const attempts = [];
  const call = async (token) => {
    attempts.push(token);
    throw expiredTokenRefusal();
  };

  const authed = createAuthedLinearCall({ tokenProvider: provider, call });
  await assert.rejects(() => authed(), (error) => {
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(attempts.length, 2, 'the call is made twice and no more');
  assert.equal(tokenCalls.length, 2, 'and the token is fetched twice and no more');
});

test('a failure that is not an authentication refusal is raised untouched -- no token is burned on it', async () => {
  const { fetchImpl, calls: tokenCalls } = fakeTokenEndpoint();
  const provider = createAppTokenProvider({
    readCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
    fetchImpl,
    now: () => 0,
  });

  const rateLimited = new Error('Linear API error: 429 {"errors":[{"message":"Rate limit exceeded"}]}');
  rateLimited.status = 429;
  rateLimited.body = { errors: [{ message: 'Rate limit exceeded' }] };

  let attempts = 0;
  const authed = createAuthedLinearCall({
    tokenProvider: provider,
    call: async () => { attempts += 1; throw rateLimited; },
  });

  await assert.rejects(() => authed(), /429/);
  assert.equal(attempts, 1, 'a 429 is not an expired token and must not be retried here');
  assert.equal(tokenCalls.length, 1, 'and must not renew the token');
});

test('isAuthRefusal recognises Linear\'s expired-token shape and nothing else', () => {
  assert.equal(isAuthRefusal(expiredTokenRefusal()), true);

  const codeOnly = new Error('authentication');
  codeOnly.body = { errors: [{ extensions: { code: 'AUTHENTICATION_ERROR' } }] };
  assert.equal(isAuthRefusal(codeOnly), true, 'the GraphQL authentication code alone is enough');

  const forbidden = new Error('forbidden');
  forbidden.status = 403;
  assert.equal(isAuthRefusal(forbidden), false, '403 is a scope problem, not an expired token');

  const notFound = new Error('not found');
  notFound.status = 404;
  assert.equal(isAuthRefusal(notFound), false);
  assert.equal(isAuthRefusal(null), false);
  assert.equal(isAuthRefusal(new Error('network down')), false);
});

test('a token endpoint that refuses the app credentials fails loudly and caches nothing', async () => {
  let attempt = 0;
  const provider = createAppTokenProvider({
    readCredentials: () => ({ clientId: 'id', clientSecret: 'wrong' }),
    fetchImpl: async () => {
      attempt += 1;
      return { ok: false, status: 400, async json() { return { error: 'invalid_client' }; } };
    },
    now: () => 0,
  });
  await assert.rejects(() => provider.getToken(), /400/);
  assert.equal(provider.expiresAtMs(), null, 'a failed fetch must not leave a half-token cached');
  await assert.rejects(() => provider.getToken(), /400/);
  assert.equal(attempt, 2, 'and the next call tries again rather than serving a stale token');
});

test('neither the client secret nor the token is ever put in an error message', async () => {
  const provider = createAppTokenProvider({
    readCredentials: () => ({ clientId: 'the-id', clientSecret: 'SUPER-SECRET-VALUE' }),
    fetchImpl: async () => ({ ok: false, status: 401, async json() { return { error: 'invalid_client' }; } }),
    now: () => 0,
  });
  await assert.rejects(() => provider.getToken(), (error) => {
    assert.doesNotMatch(error.message, /SUPER-SECRET-VALUE/);
    return true;
  });
});
