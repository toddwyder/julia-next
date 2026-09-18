#!/usr/bin/env node
// jul73-quota-reset-run.mjs -- JUL-73: fired once by the jul73-quota-reset
// systemd timer, 15 minutes after the Codex account's own usage cap resets
// (2026-09-19 19:28 UTC), to finish the one acceptance leg the quota wall
// blocked: proving a codex-vendor orchestrator can complete a real wake and
// post to Linear through julia-run.mjs itself, not just reach the model.
//
// Runs as orchestrator-svc (the systemd unit sudo's to this account -- see
// ops/jul73-quota-reset/). No LINEAR_API_KEY here: this script only
// dispatches and gathers mechanical evidence (Orca terminals, a shim log, a
// deterministic sandbox probe); every Linear read/write, and the actual
// pass/fail call, is made by a single `claude -p` "closer" step at the end
// -- the same live-agent-session pattern every other Linear write in this
// repo uses, and the one vendor guaranteed not to be the thing under test.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtempSync, writeFileSync, chmodSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminalCreate, terminalRead } from './orca-cli.mjs';

const execFileAsync = promisify(execFile);

const ORCHESTRATOR_ENVIRONMENT = 'orchestrator-local';
const CHECKOUT = '/srv/orchestrator-svc/julia-next';
const PUBLISHER_ENV_FILE = '/etc/orchestrator-svc/.env.publisher';
const DISPATCH_ENVIRONMENT = 'ovh-local';
const ISSUE_ID = 'JUL-76';

const ENV_PREFIX = `export ORCA_BIN=/opt/Orca/orca-ide ORCA_ENVIRONMENT=${DISPATCH_ENVIRONMENT}; set -a; . ${PUBLISHER_ENV_FILE}; set +a;`;

export function defaultMakeShim({ mkdtempImpl = mkdtempSync, writeFileImpl = writeFileSync, chmodImpl = chmodSync } = {}) {
  const dir = mkdtempImpl(join(tmpdir(), 'jul73-shim-'));
  const logPath = join(dir, 'claude-shim.log');
  writeFileImpl(logPath, '');
  writeFileImpl(join(dir, 'claude'), `#!/bin/bash\necho "SHIM INVOKED: $0 $@" >> ${logPath}\nexit 1\n`);
  chmodImpl(join(dir, 'claude'), 0o755);
  return { dir, logPath };
}

// `codex exec -- <command> [args]` runs the command directly under Codex's
// own sandbox rather than sending it to the model as a prompt to interpret
// or relay -- exactly what a deterministic sandbox-permission check needs:
// a pass/fail here reflects Codex's own sandbox, not this outer process,
// and not the model's paraphrase of some output.
export function buildSandboxProbeCommand() {
  return `${ENV_PREFIX} cd ${CHECKOUT} && codex exec -s danger-full-access --skip-git-repo-check -- node scripts/jul73-codex-sandbox-probe.mjs`;
}

export function buildCodexAcceptanceCommand(shimDir) {
  return `export PATH=${shimDir}:$PATH ORCHESTRATOR_VENDOR=codex; cd ${CHECKOUT} && node scripts/julia-run.mjs ${ISSUE_ID}; echo "JUL73_EXIT:$?"`;
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
    await waitImpl(10_000);
  }
  return tail;
}

// A single immediate read, or trusting `terminalWait --for tui-idle`, both
// race the command's own completion (JUL-61's own finding, and JUL-76's
// coordinator hit the opposite version of the same problem live) -- poll
// for an explicit end marker printed by the dispatched command itself.
export async function runCodexSandboxProbe({
  terminalCreateImpl = terminalCreate,
  terminalReadImpl = terminalRead,
  waitImpl = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  maxPolls = 12,
} = {}) {
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
    // (e.g. still walled). Fail closed: this must never be reported as a
    // pass just because it didn't clearly fail.
    return { publisherReadable: false, orcaReachable: false, raw: tail };
  }
  return { publisherReadable: match[1] === 'true', orcaReachable: match[2] === 'true', raw: match[0] };
}

export async function runCodexAcceptanceRun({
  terminalCreateImpl = terminalCreate,
  terminalReadImpl = terminalRead,
  waitImpl = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  readFileImpl = (path) => readFileSync(path, 'utf8'),
  makeShimImpl = defaultMakeShim,
  shimDir,
  logPath,
  maxPolls = 12,
} = {}) {
  let dir = shimDir;
  let log = logPath;
  if (!dir) {
    ({ dir, logPath: log } = makeShimImpl());
  }

  const created = await terminalCreateImpl({
    environment: ORCHESTRATOR_ENVIRONMENT,
    worktree: `path:${CHECKOUT}`,
    command: buildCodexAcceptanceCommand(dir),
    title: 'jul73-quota-reset-acceptance-run',
  });

  const tail = await pollForMarker({
    terminalHandle: created.terminal.handle,
    markerRegex: /JUL73_EXIT:\d+/,
    terminalReadImpl,
    waitImpl,
    maxPolls,
  });

  const exitMatch = tail.match(/JUL73_EXIT:(\d+)/);
  const juliaRunExitCode = exitMatch ? Number(exitMatch[1]) : null;

  let shimLog = '';
  try {
    shimLog = readFileImpl(log);
  } catch {
    shimLog = '';
  }

  return {
    juliaRunExitCode,
    shimInvoked: shimLog.trim().length > 0,
    shimLog,
    output: tail,
  };
}

export function buildCloserPrompt({ sandboxProbe, acceptanceRun, sinceIso }) {
  return `You are the JUL-73 quota-reset closer. This is a one-shot follow-up dispatched by a systemd timer 15 minutes after Codex's usage cap reset, mechanically gathered outside any LLM. Do not repeat the mechanical dispatch yourself -- verify and act on the evidence below.

Mechanical evidence, gathered just now (since ${sinceIso}):
- Sandbox probe (codex exec -s danger-full-access running scripts/jul73-codex-sandbox-probe.mjs directly, no LLM involved in the check itself): publisherReadable=${sandboxProbe.publisherReadable}, orcaReachable=${sandboxProbe.orcaReachable} (raw: ${sandboxProbe.raw ?? '(n/a)'})
- Codex acceptance run (ORCHESTRATOR_VENDOR=codex julia-run JUL-76, with a claude shim on PATH that logs any invocation and exits non-zero): juliaRunExitCode=${acceptanceRun.juliaRunExitCode}, shimInvoked=${acceptanceRun.shimInvoked}

Your job:
1. Independently verify via the Linear MCP tool whether issue JUL-76 received a fresh comment from a codex-vendor orchestrator wake with a timestamp at or after ${sinceIso}. Read the comment's own content to confirm it is a real coordinator wake report, not something else.
2. Cross-check that against the mechanical evidence above. All of these must hold for a PASS: publisherReadable=true, orcaReachable=true, juliaRunExitCode=0, shimInvoked=false, and a genuine fresh Linear comment on JUL-76 from this run.
3. On PASS: post the full evidence (mechanical + your own Linear read) as a comment on JUL-73, then set JUL-73 to Done and close JUL-75 and JUL-76 (Cancelled, as throwaway issues). Then start a fresh Orca terminal on the orchestrator-local environment (worktree path:/srv/orchestrator-svc/julia-next) running \`node scripts/julia-run.mjs JUL-44\` -- this is the real next work, now that JUL-73 is fully proven both ways.
4. On FAIL: post a comment on JUL-73 naming exactly which check failed and what it left behind (do not paper over a partial pass). Leave JUL-73, JUL-75 and JUL-76 open. Do not start JUL-44. No retry -- this is a one-shot follow-up; a future explicit relaunch is a human decision, not this script's.
5. Either way, end your comment's "For Todd:" section with WAITING ON YOU only if something genuinely needs his decision; otherwise "nothing".`;
}

export async function runCloser({ execImpl = execFileAsync, prompt } = {}) {
  const { stdout } = await execImpl('claude', [
    '-p', prompt,
    '--allowedTools', 'mcp__linear__*,mcp__claude_ai_Linear__*,Bash(node scripts/orca-cli.mjs:*),Bash(orca *)',
    '--output-format', 'json',
  ]);
  const result = JSON.parse(stdout);
  if (result.is_error || (result.permission_denials ?? []).length > 0) {
    throw new Error(`closer step failed: ${result.result ?? JSON.stringify(result.permission_denials)}`);
  }
  return result;
}

export async function main({
  runCodexSandboxProbeImpl = runCodexSandboxProbe,
  runCodexAcceptanceRunImpl = runCodexAcceptanceRun,
  runCloserImpl = (prompt) => runCloser({ prompt }),
  makeShimImpl = defaultMakeShim,
} = {}) {
  const sinceIso = new Date().toISOString();
  const { dir, logPath } = makeShimImpl();

  const [sandboxProbe, acceptanceRun] = await Promise.all([
    runCodexSandboxProbeImpl(),
    runCodexAcceptanceRunImpl({ shimDir: dir, logPath }),
  ]);

  const prompt = buildCloserPrompt({ sandboxProbe, acceptanceRun, sinceIso });
  const closerResult = await runCloserImpl(prompt);

  return {
    sandboxProbe, acceptanceRun, ranCloser: true, closerResult,
  };
}

async function cli() {
  try {
    const { closerResult } = await main();
    console.log(JSON.stringify(closerResult));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}
