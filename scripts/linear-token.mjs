// No long-lived Linear key lives on this machine: a run trades the app's client
// pair for an access token at the start, so a revoked or leaked key cannot
// outlive the run that used it.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const TOKEN_URL = 'https://api.linear.app/oauth/token';
export const DEFAULT_SCOPE = 'read,write,issues:create,comments:create';

export function authorizationHeader(token) {
  return token ? `Bearer ${token}` : '';
}

export async function requestToken({ clientId, clientSecret, scope = DEFAULT_SCOPE, fetchImpl = fetch, url = TOKEN_URL } = {}) {
  if (!clientId) throw new Error('Linear token needs LINEAR_CLIENT_ID, which is not set.');
  if (!clientSecret) throw new Error('Linear token needs LINEAR_CLIENT_SECRET, which is not set.');
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope }).toString(),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error('Linear refused the client credentials grant: the reply was not JSON.');
  }
  if (typeof body?.access_token === 'string' && body.access_token) return body.access_token;
  // The secret travels in the request body; a reply that echoes it back must
  // never end up in a message a caller prints.
  const message = `Linear refused the client credentials grant: ${body?.error ?? 'no error code'}: ${body?.error_description ?? 'no description'}`;
  throw new Error(message.replaceAll(clientSecret, '[redacted]'));
}

export async function runWithFreshToken(argv, { env = process.env, fetchImpl = fetch, spawn = spawnSync } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(argument => typeof argument !== 'string' || !argument)) {
    throw new Error('runWithFreshToken needs a command to run.');
  }
  const clientId = env.LINEAR_CLIENT_ID;
  const clientSecret = env.LINEAR_CLIENT_SECRET;
  const token = await requestToken({ clientId, clientSecret, scope: env.LINEAR_OAUTH_SCOPE || DEFAULT_SCOPE, fetchImpl });
  const childEnv = { ...env, LINEAR_API_KEY: authorizationHeader(token) };
  // The command never needs the secret, and a reviewer once republished a
  // credential it found in its environment.
  delete childEnv.LINEAR_CLIENT_SECRET;
  const child = spawn(argv[0], argv.slice(1), { env: childEnv, stdio: 'inherit' });
  if (child.error) throw child.error;
  return child.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  try {
    process.exitCode = await runWithFreshToken(args);
  } catch (error) {
    console.error(`Linear token unavailable: ${error.message}`);
    process.exitCode = 1;
  }
}
