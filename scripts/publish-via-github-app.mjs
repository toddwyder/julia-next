#!/usr/bin/env node
// publish-via-github-app.mjs -- reused verbatim (logic unchanged) from
// toddwyder/Julia's scripts/publish-via-github-app.mjs (Round B1), the
// existing, already-tested mechanism for minting a short-lived
// julia-graph-publisher installation token locally (Orca runs on Todd's
// machine / the runner, not GitHub Actions, so the actions/create-github-
// app-token action AI-Stack's own CI uses isn't available here).
//
// This is why the julia-coordinator skill never needs a long-lived
// JULIA_NEXT_GRAPH_WRITE_TOKEN placed anywhere: it mints a fresh ~1-hour
// installation token from JULIA_PUBLISHER_APP_ID/JULIA_PUBLISHER_APP_PRIVATE_KEY
// at the start of every publish instead. Only the App's own credentials need
// to live on the runner, not a token that would go stale between runs.
//
// JULIA_PUBLISHER_REPO defaults to 'Julia' (this script's origin repo);
// julia-next's caller sets it to 'julia-next' explicitly.
import { createSign } from 'node:crypto';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function mintAppJwt(appId, privateKeyPem, { now = () => Math.floor(Date.now() / 1000), signRs256 } = {}) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const issuedAt = now();
  const payload = base64url(JSON.stringify({ iat: issuedAt - 60, exp: issuedAt + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const sign = signRs256 ?? ((data, key) => {
    const signer = createSign('RSA-SHA256');
    signer.update(data);
    return base64url(signer.sign(key));
  });
  return `${unsigned}.${sign(unsigned, privateKeyPem)}`;
}

/** @param {Record<string, string | undefined>} env */
export async function getPublisherInstallationToken(env = process.env, fetchImpl = fetch, opts = {}) {
  const appId = env.JULIA_PUBLISHER_APP_ID;
  const privateKey = env.JULIA_PUBLISHER_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    throw new Error(
      'JULIA_PUBLISHER_APP_ID / JULIA_PUBLISHER_APP_PRIVATE_KEY are not set -- publishing must go through the julia-graph-publisher GitHub App, not a personal or worker token.',
    );
  }

  const jwt = mintAppJwt(appId, privateKey, opts);
  const owner = env.JULIA_PUBLISHER_OWNER ?? 'toddwyder';
  const repo = env.JULIA_PUBLISHER_REPO ?? 'Julia';

  const installationRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
  });
  if (!installationRes.ok) {
    throw new Error(`julia-graph-publisher is not installed on ${owner}/${repo} (HTTP ${installationRes.status})`);
  }
  const installation = await installationRes.json();

  const tokenRes = await fetchImpl(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
  });
  if (!tokenRes.ok) {
    throw new Error(`Failed to mint a julia-graph-publisher installation token (HTTP ${tokenRes.status})`);
  }
  const { token } = await tokenRes.json();
  return token;
}

export { mintAppJwt, base64url };
