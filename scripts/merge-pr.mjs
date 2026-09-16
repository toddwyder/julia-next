#!/usr/bin/env node
// merge-pr.mjs -- the coordinator's one merge action. Mints a short-lived
// julia-graph-publisher installation token (scripts/publish-via-github-app.mjs)
// and calls GitHub's merge API directly -- no local git push, no working
// copy of the PR branch needed here, since pull_requests:write already
// covers merging a PR whose commits are already on GitHub.
//
// The installation token is never included in this module's return value,
// a thrown error's message, or anything main() prints -- only the merge
// API's own {merged, sha, message} response.
import { getPublisherInstallationToken } from './publish-via-github-app.mjs';

// Fixed allow-list, not a caller-supplied value -- this script exists so a
// Bash permission rule can name it once instead of granting an open-ended
// "call any GitHub API with the publisher token" capability.
const APPROVED_TARGETS = new Set(['toddwyder/julia-next', 'toddwyder/Julia', 'toddwyder/AI-Stack']);

export async function mergePullRequest({
  owner,
  repo,
  number,
  mergeMethod = 'squash',
  env = process.env,
  fetchImpl = fetch,
  tokenImpl = getPublisherInstallationToken,
}) {
  if (!APPROVED_TARGETS.has(`${owner}/${repo}`)) {
    throw new Error(`${owner}/${repo} is not an approved publisher target`);
  }
  if (!Number.isInteger(Number(number)) || Number(number) <= 0 || String(Number(number)) !== String(number).trim()) {
    throw new Error(`number must be a positive integer, got ${JSON.stringify(number)}`);
  }

  const token = await tokenImpl({ ...env, JULIA_PUBLISHER_OWNER: owner, JULIA_PUBLISHER_REPO: repo });

  const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ merge_method: mergeMethod }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`merge failed (HTTP ${res.status}): ${body.message ?? JSON.stringify(body)}`);
  }
  return { merged: body.merged, sha: body.sha, message: body.message };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

async function main() {
  const { repo, number } = parseArgs(process.argv.slice(2));
  if (!repo || !number) {
    console.error('usage: node merge-pr.mjs --repo <owner/name> --number <pr-number>');
    process.exitCode = 2;
    return;
  }
  const [owner, name] = repo.split('/');
  try {
    const result = await mergePullRequest({ owner, repo: name, number: Number(number) });
    console.log(JSON.stringify(result));
    process.exitCode = result.merged ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
