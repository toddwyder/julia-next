import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function runnerConfigDir() {
  return process.env.JULIA_RUNNER_CONFIG_DIR ?? join(homedir(), '.config', 'julia-runner');
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signAppJwt({ appId, privateKeyPem, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const header = base64Url({ alg: 'RS256', typ: 'JWT' });
  const payload = base64Url({ iat: nowSeconds - 60, exp: nowSeconds + 300, iss: String(appId) });
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKeyPem, 'base64url');
  return `${signingInput}.${signature}`;
}

export async function githubApi(path, { token, method = 'GET', body, fetchImpl = fetch } = {}) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'julia-runner',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetchImpl(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message ?? response.statusText;
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${message}`);
  }
  return data;
}

export async function getInstallationToken({ configDir = runnerConfigDir(), fetchImpl = fetch } = {}) {
  const app = JSON.parse(readFileSync(join(configDir, 'app.json'), 'utf8'));
  const privateKeyPem = readFileSync(join(configDir, 'private-key.pem'), 'utf8');
  const jwt = signAppJwt({ appId: app.id, privateKeyPem });

  let installationId;
  const instPath = join(configDir, 'installation.json');
  if (existsSync(instPath)) {
    const saved = JSON.parse(readFileSync(instPath, 'utf8'));
    installationId = saved.id ?? saved.installation_id;
  }
  if (!installationId) {
    const installations = await githubApi('/app/installations', { token: jwt, fetchImpl });
    installationId = installations[0]?.id;
  }
  if (!installationId) throw new Error('No GitHub App installation found for julia-runner.');

  const result = await githubApi(`/app/installations/${installationId}/access_tokens`, {
    token: jwt,
    method: 'POST',
    fetchImpl,
  });
  return result.token;
}
