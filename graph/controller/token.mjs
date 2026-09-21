// token.mjs -- JUL-98 step 2, item 1: the controller's own Linear identity and
// the renewal of its token.
//
// The controller writes to the board as the Linear OAuth app "Julia controller"
// (created 2026-09-21 12:07Z, proven 12:20Z: a client-credentials token, status
// 200, `Bearer`, 30-day life, scopes `comments:create read write`, identity read
// back as an app rather than an admin). Its client id and secret live in the
// drop box under `linear-app-id` and `linear-app-secret`.
//
// THE ACCESS RULE THIS FILE IS SHAPED BY. Those two fields are readable by the
// `orchestrator-svc` account ONLY (ops/service-dropbox/read-secret.mjs
// KNOWN_FIELDS, and the JUL-98 readiness review 12:37Z: "Builders run as
// `runner` and cannot read them, by design"). So:
//
//   * nothing is read at import time -- importing this module from any account
//     is safe;
//   * `readCredentials` is injected, and its real implementation reads the two
//     fields IN-PROCESS via readSecret at the moment a token is fetched, in the
//     process that actually has them. Never through argv, never through a shell
//     string, never logged (ops/service-dropbox/read-secret.mjs's own comment
//     records the JUL-72 incident that rule exists for);
//   * every test injects a fake, so the suite runs as `runner` with no drop box
//     at all.
//
// Renewal has two triggers, and both are required. A 30-day token that is only
// replaced when a call fails would leave the board silent for the length of one
// failed comment; a token that is only replaced on a timer would not survive a
// token revoked early. So: fetch a new one BEFORE expiry (RENEW_BEFORE_MS), AND
// after any refused call -- once, never in a loop.

import { readSecret } from '../../ops/service-dropbox/read-secret.mjs';

// Linear's OAuth 2.0 token endpoint, with the client-credentials grant and
// `actor=app` (so the token acts as the app, not as the admin who created it).
// Source: https://linear.app/developers/oauth-2-0-authentication and
// https://linear.app/developers/agents, both cited in Todd's 2026-09-21 11:23Z
// Decision on JUL-98; the 12:20Z comment on that card is the live proof that
// this grant returns a 30-day `Bearer` token for this app.
export const LINEAR_OAUTH_TOKEN_URL = 'https://api.linear.app/oauth/token';

// The scopes the live token came back with on 2026-09-21 12:20Z. Asking for
// exactly those keeps a renewed token identical in power to the proven one.
export const APP_TOKEN_SCOPE = 'comments:create read write';

// The two drop-box fields, named once. Both are `orchestrator-svc`-only.
export const APP_CLIENT_ID_FIELD = 'linear-app-id';
export const APP_CLIENT_SECRET_FIELD = 'linear-app-secret';

// How long before expiry a token is replaced. One day out of thirty: long
// enough that a controller which only wakes a few times a day still renews
// while the old token is valid, short enough that a renewal is rare.
export const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

// The real credential reader: in-process, at call time, by the process that has
// the files. Kept separate from the provider so the provider needs no knowledge
// of the drop box at all.
export function readAppCredentials({ readSecretImpl = readSecret } = {}) {
  return {
    clientId: readSecretImpl(APP_CLIENT_ID_FIELD),
    clientSecret: readSecretImpl(APP_CLIENT_SECRET_FIELD),
  };
}

// Is this failure Linear refusing the token itself? HTTP 401 is the definitive
// signal; the GraphQL `authentication` error code is accepted as well because a
// GraphQL layer can report an auth failure on a 200. A 403 (scope) or 429 (rate
// limit) is NOT an expired token: renewing on those would burn tokens and hide
// the real fault, so they are deliberately excluded.
export function isAuthRefusal(error) {
  if (!error || typeof error !== 'object') return false;
  if (Number(error.status) === 401) return true;
  const errors = Array.isArray(error.body?.errors) ? error.body.errors : [];
  return errors.some((entry) => {
    const code = String(entry?.extensions?.code ?? '').toUpperCase();
    const type = String(entry?.extensions?.type ?? '').toLowerCase();
    return code === 'AUTHENTICATION_ERROR' || type === 'authentication';
  });
}

// A cache of one token, with the two renewal triggers. `now` is injected so the
// "before expiry" rule is tested against a clock rather than a sleep.
export function createAppTokenProvider({
  readCredentials = readAppCredentials,
  fetchImpl = fetch,
  now = () => Date.now(),
  url = LINEAR_OAUTH_TOKEN_URL,
  scope = APP_TOKEN_SCOPE,
  renewBeforeMs = RENEW_BEFORE_MS,
} = {}) {
  let cached = null; // { token, expiresAtMs }
  let fetchCount = 0;

  async function fetchToken() {
    // Read at run time, in the process that has the files. If this throws
    // (EACCES on the `runner` account, for instance) it throws HERE, at the
    // moment a token was genuinely needed, not at import.
    const { clientId, clientSecret } = readCredentials();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: String(clientId ?? ''),
      client_secret: String(clientSecret ?? ''),
      scope,
      actor: 'app',
    });
    fetchCount += 1;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      // Status only. The request body carries the client secret and the
      // response may echo it; neither goes into an error message.
      const error = new Error(`Linear token request failed: ${res.status}`);
      error.status = res.status;
      // Nothing is cached on a failure: the next call retries rather than
      // serving a token that was never issued.
      cached = null;
      throw error;
    }
    const payload = await res.json();
    const token = payload?.access_token;
    const expiresIn = Number(payload?.expires_in);
    if (!token || !Number.isFinite(expiresIn)) {
      cached = null;
      throw new Error('Linear token request returned no usable access_token/expires_in');
    }
    cached = { token, expiresAtMs: now() + expiresIn * 1000 };
    return cached.token;
  }

  return {
    // The cached token, renewed if it is inside the safety window.
    async getToken() {
      if (!cached || now() >= cached.expiresAtMs - renewBeforeMs) {
        return fetchToken();
      }
      return cached.token;
    },
    // Unconditional renewal: what a refused call triggers.
    async renew() {
      cached = null;
      return fetchToken();
    },
    expiresAtMs() {
      return cached?.expiresAtMs ?? null;
    },
    fetchCount() {
      return fetchCount;
    },
  };
}

// Wrap one Linear call so a refusal renews the token and retries EXACTLY ONCE.
// `call(token, ...args)` is whatever the caller does with a token. The bound
// retry is the point: a stand-in that refuses every token (a revoked app, a
// wrong secret) must make this return an error rather than spin.
export function createAuthedLinearCall({ tokenProvider, call }) {
  return async function authedLinearCall(...args) {
    const token = await tokenProvider.getToken();
    try {
      return await call(token, ...args);
    } catch (error) {
      if (!isAuthRefusal(error)) throw error;
      const renewed = await tokenProvider.renew();
      // One retry. Whatever this throws is raised to the caller unchanged --
      // there is no second renewal and no loop.
      return call(renewed, ...args);
    }
  };
}
