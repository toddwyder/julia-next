#!/usr/bin/env node
// julia-run.mjs -- JUL-63: one command to start the graph on a ticket.
//
// Run as orchestrator-svc, from inside an Orca terminal on the
// orchestrator-local runtime (a second Orca daemon, running as
// orchestrator-svc -- see the runbook's Bootstrap section for how that
// daemon is set up and why builder/reviewer dispatch stays on the
// separate ovh-local/runner runtime). Prints exactly one line: the run
// id on success, or which step failed and why.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { checkReadiness } from './check-readiness.mjs';
import { runCreate, runList, terminalCreate } from './orca-cli.mjs';
import { getPublisherInstallationToken } from './publish-via-github-app.mjs';

const execFileAsync = promisify(execFile);

const REQUIRED_ACCOUNT = 'orchestrator-svc';
const CHECKOUT = '/srv/orchestrator-svc/julia-next';
const ORCHESTRATOR_ENVIRONMENT = 'orchestrator-local';
const DISPATCH_ENVIRONMENT = 'ovh-local';
const WORKTREE_SELECTOR = `path:${CHECKOUT}`;
const PUBLISHER_ENV_FILE = '/etc/orchestrator-svc/.env.publisher';

// The ticket's own step 2 ("runs check-readiness.mjs with the server
// environment") means julia-run encodes that itself -- a caller that
// forgets `--env-file=...` shouldn't get a confusing readiness failure
// instead of a working run. Only fills in what's missing, never
// overwrites an explicit override (e.g. a test's injected fakes).
function defaultLoadEnvFile() {
  process.loadEnvFile(PUBLISHER_ENV_FILE);
}

export function prepareServerEnvironment({ env = process.env, loadEnvFileImpl = defaultLoadEnvFile } = {}) {
  if (!env.ORCA_BIN) env.ORCA_BIN = '/opt/Orca/orca-ide';
  if (!env.ORCA_ENVIRONMENT) env.ORCA_ENVIRONMENT = DISPATCH_ENVIRONMENT;
  if (!env.JULIA_PUBLISHER_APP_ID || !env.JULIA_PUBLISHER_APP_PRIVATE_KEY) {
    loadEnvFileImpl(env);
  }
  return env;
}

export function assertIssueId(issueId) {
  if (typeof issueId !== 'string' || !/^[A-Za-z]+-\d+$/.test(issueId)) {
    throw new Error(`issueId must look like JUL-63, got ${JSON.stringify(issueId)}`);
  }
}

export function assertAccount({ usernameImpl = () => os.userInfo().username } = {}) {
  const username = usernameImpl();
  if (username !== REQUIRED_ACCOUNT) {
    throw new Error(`must run as ${REQUIRED_ACCOUNT}, not ${username}`);
  }
}

export async function assertReady({ checkReadinessImpl = checkReadiness } = {}) {
  const { ok, checks } = await checkReadinessImpl();
  if (!ok) {
    const failing = checks.find((c) => !c.ok);
    throw new Error(`readiness check failed: ${failing.name} -- ${failing.detail}`);
  }
}

// The checkout can't sync itself (no write access to its own .git dir --
// see the runbook), so this triggers the one narrowly-scoped sudo rule
// that lets orchestrator-svc run exactly `systemctl start
// julia-next-checkout-sync.service`, then re-checks.
// julia-next is a private repo -- an unauthenticated `git ls-remote` hangs
// forever waiting for a credential prompt in a non-interactive terminal
// (hit live, JUL-63). Resolve the remote head via the GitHub API with the
// publisher's own installation token instead of touching git credentials
// at all for this check.
export async function getRemoteMainHead({ tokenImpl = getPublisherInstallationToken, fetchImpl = fetch } = {}) {
  const token = await tokenImpl({ ...process.env, JULIA_PUBLISHER_REPO: 'julia-next' });
  const res = await fetchImpl('https://api.github.com/repos/toddwyder/julia-next/git/ref/heads/main', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`could not resolve origin/main via the GitHub API (HTTP ${res.status}): ${body.message ?? JSON.stringify(body)}`);
  }
  return body.object.sha;
}

export async function ensureCheckoutSynced({ execImpl = execFileAsync, getRemoteMainHeadImpl = getRemoteMainHead } = {}) {
  const localHead = (await execImpl('git', ['-C', CHECKOUT, 'rev-parse', 'HEAD'])).stdout.trim();
  const remoteHead = await getRemoteMainHeadImpl({ execImpl });
  if (localHead === remoteHead) return { head: localHead, triggeredSync: false };

  await execImpl('sudo', ['-n', 'systemctl', 'start', 'julia-next-checkout-sync.service']);
  const afterHead = (await execImpl('git', ['-C', CHECKOUT, 'rev-parse', 'HEAD'])).stdout.trim();
  if (afterHead !== remoteHead) {
    throw new Error(`checkout still at ${afterHead} after triggering a sync, expected ${remoteHead}`);
  }
  return { head: afterHead, triggeredSync: true };
}

// No clean "is this run still active" field exists on run-list (JUL-63
// research) -- this checks for any run ever created with this exact
// objective, which is what the double-start guard actually needs to
// test against (a second invocation for the same issue while the first
// is still in flight). A completed run for the same issue blocking a
// legitimate re-run is a known, disclosed limitation, not silently
// assumed away.
export async function findExistingRun(issueId, { runListImpl = runList } = {}) {
  const { runs } = await runListImpl({ environment: ORCHESTRATOR_ENVIRONMENT, limit: 100 });
  return runs.find((r) => r.objective === issueId) ?? null;
}

export async function startOrchestrator(issueId, {
  runCreateImpl = runCreate,
  terminalCreateImpl = terminalCreate,
  fromHandle = process.env.ORCA_TERMINAL_HANDLE,
} = {}) {
  if (!fromHandle) {
    throw new Error('ORCA_TERMINAL_HANDLE is not set -- julia-run must run inside an Orca-managed terminal on the orchestrator-local runtime, not a bare shell');
  }
  const created = await runCreateImpl({ environment: ORCHESTRATOR_ENVIRONMENT, from: fromHandle, objective: issueId });
  const runId = created.run.id;

  await terminalCreateImpl({
    environment: ORCHESTRATOR_ENVIRONMENT,
    worktree: WORKTREE_SELECTOR,
    // The skill has disable-model-invocation: true (invoked by name only,
    // never inferred) -- asking in prose was refused live (JUL-63): the
    // model correctly declined to run the skill's steps by hand and
    // pointed back at the slash command instead. Pass that explicitly.
    //
    // --allowedTools: without this, the launch exits 0 having reached
    // neither Linear nor Orca -- caught live because the coordinator's own
    // first real run diagnosed its own missing grants and reported back
    // instead of silently doing nothing (JUL-63). Both Linear tool
    // namespaces (see defaultPostCommentImpl's own comment on why), plus
    // Bash access to the exact scripts the skill's "Each wake"/"Running a
    // step" procedures name.
    command: `claude --permission-mode acceptEdits --allowedTools "mcp__linear__*,mcp__claude_ai_Linear__*,Bash(node scripts/orca-cli.mjs:*),Bash(node scripts/check-readiness.mjs:*),Bash(node scripts/collect-worker-result.mjs:*),Bash(node scripts/verify-reviewer-worktree.mjs:*),Bash(orca *)" -p "/julia-coordinator ${issueId}"`,
    title: `julia-run-${issueId}`,
  });

  return { runId };
}

export async function postStartComment(issueId, runId, { postCommentImpl = defaultPostCommentImpl } = {}) {
  const startedAt = new Date().toISOString();
  const body = `Instruction: run started by julia-run at ${startedAt}, orchestrator ${runId}\n\nFor Todd:\n- julia-run started the orchestrator for this issue.\n- nothing`;
  await postCommentImpl(issueId, body);
}

// Reuses orchestrator-svc's own already-authenticated Claude + Linear MCP
// connection (the one from JUL-61 step 2/3) rather than a separate
// LINEAR_API_KEY -- exactly the pattern already verified live for posting
// evidence as this account.
//
// Two real bugs found live (JUL-63) and fixed here:
// 1. From this checkout's CWD, the model sometimes reaches for the
//    built-in `mcp__claude_ai_Linear__save_comment` connector instead of
//    the standalone `mcp__linear__save_comment` server -- allow both, so
//    whichever one it picks is permitted rather than silently denied.
// 2. `claude -p` exits 0 even when its only tool call was denied -- it
//    just explains the failure in its text result instead of erroring.
//    --output-format json exposes `permission_denials`/`is_error`, which
//    this actually checks instead of trusting the exit code.
export async function defaultPostCommentImpl(issueId, body, { execImpl = execFileAsync } = {}) {
  const prompt = `Use the Linear MCP tool to post exactly this comment (verbatim, no changes) on issue ${issueId}:\n\n${body}`;
  const { stdout } = await execImpl('claude', [
    '-p', prompt,
    '--allowedTools', 'mcp__linear__save_comment,mcp__claude_ai_Linear__save_comment',
    '--output-format', 'json',
  ]);
  const result = JSON.parse(stdout);
  if (result.is_error || (result.permission_denials ?? []).length > 0) {
    throw new Error(`failed to post the start comment on ${issueId}: ${result.result ?? JSON.stringify(result.permission_denials)}`);
  }
}

export async function juliaRun(issueId, impls = {}) {
  assertIssueId(issueId);
  assertAccount(impls);
  prepareServerEnvironment(impls);
  await assertReady(impls);
  await ensureCheckoutSynced(impls);

  const existing = await findExistingRun(issueId, impls);
  if (existing) {
    throw new Error(`a run is already active for ${issueId}: ${existing.id}`);
  }

  const { runId } = await startOrchestrator(issueId, impls);
  await postStartComment(issueId, runId, impls);
  return { runId };
}

async function main() {
  const issueId = process.argv[2];
  if (!issueId) {
    console.error('usage: julia-run <ISSUE-ID>');
    process.exitCode = 2;
    return;
  }
  try {
    const { runId } = await juliaRun(issueId);
    console.log(runId);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
