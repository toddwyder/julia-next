import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { findSdkPath, readConfig } from './sweep.mjs';
import { ProblemError, readAccountStatus } from '../lib/usage.js';

// Both subscription accounts are read through the SDK's own credential store, so the dashboard
// never parses auth.json itself and never decides a token is expired that Mastra would refresh.
async function oauthCredential(env, provider, authFile) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const authPath = join(dirname(findSdkPath(env)), 'auth', 'index.js');
      const { AuthStorage } = await import(pathToFileURL(authPath).href);
      const credential = await new AuthStorage(authFile).getOAuthCredential(provider);
      const access = typeof credential === 'string' ? credential : credential?.access;
      if (!access) throw new ProblemError('no-credential');
      return { access, accountId: typeof credential === 'string' ? undefined : credential.accountId };
    } catch (error) {
      if (error instanceof ProblemError && error.problem === 'no-credential') throw error;
      if (attempt === 1) throw new ProblemError('sign-in-expired');
      await wait(150);
    }
  }
}

function accountIdFromToken(access) {
  try {
    return JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString('utf8'))
      ['https://api.openai.com/auth']?.chatgpt_account_id;
  } catch { return undefined; }
}

async function chatgptHeaders(env, authFile) {
  const { access, accountId: stored } = await oauthCredential(env, 'openai-codex', authFile);
  const accountId = stored ?? accountIdFromToken(access);
  if (!accountId) throw new ProblemError('sign-in-expired');
  return { authorization: `Bearer ${access}`, 'chatgpt-account-id': accountId,
    origin: 'https://chatgpt.com', 'user-agent': 'julia-dashboard-sweep' };
}

export async function readStatus({ env = process.env, fetchImpl = fetch, now = () => new Date(), authFile } = {}) {
  const { accounts } = readConfig('accounts.json');
  const readAt = now().toISOString();
  const getHeaders = async id => {
    if (id === 'claude') {
      const { access } = await oauthCredential(env, 'anthropic', authFile);
      return { authorization: `Bearer ${access}`, 'anthropic-beta': 'oauth-2025-04-20', 'user-agent': 'julia-dashboard-sweep' };
    }
    if (id === 'chatgpt') return chatgptHeaders(env, authFile);
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
