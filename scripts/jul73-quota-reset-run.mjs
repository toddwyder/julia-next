#!/usr/bin/env node
// jul73-quota-reset-run.mjs -- JUL-73: fired once by the jul73-quota-reset
// systemd timer, 15 minutes after the Codex account's own usage cap resets
// (2026-09-19 19:28 UTC), to finish the one acceptance leg the quota wall
// blocked: proving a codex-vendor orchestrator can complete a real wake and
// post to Linear through julia-run.mjs itself, not just reach the model.
//
// Runs as orchestrator-svc (the systemd unit sudo's to this account -- see
// ops/jul73-quota-reset/). No LINEAR_API_KEY here: this script only
// dispatches and gathers mechanical evidence (Orca terminals, a process
// check, a deterministic sandbox-probe script); every Linear read/write,
// and the actual pass/fail call, is made by a single `claude -p` "closer"
// step at the end -- the same live-agent-session pattern every other
// Linear write in this repo uses, and the one vendor guaranteed not to be
// the thing under test.
//
// Two rounds of fresh Claude review (Codex being walled is exactly why
// Claude reviewed this instead -- disclosed on the PR) found real
// correctness bugs, folded in here across both drafts:
// - The script's own process needs ORCA_BIN/ORCA_ENVIRONMENT/publisher
//   creds -- `prepareServerEnvironment` (julia-run.mjs) is reused.
// - `julia-run.mjs` returns as soon as it dispatches, before any real
//   wake -- this correlates the exact run it created (by id, read back
//   from `runList`, not by title or a timing guess that could match a
//   stale run from an earlier attempt) and polls *that* run's own
//   coordinator terminal for its shell prompt to return.
// - A `claude` PATH shim on the dispatching process proves nothing (the
//   vendor launches in a separate Orca terminal that doesn't inherit that
//   PATH) -- replaced with a `pgrep`-based watch for any `claude` process
//   under this account, sampled throughout the wait window, with a
//   non-"no match" pgrep failure surfacing as evidence instead of reading
//   as "clean".
// - `codex exec` has no "run this literal command, bypass the model" form
//   -- its `<COMMAND> [ARGS]` alternate usage line names its own
//   subcommands (resume/fork/review/help), not an arbitrary shell command.
//   The sandbox probe asks Codex, in a narrow prompt, to run the
//   deterministic probe script and relay its exact output -- trusted the
//   same way every other Codex tool-call transcript in this project
//   already is, not a hard sandbox bypass.
// - Every gathering step is wrapped so a thrown error becomes evidence (an
//   error string) rather than aborting before the closer ever runs, and
//   the internal poll budgets are kept well under the unit's
//   TimeoutStartSec so there is always time left for the closer to run
//   and actually reach Linear, even in the worst case (every mechanical
//   step timing out).
// - The closer step resolves `claude` through a login shell (`bash -lc`)
//   rather than a bare name, since it runs under `sudo -H -u
//   orchestrator-svc` from a systemd unit, not from an interactive Orca
//   terminal's own shell the way every other `claude` invocation in this
//   repo does -- an untested code path otherwise.
//
// A third review round on the second fix found two more real bugs, also
// folded in: the JUL-44 launch command handed to the closer began with an
// `export ...;` prefix that its own `--allowedTools` grant (a literal
// command-prefix match) never actually covered -- a guaranteed permission
// denial on the one success path that matters, discovered only by review,
// not by any test, since no test exercised the two strings against each
// other. Both are now built from one shared constant so they can't drift
// apart again. It also flagged that `run.coordinator_handle`'s meaning was
// asserted, not verified -- see findFreshRun's own comment for the live
// evidence that settles it. A single-read "shell prompt returned" check
// was also shown to false-positive on a terminal's own startup banner;
// completion now requires two consecutive identical, prompt-terminated
// reads.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareServerEnvironment } from './julia-run.mjs';
import { runList } from './orca-cli.mjs';

const execFileAsync = promisify(execFile);

const ORCHESTRATOR_ENVIRONMENT = 'orchestrator-local';
const CHECKOUT = '/srv/orchestrator-svc/julia-next';
const PUBLISHER_ENV_FILE = '/etc/orchestrator-svc/.env.publisher';
const DISPATCH_ENVIRONMENT = 'ovh-local';
const ISSUE_ID = 'JUL-76';
const WAIT_INTERVAL_MS = 10_000;
// Kept well under the unit's TimeoutStartSec (1800s = 30 min) so the closer
// always has time left to run even if every mechanical step below times
// out. Sequential worst case for the acceptance chain (dispatch-wait +
// run-discovery + wake-wait) is 2+2+10 = 14 min; the sandbox probe (3 min)
// runs concurrently with that chain, not after it -- so 14 min is the real
// worst-case wall clock, leaving a >15 min margin for `runCloser` itself.
const DISPATCH_WAIT_POLLS = 12;
const RUN_DISCOVERY_POLLS = 12;
const WAKE_WAIT_POLLS = 60;
const SANDBOX_PROBE_POLLS = 18;

const ORCA_BIN_PATH = '/opt/Orca/orca-ide';
const ENV_PREFIX = `export ORCA_BIN=${ORCA_BIN_PATH} ORCA_ENVIRONMENT=${DISPATCH_ENVIRONMENT}; set -a; . ${PUBLISHER_ENV_FILE}; set +a;`;
// The exact command the closer is instructed to run to launch JUL-44, and
// the exact `--allowedTools` grant that must cover it, are built from this
// one shared prefix so they can never drift apart the way a first draft's
// `export ORCA_BIN=...; /opt/Orca/orca-ide ...` command and its
// `Bash(/opt/Orca/orca-ide *)` grant did (caught by review: the grant is a
// literal command-prefix match, and the `export ...;` prefix meant the
// actual command never matched it -- a real permission denial on the one
// success path that matters, discovered only by review, not by any test).
const JUL44_LAUNCH_COMMAND = `${ORCA_BIN_PATH} terminal create --environment ${ORCHESTRATOR_ENVIRONMENT} --worktree "path:${CHECKOUT}" --command "cd ${CHECKOUT} && node scripts/julia-run.mjs JUL-44" --title julia-run-JUL-44 --json`;
const JUL44_LAUNCH_ALLOWED_TOOL = `Bash(${ORCA_BIN_PATH} terminal create *)`;

function defaultWait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// See file header. Codex relays the probe script's own stdout verbatim
// when asked narrowly and explicitly for exactly that -- this is a live
// model call, not a sandbox bypass, and is described as such (the prior
// draft's probe-script comment claiming a bypass was stale and wrong; see
// jul73-codex-sandbox-probe.mjs's own header).
export function buildSandboxProbeCommand() {
  return `${ENV_PREFIX} cd ${CHECKOUT} && codex exec -s danger-full-access --skip-git-repo-check "Run exactly this command and reply with nothing but its raw stdout, no commentary before or after: node scripts/jul73-codex-sandbox-probe.mjs"`;
}

export function buildCodexAcceptanceCommand() {
  return `export ORCHESTRATOR_VENDOR=codex; cd ${CHECKOUT} && node scripts/julia-run.mjs ${ISSUE_ID}`;
}

async function pollUntil({
  terminalHandle, isDone, terminalReadImpl, waitImpl, maxPolls,
}) {
  let tail = '';
  for (let i = 0; i < maxPolls; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const read = await terminalReadImpl({ environment: ORCHESTRATOR_ENVIRONMENT, terminal: terminalHandle });
    tail = (read.terminal.tail ?? []).join('\n');
    if (isDone(tail)) return { tail, done: true };
    // eslint-disable-next-line no-await-in-loop
    await waitImpl(WAIT_INTERVAL_MS);
  }
  return { tail, done: false };
}

// A shell prompt reappearing on the tail's last line is the end marker --
// not a single immediate read, and not `terminalWait --for tui-idle`
// (both proven unreliable live, see the runbook's Journey accounting
// section and JUL-76's own report). This alone still isn't enough: a
// freshly created terminal's own startup banner/motd can produce a
// prompt-terminated tail on the very first read even though the real
// command hasn't finished (caught by review). So this requires the tail
// to look done on two *consecutive* polls with no new output between them
// -- a terminal genuinely still working keeps producing output and never
// stabilizes; only a truly finished one reads identically twice in a row.
function looksPromptTerminated(tail) {
  const lines = tail.split('\n').filter((l) => l.trim().length > 0);
  return lines.length > 1 && /\$\s*$/.test(lines[lines.length - 1]);
}

async function pollUntilStable({
  terminalHandle, terminalReadImpl, waitImpl, maxPolls,
}) {
  let previousTail = null;
  let tail = '';
  for (let i = 0; i < maxPolls; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const read = await terminalReadImpl({ environment: ORCHESTRATOR_ENVIRONMENT, terminal: terminalHandle });
    tail = (read.terminal.tail ?? []).join('\n');
    if (looksPromptTerminated(tail) && tail === previousTail) {
      return { tail, done: true };
    }
    previousTail = tail;
    // eslint-disable-next-line no-await-in-loop
    await waitImpl(WAIT_INTERVAL_MS);
  }
  return { tail, done: false };
}

export async function runCodexSandboxProbe({
  terminalCreateImpl, terminalReadImpl, waitImpl = defaultWait, maxPolls = SANDBOX_PROBE_POLLS,
}) {
  const created = await terminalCreateImpl({
    environment: ORCHESTRATOR_ENVIRONMENT,
    worktree: `path:${CHECKOUT}`,
    command: buildSandboxProbeCommand(),
    title: 'jul73-quota-reset-sandbox-probe',
  });

  const { tail } = await pollUntil({
    terminalHandle: created.terminal.handle,
    isDone: (t) => /\{"publisherReadable":\s*(?:true|false)/.test(t),
    terminalReadImpl,
    waitImpl,
    maxPolls,
  });

  const match = tail.match(/\{"publisherReadable":\s*(true|false),\s*"orcaReachable":\s*(true|false)\}/);
  if (!match) {
    // No parseable result -- most likely Codex itself couldn't run at all
    // (e.g. still walled), or relayed commentary instead of raw output.
    // Fail closed: never report a pass just because it didn't clearly fail.
    return { publisherReadable: false, orcaReachable: false, raw: tail };
  }
  return { publisherReadable: match[1] === 'true', orcaReachable: match[2] === 'true', raw: match[0] };
}

export async function dispatchCodexAcceptanceRun({
  terminalCreateImpl, terminalReadImpl, waitImpl = defaultWait, maxPolls = DISPATCH_WAIT_POLLS,
}) {
  const created = await terminalCreateImpl({
    environment: ORCHESTRATOR_ENVIRONMENT,
    worktree: `path:${CHECKOUT}`,
    command: buildCodexAcceptanceCommand(),
    title: 'jul73-quota-reset-dispatch',
  });

  const { tail, done } = await pollUntilStable({
    terminalHandle: created.terminal.handle,
    terminalReadImpl,
    waitImpl,
    maxPolls,
  });

  return { dispatchOutput: tail, dispatchFinished: done, dispatchTerminalHandle: created.terminal.handle };
}

// Correlates by the exact run `julia-run.mjs` just created -- by id, read
// back from `runList` -- rather than by terminal title or a timing guess,
// either of which could match a stale run/terminal from an earlier
// (quota-walled) attempt at the same issue (a real bug in the first draft,
// caught by review: a stale `julia-run-JUL-76` terminal from the very
// attempt this ticket exists because it failed would otherwise poison the
// result). `sinceIso` excludes anything created before this dispatch.
//
// `run.coordinator_handle` is the actual vendor/coordinator terminal
// `startOrchestrator` creates (julia-run.mjs's own second `terminalCreate`
// call), not this script's own dispatch terminal -- confirmed live, not
// guessed (a second review round raised this as unverified): JUL-75's own
// real codex-vendor run this session, `run_90fa4e977883`, carried
// `coordinator_handle: "term_be9264c3-…"`, and reading that exact handle
// directly showed the real `codex exec`/SKILL.md transcript and the
// ChatGPT usage-limit error -- not the separate dispatch terminal
// (`term_ae19076b-…`) that ran `node scripts/julia-run.mjs JUL-75` and
// only ever printed the run id and exit code. See JUL-73's Linear thread
// for that live run's evidence.
export async function findFreshRun({
  issueId = ISSUE_ID, sinceIso, runListImpl = runList, maxPolls = RUN_DISCOVERY_POLLS, waitImpl = defaultWait,
}) {
  const sinceMs = Date.parse(sinceIso);
  for (let i = 0; i < maxPolls; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { runs } = await runListImpl({ environment: ORCHESTRATOR_ENVIRONMENT, limit: 100 });
    const fresh = runs
      .filter((r) => r.objective === issueId && Date.parse(r.created_at ?? 0) >= sinceMs && r.coordinator_handle)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    if (fresh.length > 0) return fresh[0];
    // eslint-disable-next-line no-await-in-loop
    await waitImpl(WAIT_INTERVAL_MS);
  }
  return null;
}

export async function checkForClaudeProcess({ execImpl }) {
  try {
    const { stdout } = await execImpl('pgrep', ['-u', 'orchestrator-svc', '-a', 'claude']);
    const trimmed = stdout.trim();
    return { sighting: trimmed.length > 0 ? trimmed : null, checkError: null };
  } catch (error) {
    // pgrep's own documented behavior: exit 1 means "no process matched"
    // -- that is the good case, not an error. Anything else (pgrep itself
    // missing, permission trouble, a bad invocation) must surface as
    // evidence, not silently read the same as "no Anthropic call" (the
    // exact failure class findings #3/#5 were about, in a new mechanism).
    if (error.code === 1) return { sighting: null, checkError: null };
    return { sighting: null, checkError: `pgrep failed unexpectedly (exit ${error.code ?? 'unknown'}): ${error.message}` };
  }
}

// Watches for two things over the same window, since a short-lived process
// between polls would otherwise be missed if this ran sequentially after
// the wait instead of alongside it: (1) the coordinator terminal actually
// finishing, and (2) whether a `claude` process ever ran under this
// account meanwhile.
export async function waitForWakeAndWatchForClaude({
  coordinatorHandle, terminalReadImpl, execImpl, waitImpl = defaultWait, maxPolls = WAKE_WAIT_POLLS,
}) {
  const claudeSightings = [];
  const checkErrors = [];
  let finished = false;
  let output = '';
  let previousOutput = null;

  for (let i = 0; i < maxPolls; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const read = await terminalReadImpl({ environment: ORCHESTRATOR_ENVIRONMENT, terminal: coordinatorHandle });
    output = (read.terminal.tail ?? []).join('\n');
    // Two consecutive identical, prompt-terminated reads -- see
    // looksPromptTerminated's own comment for why a single read isn't
    // enough (a startup banner can look done on the very first poll).
    finished = looksPromptTerminated(output) && output === previousOutput;
    previousOutput = output;

    // eslint-disable-next-line no-await-in-loop
    const { sighting, checkError } = await checkForClaudeProcess({ execImpl });
    if (sighting) claudeSightings.push(sighting);
    if (checkError) checkErrors.push(checkError);

    if (finished) break;
    // eslint-disable-next-line no-await-in-loop
    await waitImpl(WAIT_INTERVAL_MS);
  }

  return {
    finished, output, claudeSeen: claudeSightings.length > 0, claudeSightings, checkErrors,
  };
}

// Every gathering step is wrapped so a thrown error becomes evidence (an
// error string in the result) rather than aborting before the closer ever
// runs.
async function gather(label, fn) {
  try {
    return await fn();
  } catch (error) {
    return { error: `${label} threw: ${error.message}` };
  }
}

async function gatherAcceptanceRun({
  terminalCreateImpl, terminalReadImpl, waitImpl, sinceIso,
}) {
  const dispatch = await dispatchCodexAcceptanceRun({ terminalCreateImpl, terminalReadImpl, waitImpl });
  if (!dispatch.dispatchFinished) {
    return { ...dispatch, error: 'julia-run.mjs dispatch never returned to its own shell prompt within budget' };
  }

  const run = await findFreshRun({ sinceIso, waitImpl });
  if (!run) {
    return { ...dispatch, error: `no fresh Orca run for ${ISSUE_ID} appeared after dispatch -- dispatchOutput is the only evidence of what julia-run.mjs actually did` };
  }

  const wake = await waitForWakeAndWatchForClaude({ coordinatorHandle: run.coordinator_handle, terminalReadImpl, execImpl: execFileAsync, waitImpl });
  return { ...dispatch, runId: run.id, coordinatorHandle: run.coordinator_handle, ...wake };
}

export function buildCloserPrompt({ sandboxProbe, acceptanceRun, sinceIso }) {
  return `You are the JUL-73 quota-reset closer. This is a one-shot follow-up dispatched by a systemd timer 15 minutes after Codex's usage cap reset, mechanically gathered outside any LLM except for two live Codex calls whose full transcripts are included below. Do not repeat the mechanical dispatch yourself -- verify and act on the evidence below. Follow this repo's "Todd's queue" reporting convention (.claude/skills/julia-coordinator/SKILL.md) for your Linear comments, including the \`For Todd:\` trailer and \`WAITING ON YOU:\` only if something genuinely needs a decision.

Mechanical evidence, gathered just now (since ${sinceIso}):

Sandbox probe (asked Codex, in a narrow prompt, to run scripts/jul73-codex-sandbox-probe.mjs and relay its raw stdout):
${JSON.stringify(sandboxProbe, null, 2)}

Codex acceptance run (ORCHESTRATOR_VENDOR=codex julia-run JUL-76, correlated by the exact Orca run id it created, watched for the whole wait window for both its coordinator terminal finishing and any \`claude\` process running under orchestrator-svc):
${JSON.stringify(acceptanceRun, null, 2)}

Your job:
1. Independently verify via the Linear MCP tool whether issue JUL-76 received a fresh comment from a codex-vendor orchestrator wake with a timestamp at or after ${sinceIso}. Read the comment's own content to confirm it is a real coordinator wake report (reconcile, admission or starvation reasoning), not something unrelated.
2. Cross-check that against the mechanical evidence above. All of these must hold for a PASS: sandboxProbe.publisherReadable=true, sandboxProbe.orcaReachable=true, acceptanceRun.finished=true, acceptanceRun.claudeSeen=false, acceptanceRun.checkErrors is empty, acceptanceRun.error is absent, and a genuine fresh Linear comment on JUL-76 from this run. If acceptanceRun.output shows an error (e.g. Codex's own usage limit again) or acceptanceRun.error is present, that is a FAIL regardless of the other fields.
3. On PASS: post the full evidence (mechanical evidence above plus your own Linear read) as a comment on JUL-73, then set JUL-73 to Done and close JUL-75 and JUL-76 (Cancelled, as throwaway issues). Then launch the real next work by running exactly this command, verbatim, with no modification (it is pre-authorized exactly as written): \`${JUL44_LAUNCH_COMMAND}\`.
4. On FAIL: post a comment on JUL-73 naming exactly which check failed, quoting the relevant piece of the mechanical evidence above (including dispatchOutput/output/claudeSightings/checkErrors, not just true/false), and what it left behind (an Orca run/terminal still worth inspecting, if any -- name its id/handle if present in the evidence). Leave JUL-73, JUL-75 and JUL-76 open. Do not start JUL-44. No retry -- this is a one-shot follow-up; a future explicit relaunch is a human decision, not this script's.
5. If you cannot complete either branch (e.g. your own Linear access fails), still leave a comment somewhere you can reach explaining exactly what happened, so this is never a silent no-op.`;
}

// Resolves `claude` through a login shell rather than a bare name: this
// process runs under `sudo -H -u orchestrator-svc` from a systemd unit,
// not from an interactive Orca terminal's own shell the way every other
// `claude` invocation in this repo does, so PATH/HOME resolution here is
// an untested code path otherwise. `bash -lc 'exec claude "$@"' -- <args>`
// passes every argument through argv, not shell-string interpolation, so
// the prompt's own content (which may contain quotes or newlines) is
// never re-parsed as shell syntax.
export async function runCloser({ execImpl = execFileAsync, prompt }) {
  const { stdout } = await execImpl('bash', [
    '-lc', 'exec claude "$@"', '--',
    '-p', prompt,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', `mcp__linear__*,mcp__claude_ai_Linear__*,${JUL44_LAUNCH_ALLOWED_TOOL}`,
    '--output-format', 'json',
  ], {
    cwd: CHECKOUT,
    maxBuffer: 10 * 1024 * 1024,
  });
  // A login shell (`bash -lc`) can print its own banner/motd before
  // `claude`'s own JSON -- a plain `JSON.parse(stdout)` would then throw
  // *after* the closer already wrote to Linear (review finding). Parse the
  // last brace-delimited line instead of assuming stdout is pure JSON.
  const lastJsonLine = stdout.trim().split('\n').reverse().find((line) => line.trim().startsWith('{') && line.trim().endsWith('}'));
  if (!lastJsonLine) {
    throw new Error(`closer step produced no parseable JSON output: ${stdout.slice(0, 2000)}`);
  }
  const result = JSON.parse(lastJsonLine);
  if (result.is_error || (result.permission_denials ?? []).length > 0) {
    throw new Error(`closer step failed: ${result.result ?? JSON.stringify(result.permission_denials)}`);
  }
  return result;
}

export async function main({
  terminalCreateImpl,
  terminalReadImpl,
  waitImpl = defaultWait,
  runCloserImpl = (prompt) => runCloser({ prompt }),
  prepareServerEnvironmentImpl = prepareServerEnvironment,
  gatherAcceptanceRunImpl = gatherAcceptanceRun,
  runCodexSandboxProbeImpl = runCodexSandboxProbe,
} = {}) {
  const prepared = await gather('prepareServerEnvironment', async () => { prepareServerEnvironmentImpl(); return {}; });
  const sinceIso = new Date().toISOString();

  const [sandboxProbe, acceptanceRun] = await Promise.all([
    prepared.error
      ? Promise.resolve({ error: prepared.error })
      : gather('sandbox probe', () => runCodexSandboxProbeImpl({ terminalCreateImpl, terminalReadImpl, waitImpl })),
    prepared.error
      ? Promise.resolve({ error: prepared.error })
      : gather('acceptance run', () => gatherAcceptanceRunImpl({
        terminalCreateImpl, terminalReadImpl, waitImpl, sinceIso,
      })),
  ]);

  const prompt = buildCloserPrompt({ sandboxProbe, acceptanceRun, sinceIso });
  const closerResult = await runCloserImpl(prompt);

  return {
    sandboxProbe, acceptanceRun, ranCloser: true, closerResult,
  };
}

async function cli() {
  try {
    const { terminalCreate, terminalRead } = await import('./orca-cli.mjs');
    const { closerResult } = await main({ terminalCreateImpl: terminalCreate, terminalReadImpl: terminalRead });
    console.log(JSON.stringify(closerResult));
  } catch (error) {
    // main()'s gather() wrapper absorbs every mechanical-step failure, so
    // a throw reaching here is overwhelmingly the closer step itself
    // (runCloser) -- i.e. this fires *after* the closer already tried to
    // write to Linear, not instead of it. Log loudly either way: journald
    // keeps this unit's log lines searchable by name even after the unit
    // files are removed (`journalctl -u jul73-quota-reset.service --since
    // ...`) -- the only forensic trail left once they're gone.
    console.error(`jul73-quota-reset-run.mjs: closer step threw (main()'s own gather() wrapper already absorbed every mechanical failure into the closer's evidence, so this is almost certainly the closer itself failing after already attempting a Linear write): ${error.message}`);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}
