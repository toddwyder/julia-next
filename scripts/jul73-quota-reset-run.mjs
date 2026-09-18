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
// Rewritten after a fresh Claude review of the first draft (Codex being
// walled is exactly why that review used Claude, not Codex -- disclosed on
// the PR) found several real correctness bugs, folded in here:
// 1. The script's own process needs ORCA_BIN/ORCA_ENVIRONMENT/publisher
//    creds -- `prepareServerEnvironment` (julia-run.mjs) is reused rather
//    than re-solving a problem that file already solves.
// 2. `julia-run.mjs` returns as soon as it dispatches the orchestrator
//    terminal, before any real wake happens -- a PASS is unreachable
//    unless something waits for that terminal to actually finish. This
//    polls the dispatched coordinator terminal itself for its shell
//    prompt to return (marker-based, per this repo's own established
//    lesson about not trusting `terminalWait --for tui-idle`), not
//    `julia-run`'s own exit code.
// 3. A `claude` PATH shim on the *dispatching* process proves nothing --
//    the vendor process launches in a separate Orca terminal that does
//    not inherit that PATH (the exact reason `julia-run.mjs`'s own
//    ENV_PREFIX exists). Proving "no Anthropic call" instead means
//    watching for a real `claude` process under this account for the
//    whole window the wake is running, via `pgrep`.
// 4. `codex exec` has no "run this literal command, bypass the model"
//    form -- its only positional argument is a prompt (the `<COMMAND>
//    [ARGS]` alternate usage line in `codex exec --help` names its
//    *subcommands* -- resume/fork/review/help -- not an arbitrary shell
//    command). The sandbox probe now asks Codex, in a narrow prompt, to
//    run the deterministic probe script and relay its exact output --
//    trusted the same way every other Codex tool-call transcript in this
//    project already is, not a hard sandbox bypass.
// 5. Every gathering step is wrapped so a thrown error becomes evidence
//    (an error string) rather than aborting before the closer ever runs --
//    the one invariant worth protecting is "something always reaches
//    Linear," even when the mechanical half fails outright.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareServerEnvironment } from './julia-run.mjs';

const execFileAsync = promisify(execFile);

const ORCHESTRATOR_ENVIRONMENT = 'orchestrator-local';
const CHECKOUT = '/srv/orchestrator-svc/julia-next';
const PUBLISHER_ENV_FILE = '/etc/orchestrator-svc/.env.publisher';
const DISPATCH_ENVIRONMENT = 'ovh-local';
const ISSUE_ID = 'JUL-76';
const WAIT_INTERVAL_MS = 10_000;
const MAX_WAIT_POLLS = 60; // ~10 minutes -- a cold Codex start plus a full coordinator wake

const ENV_PREFIX = `export ORCA_BIN=/opt/Orca/orca-ide ORCA_ENVIRONMENT=${DISPATCH_ENVIRONMENT}; set -a; . ${PUBLISHER_ENV_FILE}; set +a;`;

function defaultWait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// See file header, point 4. Codex relays the probe script's own stdout
// verbatim when asked narrowly and explicitly for exactly that -- this is
// a live-model call, not a sandbox bypass, and is described as such.
export function buildSandboxProbeCommand() {
  return `${ENV_PREFIX} cd ${CHECKOUT} && codex exec -s danger-full-access --skip-git-repo-check "Run exactly this command and reply with nothing but its raw stdout, no commentary before or after: node scripts/jul73-codex-sandbox-probe.mjs"`;
}

export function buildCodexAcceptanceCommand() {
  return `export ORCHESTRATOR_VENDOR=codex; cd ${CHECKOUT} && node scripts/julia-run.mjs ${ISSUE_ID}`;
}

async function pollForMarker({
  terminalHandle, markerRegex, terminalReadImpl, waitImpl, maxPolls,
}) {
  let tail = '';
  for (let i = 0; i < maxPolls; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const read = await terminalReadImpl({ environment: ORCHESTRATOR_ENVIRONMENT, terminal: terminalHandle });
    tail = (read.terminal.tail ?? []).join('\n');
    if (markerRegex.test(tail)) return tail;
    // eslint-disable-next-line no-await-in-loop
    await waitImpl(WAIT_INTERVAL_MS);
  }
  return tail;
}

export async function runCodexSandboxProbe({
  terminalCreateImpl, terminalReadImpl, waitImpl = defaultWait, maxPolls = MAX_WAIT_POLLS,
}) {
  const created = await terminalCreateImpl({
    environment: ORCHESTRATOR_ENVIRONMENT,
    worktree: `path:${CHECKOUT}`,
    command: buildSandboxProbeCommand(),
    title: 'jul73-quota-reset-sandbox-probe',
  });

  const tail = await pollForMarker({
    terminalHandle: created.terminal.handle,
    markerRegex: /\{"publisherReadable":\s*(?:true|false)/,
    terminalReadImpl,
    waitImpl,
    maxPolls,
  });

  const match = tail.match(/\{"publisherReadable":\s*(true|false),\s*"orcaReachable":\s*(true|false)\}/);
  if (!match) {
    // No parseable result -- most likely Codex itself couldn't run at all
    // (e.g. still walled), or relayed commentary instead of raw output.
    // Fail closed: never report a pass just because it didn't clearly fail.
    return {
      publisherReadable: false, orcaReachable: false, raw: tail, terminalHandle: created.terminal.handle,
    };
  }
  return {
    publisherReadable: match[1] === 'true',
    orcaReachable: match[2] === 'true',
    raw: match[0],
    terminalHandle: created.terminal.handle,
  };
}

// `orca terminal list` has no built-in filter by title, so this fetches
// the full list and searches -- acceptable at this account's terminal
// volume (dozens, not thousands) and avoids a second orca-cli.mjs export
// for a single one-off caller.
export async function findCoordinatorTerminal({ issueId, execImpl, orcaBin = '/opt/Orca/orca-ide' }) {
  const { stdout } = await execImpl(orcaBin, ['terminal', 'list', '--environment', ORCHESTRATOR_ENVIRONMENT, '--json']);
  const parsed = JSON.parse(stdout);
  const wantedTitle = `julia-run-${issueId}`;
  const matches = (parsed.result?.terminals ?? []).filter((t) => t.title === wantedTitle);
  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.lastOutputAt ?? 0) - (a.lastOutputAt ?? 0));
  return matches[0];
}

// Watches for two things over the same window, since a short-lived process
// between polls would otherwise be missed if this ran sequentially after
// the wait instead of alongside it: (1) the coordinator terminal actually
// finishing (its own shell prompt returning -- `julia-run.mjs`'s exit code
// only proves dispatch succeeded, not that a wake ran), and (2) whether a
// `claude` process ever ran under this account meanwhile (the real
// "no Anthropic call" check -- a PATH shim on the dispatching process
// cannot see a process that starts in a different Orca terminal).
export async function waitForWakeAndWatchForClaude({
  issueId = ISSUE_ID,
  terminalReadImpl,
  execImpl,
  waitImpl = defaultWait,
  maxPolls = MAX_WAIT_POLLS,
  findCoordinatorTerminalImpl = findCoordinatorTerminal,
}) {
  const claudeSightings = [];
  let terminal = null;
  let finished = false;
  let output = '';

  for (let i = 0; i < maxPolls; i += 1) {
    if (!terminal) {
      // eslint-disable-next-line no-await-in-loop
      terminal = await findCoordinatorTerminalImpl({ issueId, execImpl });
    }
    if (terminal) {
      // eslint-disable-next-line no-await-in-loop
      const read = await terminalReadImpl({ environment: ORCHESTRATOR_ENVIRONMENT, terminal: terminal.handle });
      output = (read.terminal.tail ?? []).join('\n');
      // The launched process's own shell prompt reappearing on its own
      // line is the end marker -- not a single immediate read, and not
      // `terminalWait --for tui-idle` (both proven unreliable live, see
      // the runbook's Journey accounting section and JUL-76's own report).
      const lines = output.split('\n');
      if (/\$\s*$/.test(lines[lines.length - 1] ?? '')) {
        finished = true;
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const sighting = await checkForClaudeProcess({ execImpl });
    if (sighting) claudeSightings.push(sighting);

    if (finished) break;
    // eslint-disable-next-line no-await-in-loop
    await waitImpl(WAIT_INTERVAL_MS);
  }

  return {
    finished, output, claudeSeen: claudeSightings.length > 0, claudeSightings, terminalHandle: terminal?.handle ?? null,
  };
}

export async function checkForClaudeProcess({ execImpl }) {
  try {
    const { stdout } = await execImpl('pgrep', ['-u', 'orchestrator-svc', '-a', 'claude']);
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    // pgrep exits non-zero when nothing matches -- that is the good case,
    // not an error.
    return null;
  }
}

export async function dispatchCodexAcceptanceRun({ terminalCreateImpl }) {
  const created = await terminalCreateImpl({
    environment: ORCHESTRATOR_ENVIRONMENT,
    worktree: `path:${CHECKOUT}`,
    command: buildCodexAcceptanceCommand(),
    title: 'jul73-quota-reset-dispatch',
  });
  return created.terminal.handle;
}

// Every gathering step is wrapped so a thrown error becomes evidence (an
// error string in the result) rather than aborting before the closer ever
// runs -- see file header, point 5.
async function gather(label, fn) {
  try {
    return await fn();
  } catch (error) {
    return { error: `${label} threw: ${error.message}` };
  }
}

export function buildCloserPrompt({ sandboxProbe, acceptanceRun, sinceIso }) {
  return `You are the JUL-73 quota-reset closer. This is a one-shot follow-up dispatched by a systemd timer 15 minutes after Codex's usage cap reset, mechanically gathered outside any LLM except for two live Codex calls whose full transcripts are included below. Do not repeat the mechanical dispatch yourself -- verify and act on the evidence below. Follow this repo's "Todd's queue" reporting convention (.claude/skills/julia-coordinator/SKILL.md) for your Linear comments, including the \`For Todd:\` trailer and \`WAITING ON YOU:\` only if something genuinely needs a decision.

Mechanical evidence, gathered just now (since ${sinceIso}):

Sandbox probe (asked Codex, in a narrow prompt, to run scripts/jul73-codex-sandbox-probe.mjs and relay its raw stdout):
${JSON.stringify(sandboxProbe, null, 2)}

Codex acceptance run (ORCHESTRATOR_VENDOR=codex julia-run JUL-76, watched for the whole wait window for both the dispatched coordinator terminal finishing and any \`claude\` process running under orchestrator-svc):
${JSON.stringify(acceptanceRun, null, 2)}

Your job:
1. Independently verify via the Linear MCP tool whether issue JUL-76 received a fresh comment from a codex-vendor orchestrator wake with a timestamp at or after ${sinceIso}. Read the comment's own content to confirm it is a real coordinator wake report (reconcile, admission or starvation reasoning), not something unrelated.
2. Cross-check that against the mechanical evidence above. All of these must hold for a PASS: sandboxProbe.publisherReadable=true, sandboxProbe.orcaReachable=true, acceptanceRun.finished=true, acceptanceRun.claudeSeen=false, and a genuine fresh Linear comment on JUL-76 from this run. If the coordinator terminal's own output (acceptanceRun.output) shows an error (e.g. Codex's own usage limit again), that is a FAIL regardless of the other fields.
3. On PASS: post the full evidence (mechanical evidence above plus your own Linear read, and the terminal output) as a comment on JUL-73, then set JUL-73 to Done and close JUL-75 and JUL-76 (Cancelled, as throwaway issues). Then start a fresh Orca terminal on the orchestrator-local environment (worktree path:${CHECKOUT}) running \`node scripts/julia-run.mjs JUL-44\` via the bare \`orca\` CLI (\`orca terminal create --environment orchestrator-local --worktree "path:${CHECKOUT}" --command "node scripts/julia-run.mjs JUL-44" --title julia-run-JUL-44\`) -- this is the real next work, now that JUL-73 is fully proven both ways.
4. On FAIL: post a comment on JUL-73 naming exactly which check failed, quoting the relevant piece of the mechanical evidence above (including terminal output/claude sightings, not just true/false), and what it left behind (an Orca run/terminal still worth inspecting, if any). Leave JUL-73, JUL-75 and JUL-76 open. Do not start JUL-44. No retry -- this is a one-shot follow-up; a future explicit relaunch is a human decision, not this script's.
5. If you cannot complete either branch (e.g. your own Linear access fails), still leave a comment somewhere you can reach explaining exactly what happened, so this is never a silent no-op.`;
}

export async function runCloser({ execImpl = execFileAsync, prompt }) {
  const { stdout } = await execImpl('claude', [
    '-p', prompt,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'mcp__linear__*,mcp__claude_ai_Linear__*,Bash(orca *)',
    '--output-format', 'json',
  ], {
    cwd: CHECKOUT,
    maxBuffer: 10 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  if (result.is_error || (result.permission_denials ?? []).length > 0) {
    throw new Error(`closer step failed: ${result.result ?? JSON.stringify(result.permission_denials)}`);
  }
  return result;
}

export async function main({
  terminalCreateImpl,
  terminalReadImpl,
  execImpl = execFileAsync,
  waitImpl = defaultWait,
  runCloserImpl = (prompt) => runCloser({ prompt }),
  prepareServerEnvironmentImpl = prepareServerEnvironment,
} = {}) {
  prepareServerEnvironmentImpl();
  const sinceIso = new Date().toISOString();

  const sandboxProbe = await gather('sandbox probe', () => runCodexSandboxProbe({ terminalCreateImpl, terminalReadImpl, execImpl, waitImpl }));

  await gather('acceptance dispatch', () => dispatchCodexAcceptanceRun({ terminalCreateImpl }));
  const acceptanceRun = await gather('acceptance wait', () => waitForWakeAndWatchForClaude({ terminalReadImpl, execImpl, waitImpl }));

  const prompt = buildCloserPrompt({ sandboxProbe, acceptanceRun, sinceIso });
  const closerResult = await runCloserImpl(prompt);

  return {
    sandboxProbe, acceptanceRun, ranCloser: true, closerResult,
  };
}

async function cli() {
  try {
    const { closerResult } = await main({
      terminalCreateImpl: (await import('./orca-cli.mjs')).terminalCreate,
      terminalReadImpl: (await import('./orca-cli.mjs')).terminalRead,
    });
    console.log(JSON.stringify(closerResult));
  } catch (error) {
    // Never thrown past this point in practice (main()'s gather() wrapper
    // and runCloser's own try/catch inside the prompt instructions are the
    // real safety net) -- but if it somehow is, log loudly: journald keeps
    // this unit's log lines searchable by name even after the unit files
    // are removed (`journalctl -u jul73-quota-reset.service`).
    console.error(`jul73-quota-reset-run.mjs crashed before the closer could run: ${error.message}`);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}
