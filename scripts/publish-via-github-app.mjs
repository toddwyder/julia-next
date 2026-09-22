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
// JULIA_PUBLISHER_REPO defaults to 'julia-next' (this repo); set it explicitly
// to publish elsewhere.
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';

// JUL-98 step 6 round 3 (2026-09-22 13:0xZ): a coordinator session ran
// `node scripts/publish-pr.mjs push ...` without the CLI's documented
// `--env-file=/etc/orchestrator-svc/.env.publisher` prefix. That prefix is
// how Node loads the App's credentials into process.env -- omit it and
// JULIA_PUBLISHER_APP_ID/_PRIVATE_KEY are simply unset, which is also
// exactly what the Bash *permission grant* requires verbatim to allow the
// call at all (`julia-run.mjs`'s startOrchestrator allowlist), so the
// command was refused before main() ever ran. This mirrors the same
// morning's absolute-vs-relative-path mismatch on the other granted
// scripts: a session forgetting one exact invocation detail loses the
// whole call, silently from the credential's point of view.
//
// The fix is structural, not "remember the flag next time": publish-pr.mjs
// and merge-pr.mjs now call loadPublisherCredentialFile() themselves,
// before doing anything else, so the credential is present in
// process.env whether or not the invoking command included --env-file.
// An explicit --env-file (or any pre-set env var) still wins -- this only
// fills a gap, never overwrites.
const DEFAULT_PUBLISHER_CREDENTIAL_FILE = '/etc/orchestrator-svc/.env.publisher';

/**
 * Parse a dotenv-style file (`KEY=value` or `KEY="value\nwith\nnewlines"`
 * per line, matching how Node's own `--env-file` parses this file) and
 * copy any `JULIA_PUBLISHER_*` key into `env` that isn't already set
 * there. Never throws: a missing file is exactly the case a dev machine
 * or CI box hits, and existing callers already produce a clear error
 * later when the credential is genuinely absent.
 * @param {string} filePath
 * @param {Record<string, string | undefined>} env
 */
function loadPublisherCredentialFile(filePath = DEFAULT_PUBLISHER_CREDENTIAL_FILE, env = process.env) {
  if (!existsSync(filePath)) return;
  let contents;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  // node:util's parseEnv is the same parser Node's own `--env-file` flag
  // uses, so a value this loader reads is guaranteed to match what an
  // explicit `--env-file=<path>` on the command line would have produced
  // -- including a PEM private key's literal embedded newlines inside a
  // double-quoted value.
  let parsed;
  try {
    parsed = parseEnv(contents);
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith('JULIA_PUBLISHER_')) continue;
    if (env[key] !== undefined) continue; // an explicit --env-file or pre-set var wins
    env[key] = value;
  }
}

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
  const repo = env.JULIA_PUBLISHER_REPO ?? 'julia-next';

  const installationRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
  });
  if (!installationRes.ok) {
    throw new Error(`julia-graph-publisher is not installed on ${owner}/${repo} (HTTP ${installationRes.status})`);
  }
  const installation = await installationRes.json();

  const tokenRes = await fetchImpl(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    // Restrict the minted token to this one repo explicitly -- otherwise
    // it defaults to every repo the App's installation covers, which can
    // be broader than the single repo this call names (PR #3 review,
    // JUL-43 coordinator adaptation).
    body: JSON.stringify({ repositories: [repo] }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Failed to mint a julia-graph-publisher installation token (HTTP ${tokenRes.status})`);
  }
  const { token } = await tokenRes.json();
  return token;
}

export {
  mintAppJwt, base64url, loadPublisherCredentialFile, DEFAULT_PUBLISHER_CREDENTIAL_FILE,
};
