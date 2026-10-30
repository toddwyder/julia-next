import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { findSdkPath, readConfig } from './sweep.mjs';
import { ProblemError, readAccountStatus } from '../lib/usage.js';

async function anthropicHeaders(env) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const authPath = join(dirname(findSdkPath(env)), 'auth', 'index.js');
      const { AuthStorage } = await import(pathToFileURL(authPath).href);
      const credential = await new AuthStorage().getOAuthCredential('anthropic');
      const access = typeof credential === 'string' ? credential : credential?.access;
      if (!access) throw new ProblemError('no-credential');
      return { authorization: `Bearer ${access}`, 'anthropic-beta': 'oauth-2025-04-20', 'user-agent': 'julia-dashboard-sweep' };
    } catch (error) {
      if (error instanceof ProblemError && error.problem === 'no-credential') throw error;
      if (attempt === 1) throw new ProblemError('sign-in-expired');
      await wait(150);
    }
  }
}

function chatgptHeaders(env, authFile, now) {
  let auth;
  try {
    auth = JSON.parse(readFileSync(authFile ?? join(env.MASTRACODE_APP_DATA_DIR
      ?? join(homedir(), '.local', 'share', 'mastracode'), 'auth.json'), 'utf8'));
  } catch { throw new ProblemError('no-credential'); }
  const credential = auth['openai-codex'] ?? Object.entries(auth)
    .find(([key, entry]) => key.startsWith('accounts:openai-codex:') && entry?.active)?.[1];
  if (!credential?.access) throw new ProblemError('no-credential');
  if (!Number.isFinite(credential.expires) || credential.expires <= now().getTime()) throw new ProblemError('sign-in-expired');
  let accountId = credential.accountId;
  if (!accountId) {
    try {
      const claims = JSON.parse(Buffer.from(credential.access.split('.')[1], 'base64url').toString('utf8'));
      accountId = claims['https://api.openai.com/auth']?.chatgpt_account_id;
    } catch { throw new ProblemError('sign-in-expired'); }
  }
  if (!accountId) throw new ProblemError('sign-in-expired');
  return { authorization: `Bearer ${credential.access}`, 'chatgpt-account-id': accountId,
    origin: 'https://chatgpt.com', 'user-agent': 'julia-dashboard-sweep' };
}

export async function readStatus({ env = process.env, fetchImpl = fetch, now = () => new Date(), authFile } = {}) {
  const { accounts } = readConfig('accounts.json');
  const readAt = now().toISOString();
  const getHeaders = async id => {
    if (id === 'claude') return anthropicHeaders(env);
    if (id === 'chatgpt') return chatgptHeaders(env, authFile, now);
    if (!env.COMMANDCODE_API_KEY) throw new ProblemError('no-credential');
    return { authorization: `Bearer ${env.COMMANDCODE_API_KEY}` };
  };
  return { readAt, accounts: await readAccountStatus({ accounts, getHeaders, fetchImpl, now }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await readStatus())); }
  catch {
    console.log(JSON.stringify({ error: 'Account status could not be read.' }));
    process.exitCode = 1;
  }
}
