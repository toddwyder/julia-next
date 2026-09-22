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
import {
  writeFileSync, mkdtempSync, chmodSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPublisherInstallationToken, loadPublisherCredentialFile } from './publish-via-github-app.mjs';

// A fresh Codex review of PR #3 (2026-09-16) found that spreading the
// caller's full environment into the git subprocess handed the App's own
// signing credentials to any repo hook or credential helper that process
// runs, and that an unredacted git stderr could echo one straight back
// into this script's own thrown error. gitEnv() below builds the
// subprocess environment explicitly instead of spreading -- only what git
// itself needs, plus the one-time push token via a named var the askpass
// helper reads, and never JULIA_PUBLISHER_APP_ID/_PRIVATE_KEY.
const PASSTHROUGH_ENV_KEYS = ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH'];

function gitEnv(callerEnv, { askpassPath, token, emptyGlobalConfigPath }) {
  const minimal = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    if (callerEnv[key] !== undefined) minimal[key] = callerEnv[key];
  }
  return {
    ...minimal,
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: '0',
    // Neutralize system/global git config layers so an ambient
    // credential.helper or url.insteadOf rewrite can't apply to this push
    // (-c credential.helper= below additionally overrides any repo-local
    // helper for this one invocation). A malicious url.insteadOf rewrite
    // committed to this repo's own local .git/config is a residual risk
    // this does not cover -- not reproduced or ruled out here.
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyGlobalConfigPath,
    JULIA_PUBLISHER_ASKPASS_TOKEN: token,
  };
}

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

// A fix-verification review of the first fix (2026-09-16) demonstrated
// that disabling hooks/credential-helpers/system/global config is not
// enough: a url.*.insteadOf rewrite in the repo's own LOCAL .git/config
// can still redirect the push -- either to a custom remote-helper scheme
// (git then executes whatever git-remote-<scheme> it finds on PATH,
// handing it the token) or directly to a different https:// host (which
// then receives the token as Basic auth). Neither -c credential.helper=
// nor -c core.hooksPath= touches insteadOf resolution, and an unknown
// attacker-chosen rewrite key can't be unset via -c. So: refuse to push
// at all if the repo defines any url.*.insteadOf rewrite, rather than try
// to neutralize a mechanism with no enumerable "off" switch.
async function assertNoUrlRewrites({
  cwd, env, askpassPath, emptyGlobalConfigPath, execImpl,
}) {
  try {
    await execImpl('git', ['-c', `safe.directory=${cwd}`, 'config', '--get-regexp', '^url\\..*\\.insteadof$'], {
      cwd,
      env: gitEnv(env, { askpassPath, token: '', emptyGlobalConfigPath }),
    });
  } catch (error) {
    // git's own exit behavior: exit 1 with no output means nothing
    // matched -- the safe, expected case for `git config --get-regexp`.
    if (error.code === 1) return;
    throw new Error('could not verify this repo has no url.*.insteadOf rewrites -- refusing to push for safety');
  }
  throw new Error(`${cwd} defines a url.*.insteadOf rewrite in its local git config -- refusing to push (it could redirect the push and expose the installation token)`);
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
  const askpassPathForCheck = writeAskpass();
  const emptyGlobalConfigPathForCheck = join(mkdtempSync(join(tmpdir(), 'julia-publisher-gitconfig-')), 'empty.gitconfig');
  try {
    await assertNoUrlRewrites({
      cwd, env, askpassPath: askpassPathForCheck, emptyGlobalConfigPath: emptyGlobalConfigPathForCheck, execImpl,
    });
  } finally {
    // File-level cleanup only, deliberately: the directory these live in
    // came from mkdtempSync in the real implementation, but a caller
    // (including this module's own tests) can inject any path via
    // writeAskpass -- recursively removing that path's parent directory
    // would be unsafe for an arbitrary injected path (e.g. a fixed test
    // path under a shared temp root). The empty leftover mkdtemp
    // directory this accepts is disclosed, minor housekeeping, not a
    // credential or correctness issue.
    try { rmSync(askpassPathForCheck, { force: true }); } catch { /* best-effort cleanup */ }
    try { rmSync(emptyGlobalConfigPathForCheck, { force: true }); } catch { /* best-effort cleanup */ }
  }
  const token = await tokenImpl({ ...env, JULIA_PUBLISHER_OWNER: owner, JULIA_PUBLISHER_REPO: repo });
  const askpassPath = writeAskpass();
  const emptyHooksDir = mkdtempSync(join(tmpdir(), 'julia-publisher-hooks-'));
  const emptyGlobalConfigPath = join(mkdtempSync(join(tmpdir(), 'julia-publisher-gitconfig-')), 'empty.gitconfig');
  try {
    // JUL-71: the publisher runs as orchestrator-svc, but a coordinator's
    // worker commits live in runner-owned worktrees (by design -- see the
    // role table in docs/agents/jul43-coordinator-runbook.md). Git's own
    // dubious-ownership guard then refuses to operate in `cwd` at all
    // ("detected dubious ownership in repository at ..."), confirmed live
    // this session -- this was the runbook's own disclosed, unverified gap
    // ("not yet verified that orchestrator-svc can read into a
    // runner-owned worktree path"). A `-c safe.directory=<cwd>` scoped to
    // exactly the cwd this trusted caller already passed in is not a new
    // attack surface: it doesn't come from repo-local config (which a
    // pushed commit could otherwise poison) and it says nothing about
    // credentials or remotes, only "trust this exact path's ownership" --
    // orthogonal to the url.*.insteadOf/credential.helper protections
    // above, which are about redirecting the push, not about whose UID
    // owns the working tree.
    await execImpl('git', [
      '-c', 'credential.helper=',
      '-c', `core.hooksPath=${emptyHooksDir}`,
      '-c', `safe.directory=${cwd}`,
      'push',
      `https://x-access-token@github.com/${owner}/${repo}.git`,
      `HEAD:refs/heads/${branch}`,
    ], {
      cwd,
      env: gitEnv(env, { askpassPath, token, emptyGlobalConfigPath }),
    });
  } catch {
    // Deliberately not including the underlying error's stderr/message: a
    // hook running inside the git subprocess could have printed a
    // credential to it (JUL-43 PR #3 review, finding S1). Check the
    // repo's own git state (git status, git log) to diagnose a real push
    // failure instead.
    throw new Error(`git push to ${owner}/${repo} failed -- see repo state, not this message, for detail (credential-safe by design)`);
  } finally {
    try { rmSync(askpassPath, { force: true }); } catch { /* best-effort cleanup */ }
    try { rmSync(emptyHooksDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    try { rmSync(emptyGlobalConfigPath, { force: true }); } catch { /* best-effort cleanup */ }
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
  // JUL-98 step 6 round 3 (13:0xZ): a coordinator session called this
  // script without the CLI grant's documented --env-file prefix, so
  // JULIA_PUBLISHER_APP_ID/_PRIVATE_KEY were simply unset. Loading the
  // well-known credential file here -- before anything else runs, and
  // only when the caller hasn't already set the vars -- means a session
  // that forgets the flag still works, not just one that remembers it.
  loadPublisherCredentialFile();
  main();
}
