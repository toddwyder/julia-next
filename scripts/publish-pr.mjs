#!/usr/bin/env node
// publish-pr.mjs -- the coordinator's branch-push and PR-open actions
// (SKILL.md's BRANCH_PUSH / PR_OPEN publisher effects), so a worker's
// verified local commit can reach GitHub without a personal git push.
//
// The installation token never appears in argv, in a temp file's content,
// or in this module's return values/errors -- it travels from
// getPublisherInstallationToken into git's own credential prompt only via
// a named environment variable (JULIA_PUBLISHER_ASKPASS_TOKEN) that a tiny
// GIT_ASKPASS helper script reads at run time. The helper script itself
// contains no secret, just a reference to that env var name, so writing it
// to a temp file is safe even though the file is plain text on disk.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPublisherInstallationToken } from './publish-via-github-app.mjs';

const execFileAsync = promisify(execFile);
const APPROVED_TARGETS = new Set(['toddwyder/julia-next', 'toddwyder/Julia', 'toddwyder/AI-Stack']);

function assertApproved(owner, repo) {
  if (!APPROVED_TARGETS.has(`${owner}/${repo}`)) {
    throw new Error(`${owner}/${repo} is not an approved publisher target`);
  }
}

export function defaultWriteAskpass() {
  const dir = mkdtempSync(join(tmpdir(), 'julia-publisher-askpass-'));
  const scriptPath = join(dir, 'askpass.sh');
  writeFileSync(scriptPath, '#!/bin/sh\necho "$JULIA_PUBLISHER_ASKPASS_TOKEN"\n', { mode: 0o700 });
  chmodSync(scriptPath, 0o700);
  return scriptPath;
}

export async function pushBranch({
  owner,
  repo,
  branch,
  cwd,
  env = process.env,
  tokenImpl = getPublisherInstallationToken,
  execImpl = execFileAsync,
  writeAskpass = defaultWriteAskpass,
}) {
  assertApproved(owner, repo);
  const token = await tokenImpl({ ...env, JULIA_PUBLISHER_OWNER: owner, JULIA_PUBLISHER_REPO: repo });
  const askpassPath = writeAskpass();
  try {
    await execImpl('git', [
      'push',
      `https://x-access-token@github.com/${owner}/${repo}.git`,
      `HEAD:refs/heads/${branch}`,
    ], {
      cwd,
      env: {
        ...env,
        GIT_ASKPASS: askpassPath,
        GIT_TERMINAL_PROMPT: '0',
        JULIA_PUBLISHER_ASKPASS_TOKEN: token,
      },
    });
  } catch (error) {
    throw new Error(`git push failed: ${String(error.stderr || error.message || '').trim()}`);
  } finally {
    try { rmSync(askpassPath, { force: true }); } catch { /* best-effort cleanup */ }
  }
  return { pushed: true, branch };
}

export async function openPullRequest({
  owner,
  repo,
  head,
  base,
  title,
  body,
  env = process.env,
  fetchImpl = fetch,
  tokenImpl = getPublisherInstallationToken,
}) {
  assertApproved(owner, repo);
  const token = await tokenImpl({ ...env, JULIA_PUBLISHER_OWNER: owner, JULIA_PUBLISHER_REPO: repo });
  const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ head, base, title, body }),
  });
  const parsed = await res.json();
  if (!res.ok) {
    throw new Error(`open PR failed (HTTP ${res.status}): ${parsed.message ?? JSON.stringify(parsed)}`);
  }
  return { url: parsed.html_url, number: parsed.number };
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
  const [action, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    if (action === 'push') {
      const [owner, repo] = args.repo.split('/');
      const result = await pushBranch({ owner, repo, branch: args.branch, cwd: args.cwd || process.cwd() });
      console.log(JSON.stringify(result));
    } else if (action === 'open') {
      const [owner, repo] = args.repo.split('/');
      const result = await openPullRequest({
        owner, repo, head: args.head, base: args.base || 'main', title: args.title, body: args.body || '',
      });
      console.log(JSON.stringify(result));
    } else {
      console.error('usage: node publish-pr.mjs push --repo <owner/name> --branch <name> [--cwd <path>]');
      console.error('       node publish-pr.mjs open --repo <owner/name> --head <branch> --base <branch> --title <text> --body <text>');
      process.exitCode = 2;
      return;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
