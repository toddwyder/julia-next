// One approved Google login is enough for the CLI to keep working on its own:
// it stores a refresh token, and this turns that into the access tokens the
// Firebase and Google APIs want. Nothing here needs Todd at the keyboard twice.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clientId, clientSecret } from 'firebase-tools/lib/api.js';

const CONFIGSTORE = join(homedir(), '.config', 'configstore', 'firebase-tools.json');

const NO_SESSION = 'No Firebase CLI session on this machine. Run `npx firebase login --non-interactive`, approve the link on any device, then `npx firebase login <code>`.';

export function cliSession(path = CONFIGSTORE) {
  let stored;
  try {
    stored = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(NO_SESSION);
  }
  const refresh = stored.tokens?.refresh_token;
  if (!refresh) throw new Error(NO_SESSION);
  return { email: stored.user?.email ?? '', refresh };
}

export async function accessToken({ fetchImpl = fetch, path } = {}) {
  const session = cliSession(path);
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: session.refresh,
    grant_type: 'refresh_token',
  });
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const answer = await response.json().catch(() => ({}));
  if (!answer.access_token) {
    throw new Error(`Google refused the CLI session (${response.status}). Run \`npx firebase login\` again.`);
  }
  return answer.access_token;
}
