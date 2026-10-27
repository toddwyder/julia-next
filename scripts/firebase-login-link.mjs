#!/usr/bin/env node
// A Google sign-in link for the Firebase CLI that keeps working after it is sent.
//
// `firebase login` has two flows. The remote one posts to auth.firebase.tools for an
// `attest` token and puts that token in the link (lib/auth.js:347-350), so the link
// lives only as long as the token does and answers "invalid_request: Unable to verify
// client" once it lapses. The localhost one builds a plain Google URL with no token of
// its own (lib/auth.js:205-215) but only works when a browser can reach this machine.
//
// This prints the second kind of link and finishes the login from a pasted code, so a
// link can sit in a ticket until somebody gets to it.
import { clientId, clientSecret, authOrigin } from 'firebase-tools/lib/api.js';
import scopes from 'firebase-tools/lib/scopes.js';
import auth from 'firebase-tools/lib/auth.js';

export const SCOPES = [
  scopes.EMAIL,
  scopes.OPENID,
  scopes.CLOUD_PROJECTS_READONLY,
  scopes.FIREBASE_PLATFORM,
  scopes.CLOUD_PLATFORM,
];

export const CALLBACK = 'http://localhost:9005';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export function loginUrl({ callback = CALLBACK, client = clientId() } = {}) {
  const params = new URLSearchParams({
    client_id: client,
    scope: SCOPES.join(' '),
    response_type: 'code',
    state: 'julia-next',
    redirect_uri: callback,
    access_type: 'offline',
    prompt: 'select_account consent',
  });
  return `${authOrigin()}/o/oauth2/auth?${params.toString()}`;
}

export function readTokenAnswer(status, answer) {
  if (status !== 200) {
    const said = [answer?.error, answer?.error_description].filter(Boolean).join(', ');
    throw new Error(`Google refused the code with ${status}: ${said || 'no reason given'}`);
  }
  if (!answer.refresh_token) {
    throw new Error('Google returned no refresh token, so the CLI would forget this login. Approve the link again.');
  }
  const claims = JSON.parse(Buffer.from(String(answer.id_token).split('.')[1], 'base64url').toString('utf8'));
  return { email: claims.email, userId: claims.sub, refresh: answer.refresh_token };
}

export async function exchange(code, send = fetch) {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: CALLBACK,
    grant_type: 'authorization_code',
  });
  const res = await send(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const answer = await res.json();
  return readTokenAnswer(res.status, answer);
}

export function codeFromPaste(pasted) {
  const text = String(pasted || '').trim();
  if (!text) throw new Error('No code given.');
  if (!text.includes('code=')) return text;
  return new URL(text.startsWith('http') ? text : `http://localhost:9005/?${text.replace(/^[^?]*\?/, '')}`).searchParams.get('code');
}

async function main(argv) {
  const flag = argv.indexOf('--code');
  if (flag < 0) {
    process.stdout.write(`${loginUrl()}\n`);
    return;
  }
  const code = codeFromPaste(argv[flag + 1]);
  const { email, refresh } = await exchange(code);
  auth.recordCredentials({ user: { email }, tokens: { refresh_token: refresh }, scopes: SCOPES });
  process.stdout.write(`logged in as ${email}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
