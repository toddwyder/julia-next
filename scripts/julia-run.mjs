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
import {
  runCreate, runList, taskList, terminalCreate, terminalWait, terminalRead,
} from './orca-cli.mjs';
import { getPublisherInstallationToken } from './publish-via-github-app.mjs';
import { SEAT_TABLE } from '../graph/seat-table.mjs';
import { translateEffort, normalizeEffort } from './effort.mjs';

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

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'stopped', 'cancelled']);

// JUL-44's first real run (run_c404a384fb43) stopped at preflight before
// any Task was ever created for it -- zero Tasks, forever, once blocked.
// A run with an active Task is unambiguously still in progress. A run
// with zero Tasks is ambiguous by task-list alone (a brand-new run also
// has zero Tasks, for the seconds/minutes its preflight takes) -- so a
// zero-Task run only counts as finished once it's older than a
// generous grace window past any real preflight pass. This is a
// deliberately conservative heuristic (favors "still blocks") given no
// queryable run-level status field or Axiom read access exists yet (see
// docs/agents/jul43-coordinator-runbook.md).
//
// Live-verified 2026-09-17 (JUL-70): every real run on orchestrator-local
// (run_c404a384fb43 included, plus six other journey-zero runs) has zero
// Tasks -- this coordinator has never actually called task-create yet, so
// the zero-Task branch above is the only one exercised in practice today,
// not a theoretical fallback. `task-list --run <id> --environment
// orchestrator-local --json` returns the {runId, legacyReadOnly, tasks,
// count} shape assumed here. Ran the real fixed findExistingRun('JUL-44')
// against the live server (a scratch copy of this file, as
// orchestrator-svc, read-only inspection only) and confirmed it now
// returns null instead of the stuck run. The active-Task branch (a
// non-terminal `status` value) remains unverified -- no live Task has
// ever existed to check it against.
const ZERO_TASK_RUN_GRACE_MS = 15 * 60 * 1000;

export async function isRunFinished(existingRun, { taskListImpl = taskList, now = () => Date.now() } = {}) {
  const { tasks } = await taskListImpl({ environment: ORCHESTRATOR_ENVIRONMENT, runId: existingRun.id });
  const hasActiveTask = tasks.some((t) => !TERMINAL_TASK_STATUSES.has(t.status));
  if (hasActiveTask) return false;
  if (tasks.length > 0) return true;

  const lastActivity = Date.parse(existingRun.updated_at ?? existingRun.created_at ?? 0);
  if (Number.isNaN(lastActivity)) return false;
  return now() - lastActivity > ZERO_TASK_RUN_GRACE_MS;
}

export async function findExistingRun(issueId, { runListImpl = runList, isRunFinishedImpl = isRunFinished } = {}) {
  const { runs } = await runListImpl({ environment: ORCHESTRATOR_ENVIRONMENT, limit: 100 });
  const match = runs.find((r) => r.objective === issueId);
  if (!match) return null;
  if (await isRunFinishedImpl(match)) return null;
  return match;
}

// Env prefix shared by every vendor branch (JUL-44 preflight misses 1 and
// 2): whichever process this launches is a fresh shell on the
// orchestrator-local runtime -- it does not inherit julia-run's own
// process env, so every orca-cli.mjs-based script it runs
// (check-readiness.mjs, workerStart, coordinator-events.mjs) failed with
// "ORCA_BIN is not set", and check-readiness.mjs's publisher check failed
// for want of JULIA_PUBLISHER_APP_ID/_PRIVATE_KEY. Export both before the
// vendor invocation so every Bash subprocess it spawns inherits them too;
// `set -a`/`set +a` auto-exports every name sourced from the publisher env
// file without listing them one by one.
const ENV_PREFIX = `export ORCA_BIN=/opt/Orca/orca-ide ORCA_ENVIRONMENT=${DISPATCH_ENVIRONMENT}; set -a; . ${PUBLISHER_ENV_FILE}; set +a;`;

const SKILL_PATH = '.claude/skills/julia-coordinator/SKILL.md';

function claudeLaunchCommand(issueId, effort) {
  // The skill has disable-model-invocation: true (invoked by name only,
  // never inferred) -- asking in prose was refused live (JUL-63): the
  // model correctly declined to run the skill's steps by hand and pointed
  // back at the slash command instead. Pass that explicitly.
  //
  // --allowedTools: without this, the launch exits 0 having reached
  // neither Linear nor Orca -- caught live because the coordinator's own
  // first real run diagnosed its own missing grants and reported back
  // instead of silently doing nothing (JUL-63). A second real wake then
  // found the remaining gap itself: dispatch/readiness scripts were
  // granted, but publish-pr.mjs/merge-pr.mjs/coordinator-events.mjs
  // weren't, so a real ticket would build and review, then be refused at
  // publish. Both Linear tool namespaces (the coordinator sometimes reaches
  // for the hosted `mcp__claude_ai_Linear__*` connector instead of the
  // standalone `mcp__linear__*` server, depending on CWD), Bash access to
  // the exact scripts the skill's "Each wake"/"Running a step"/"After
  // verification" procedures name, and the publisher credential file for
  // the two scripts that need it.
  //
  // JUL-79 step 6: a real unattended wake stalled because the queue script
  // (ready-queue.mjs) and the repo's Linear command (linear-cli.mjs) were
  // not granted -- nobody can approve a prompt in an unattended run. Add
  // exactly those two, not a blanket `Bash(node:*)`, and leave the
  // permission mode and every existing grant untouched.
  //
  // JUL-79 step 3: --effort is Claude Code's own graded setting (live
  // --help check); translateEffort supplies the level, Medium by default.
  // Everything after it is unchanged -- the grant list is not an effort
  // concern and must not be disturbed here.
  const effortArgs = translateEffort('claude', effort).join(' ');
  return `${ENV_PREFIX} claude --permission-mode acceptEdits ${effortArgs} --allowedTools "mcp__linear__*,mcp__claude_ai_Linear__*,Bash(node scripts/orca-cli.mjs:*),Bash(node scripts/ready-queue.mjs:*),Bash(node scripts/linear-cli.mjs:*),Bash(node scripts/check-readiness.mjs:*),Bash(node scripts/collect-worker-result.mjs:*),Bash(node scripts/verify-reviewer-worktree.mjs:*),Bash(node scripts/coordinator-events.mjs:*),Bash(node --env-file=/etc/orchestrator-svc/.env.publisher scripts/publish-pr.mjs:*),Bash(node --env-file=/etc/orchestrator-svc/.env.publisher scripts/merge-pr.mjs:*),Bash(orca *)" -p "/julia-coordinator ${issueId}"`;
}

// The stdin-pipe preamble every non-Claude entry shares: the checkout's own
// coordinator skill text followed by the issue id, read live from disk at
// launch time (never a snapshot baked into this repo's JS). `codex exec -`
// and run-pi-seat.mjs both read their prompt from stdin, and `-` is the
// stdin marker -- keeping one helper means the two routes cannot drift.
function pipedCoordinatorPrompt(issueId) {
  return `{ cat ${SKILL_PATH}; printf '\\n\\nIssue: %s\\n' '${issueId}'; }`;
}

// Codex as an orchestrator entry (JUL-79 step 3). The launch shape is
// live-verified JUL-73: stdin prompt, and `-s danger-full-access` is the
// ONLY sandbox level under which Codex's per-write MCP approval gate lets
// Linear write-classified tool calls through -- there is no per-tool
// allowlist in Codex. The effort is Codex's own `-c
// model_reasoning_effort=...` setting (live check).
function codexLaunchCommand(issueId, effort) {
  const effortArgs = translateEffort('codex', effort).join(' ');
  return `${ENV_PREFIX} ${pipedCoordinatorPrompt(issueId)} | codex exec - -s danger-full-access ${effortArgs}`;
}

// Pi (DeepSeek or GLM), the orchestrator's Pi routes: no slash-command
// or exec-subcommand equivalent, so the coordinator skill body is piped in
// on stdin (see pipedCoordinatorPrompt above), read by run-pi-seat.mjs's own
// CLI entry (`readAllStdin`) and passed to Pi as its `-p` prompt. The secret
// never appears in this string -- run-pi-seat.mjs reads it in-process via
// read-secret.mjs, keyed only by the seat name (which *is* safe to put in a
// shell string). JUL-79 step 8 sets the orchestrator's table backup to
// `pi-deepseek` and leaves `pi-glm` selectable as a card label, never a seat
// default or backup -- both still launch through this helper.
//
// The effort travels as the neutral `--effort <level>` label, not as a Pi
// flag: run-pi-seat.mjs owns Pi's actual on/off spelling (`--thinking`), so
// the launcher never has to know which vendor a seat fronts.
function piLaunchCommand(issueId, seat, effort) {
  return `${ENV_PREFIX} ${pipedCoordinatorPrompt(issueId)} | node ops/service-dropbox/run-pi-seat.mjs ${seat} --effort ${normalizeEffort(effort)}`;
}

// `effort` is optional and defaults to Medium (the ticket's stated default),
// so every existing two-argument caller keeps working unchanged.
export function orchestratorLaunchCommandFor(entry, issueId, { effort } = {}) {
  if (entry === 'claude') return claudeLaunchCommand(issueId, effort);
  if (entry === 'codex') return codexLaunchCommand(issueId, effort);
  if (entry === 'pi-glm') return piLaunchCommand(issueId, 'orchestrator-backup', effort);
  if (entry === 'pi-deepseek') return piLaunchCommand(issueId, 'orchestrator-deepseek', effort);
  throw new Error(`unknown orchestrator seat-table entry: ${entry}`);
}

// A usage-cap error is the only condition that moves the orchestrator to
// its table backup (JUL-77 Build item 3: "No retry on any other error").
// The Codex text below is verbatim, captured live this session from a real
// capped Codex session ("You've hit your usage limit ... try again at Sep
// 19th, 2026 7:28 PM."); the rest are the vendors' documented phrasing.
// Claude Code's exact cap text was never observed live this week -- no
// session in this project's record hit one -- so this pattern is written
// from the vendors' common phrasing ("usage limit"/"quota"/"rate limit"),
// not a verified quote for that vendor specifically. If it turns out not to
// match a real Claude cap message, that's a gap to close with a live
// example, not a guess to silence.
//
// Z.ai (GLM) exhaustion is the other live-verified one (2026-09-19,
// captured twice): a seat with no balance returns
// `429 {"code":"1113","message":"Insufficient balance or no resource
// package. Please recharge."}` on every call. "insufficient balance",
// "no resource package" and "recharge" cover that wording and its close
// paraphrases without turning ordinary vendor errors into a cap.
export const CAP_ERROR_PATTERN = /usage limit|hit your usage|quota exceeded|rate limit exceeded|insufficient balance|no resource package|recharge/i;

// Bounded, not a wait for the whole session: a cap error shows up within
// the first turn or two (observed live this session, Codex, within ~30s of
// prompt submission), long before a real multi-step coordinator wake would
// finish. Timing out without seeing the pattern is not itself an error --
// it means "no cap seen yet", and the session is left running normally.
const CAP_CHECK_TIMEOUT_MS = 45000;

export async function waitForEarlyCapError(terminalHandle, {
  environment = ORCHESTRATOR_ENVIRONMENT,
  terminalWaitImpl = terminalWait,
  terminalReadImpl = terminalRead,
  timeoutMs = CAP_CHECK_TIMEOUT_MS,
} = {}) {
  await terminalWaitImpl({
    environment, terminal: terminalHandle, forState: 'tui-idle', timeoutMs,
  }).catch(() => {
    // A wait timeout means "still running, nothing settled yet" -- not an
    // error, and not evidence of a cap. Fall through to read whatever
    // output exists so far; if it shows a cap message that already
    // happened before the wait itself resolved, catch it here too.
  });
  const { terminal } = await terminalReadImpl({ environment, terminal: terminalHandle });
  const tail = (terminal?.tail ?? []).join('\n');
  return CAP_ERROR_PATTERN.test(tail);
}

export async function startOrchestratorEntry(issueId, entry, {
  runCreateImpl = runCreate,
  terminalCreateImpl = terminalCreate,
  fromHandle = process.env.ORCA_TERMINAL_HANDLE,
} = {}) {
  if (!fromHandle) {
    throw new Error('ORCA_TERMINAL_HANDLE is not set -- julia-run must run inside an Orca-managed terminal on the orchestrator-local runtime, not a bare shell');
  }
  // Build (and validate) the launch command before creating the run: an
  // unknown table entry must fail before anything exists in Orca, not
  // leave an orphan run with zero tasks that then blocks a retry for the
  // isRunFinished grace window (JUL-73 review finding).
  const command = orchestratorLaunchCommandFor(entry, issueId);

  const created = await runCreateImpl({ environment: ORCHESTRATOR_ENVIRONMENT, from: fromHandle, objective: issueId });
  const runId = created.run.id;

  const { terminal } = await terminalCreateImpl({
    environment: ORCHESTRATOR_ENVIRONMENT,
    worktree: WORKTREE_SELECTOR,
    command,
    title: `julia-run-${issueId}`,
  });

  return { runId, terminalHandle: terminal?.handle };
}

// JUL-77 Build item 3: julia-run reads the seat table instead of
// ORCHESTRATOR_VENDOR. Tries the table's primary entry; if it shows a cap
// error within the early check window, starts the same objective on the
// backup entry instead and returns that run. Any other outcome (success,
// a non-cap error, or simply still running past the check window) is left
// alone -- no retry on any other error.
export async function startOrchestrator(issueId, {
  seatTable = SEAT_TABLE,
  waitForEarlyCapErrorImpl = waitForEarlyCapError,
  ...impls
} = {}) {
  const { primary, backup } = seatTable.orchestrator;
  const first = await startOrchestratorEntry(issueId, primary, impls);

  const capped = await waitForEarlyCapErrorImpl(first.terminalHandle, impls);
  if (!capped) {
    return { runId: first.runId, usedEntry: primary };
  }

  const fallback = await startOrchestratorEntry(issueId, backup, impls);
  return {
    runId: fallback.runId, usedEntry: backup, failedOverFrom: primary,
  };
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

  const result = await startOrchestrator(issueId, impls);
  return result;
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
