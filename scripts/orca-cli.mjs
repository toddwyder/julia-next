// orca-cli.mjs -- thin wrapper around the `orca` CLI, the dispatch mechanism
// the julia-coordinator skill (.claude/skills/julia-coordinator/SKILL.md)
// uses for every Run, Task, worker, and diagnostic terminal. Every flag
// shape here was checked against the real installed CLI's own
// `orca <command> --help` output (2026-09-16), not guessed or reconstructed
// from memory. If the CLI's flags change again, that surfaces as a clear
// "orca ... did not return valid JSON" or stderr-carrying failure below,
// not a silent wrong result.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
// No personal-machine fallback path here on purpose (retro finding, JUL-61
// closing pass): a hardcoded laptop path silently produces a raw ENOENT on
// any other machine instead of an actionable error -- caught live when a
// fresh session tried this on the OVH server. Every caller must set
// ORCA_BIN for its own environment (the laptop's orca.exe, or
// /opt/Orca/orca-ide on the server -- see the runbook's local-pairing
// section).
function requireOrcaBin() {
  const bin = process.env.ORCA_BIN;
  if (!bin) {
    throw new Error('ORCA_BIN is not set -- point it at this machine\'s orca binary (e.g. the laptop\'s orca.exe, or /opt/Orca/orca-ide on the server)');
  }
  return bin;
}

// Every orchestration/terminal command's real --json output wraps its
// payload as {id, ok, result, _meta} and reports failure as
// {id, ok:false, error:{code, message}} -- confirmed live against the
// installed CLI (2026-09-16), not documented in its --help text. run()
// unwraps that envelope once here so every exported function below returns
// the payload callers actually want, and a structured failure surfaces its
// real code/message instead of an undefined field read downstream.
// Confirmed live (JUL-43 PR #3 review, finding C1): a real Orca failure
// such as `orchestration worker-show --dispatch <missing>` exits nonzero
// with its structured {ok:false, error:{code,message}} body on STDOUT, not
// stderr -- so a rejected execFile call still carries the real diagnostic
// on error.stdout, and must be checked before falling back to raw stderr.
function parseStructuredFailure(stdoutText) {
  const text = String(stdoutText ?? '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.ok === false) {
      const { code, message } = parsed.error ?? {};
      return { code: code ?? 'unknown_error', message: message ?? 'no error message' };
    }
  } catch {
    // Not JSON -- fall through to the generic stderr-based error.
  }
  return null;
}

async function run(args, { execImpl = defaultExecImpl, bin = 'orca' } = {}) {
  let stdout;
  try {
    ({ stdout } = await execImpl(bin, args));
  } catch (error) {
    const structured = parseStructuredFailure(error.stdout);
    if (structured) {
      // JUL-98 step 2: the code travels ON the error, not only inside the
      // message. The controller branches on it (consumer_fenced -> stand down,
      // terminal_handle_stale -> replay with the request id the error names),
      // and parsing a sentence to find that out would be a guess.
      const failure = new Error(`orca ${args.join(' ')} failed (${structured.code}): ${structured.message}`);
      failure.code = structured.code;
      throw failure;
    }
    const detail = String(error.stderr || error.message || '').trim();
    throw new Error(`orca ${args.join(' ')} failed: ${detail}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`orca ${args.join(' ')} did not return valid JSON: ${stdout.slice(0, 200)}`);
  }
  if (parsed.ok === false) {
    const { code, message } = parsed.error ?? {};
    const failure = new Error(`orca ${args.join(' ')} failed (${code ?? 'unknown_error'}): ${message ?? 'no error message'}`);
    failure.code = code ?? 'unknown_error';
    throw failure;
  }
  return parsed.result;
}

async function defaultExecImpl(bin, args) {
  const resolvedBin = bin === 'orca' ? requireOrcaBin() : bin;
  return execFileAsync(resolvedBin, args, { maxBuffer: 10 * 1024 * 1024 });
}

// JUL-98 step 4: the generic entry point, for the commands the controller
// needs that have no named wrapper above (`orchestration check --wait`,
// `worker-release`, `worktree rm`, `worktree ps`) and for the ones that need
// `--retry-request`, Orca's own idempotency flag.
//
// It is exported rather than copied into graph/controller/wiring.mjs so that
// the envelope unwrapping, the `.code` on a structured failure, and the
// ORCA_BIN rule all keep exactly one home. Callers build the argv; everything
// about how an answer or a refusal is read stays here.
export async function orcaCall(args, { execImpl } = {}) {
  return run(args, { execImpl });
}

export async function runCreate({ environment, from, objective, execImpl } = {}) {
  return run(['orchestration', 'run-create', '--environment', environment, '--from', from, '--objective', objective, '--json'], { execImpl });
}

// Real shape confirmed live (JUL-63): {runs: [{id, objective,
// coordinator_handle, consumer_generation, legacy, created_at,
// updated_at}], nextCursor}. No status/active field -- a caller checking
// for an in-flight run has to match on objective, not a lifecycle state
// this endpoint doesn't expose.
export async function runList({ environment, limit, cursor, execImpl } = {}) {
  const args = ['orchestration', 'run-list', '--environment', environment, '--json'];
  if (limit !== undefined) args.push('--limit', String(limit));
  if (cursor !== undefined) args.push('--cursor', cursor);
  return run(args, { execImpl });
}

export async function workerStart({
  run: runId, environment, from, spec, worktree, name, repo, agent = 'codex', setup = 'skip', execImpl,
} = {}) {
  // Installed `orca orchestration worker-start --help` explicitly says
  // "Use exact --repo on the selected server" for new-worktree creation --
  // this worked by inference while julia-next was the only registered
  // project, but that breaks silently the moment a second one exists
  // (fix-verification review, C2 residual). Required, not defaulted.
  if (!repo) {
    throw new Error('workerStart requires an explicit repo selector (e.g. "path:/home/runner/julia-next") -- it is not inferred');
  }
  return run([
    'orchestration', 'worker-start',
    '--environment', environment,
    '--run', runId,
    '--from', from,
    '--spec', spec,
    '--worktree', worktree,
    '--name', name,
    '--repo', repo,
    '--agent', agent,
    '--setup', setup,
    '--json',
  ], { execImpl });
}

// JUL-70: the restart guard needs to tell a still-in-progress run from a
// finished one. task-list --run <id> is the call SKILL.md's own
// "Reconcile" step already names for exactly this kind of query. Real
// task status vocabulary confirmed only partially live so far (`ready`,
// `completed`, `failed`, `stopped` appear in the installed CLI's own
// error-recovery text -- see docs/research/jul61-orca-orchestration-source.txt);
// treat any status outside that terminal set as still active.
export async function taskList({ environment, runId, execImpl } = {}) {
  return run(['orchestration', 'task-list', '--run', runId, '--environment', environment, '--json'], { execImpl });
}

export async function terminalWait({ environment, terminal, forState = 'tui-idle', timeoutMs, execImpl } = {}) {
  return run(['terminal', 'wait', '--environment', environment, '--terminal', terminal, '--for', forState, '--timeout-ms', String(timeoutMs), '--json'], { execImpl });
}

export async function workerShow({ environment, dispatch, execImpl } = {}) {
  return run(['orchestration', 'worker-show', '--environment', environment, '--dispatch', dispatch, '--json'], { execImpl });
}

export async function workerAbandon({ environment, dispatch, execImpl } = {}) {
  return run(['orchestration', 'worker-abandon', '--environment', environment, '--dispatch', dispatch, '--json'], { execImpl });
}

// A plain shell command, not a supervised agent worker -- used for
// diagnostics (readiness checks) and for emitting coordinator-events.mjs
// from inside the OVH runner itself, the one place that can reach the
// journey-relay's loopback binding (127.0.0.1:8943). Never used for agent
// dispatch; worker-start is the supervised path for that.
export async function terminalCreate({
  environment, worktree, command, title, execImpl,
} = {}) {
  return run([
    'terminal', 'create',
    '--environment', environment,
    '--worktree', worktree,
    '--command', command,
    '--title', title,
    '--json',
  ], { execImpl });
}

// The liveness check for a terminal handle. Recorded live against 1.4.205
// (graph/fixtures/orca-1.4.205/terminal-show.plain-diagnostic-live.json): a
// handle Orca still knows answers `result.terminal` with `connected` and
// `orphaned`; a handle it no longer knows is refused with
// `terminal_handle_stale` (terminal-show.unknown-handle.error.json), which
// run() above turns into an Error carrying `.code`.
export async function terminalShow({ environment, terminal, execImpl } = {}) {
  return run(['terminal', 'show', '--environment', environment, '--terminal', terminal, '--json'], { execImpl });
}

export async function terminalRead({ environment, terminal, execImpl } = {}) {
  return run(['terminal', 'read', '--environment', environment, '--terminal', terminal, '--json'], { execImpl });
}

// A real CLI entry point for the Orca run/task lookups (JUL-79 step 6).
// The unattended coordinator previously had no ready-made repo command for
// these, so it wrote a tiny inline script that was not on its --allowedTools
// list and stalled with nobody able to approve the prompt. Every command
// here is a thin passthrough over the exported functions above -- it adds
// argv parsing, the ORCA_ENVIRONMENT fallback, pretty JSON on stdout and a
// controlled non-zero exit on bad input or an Orca failure, and nothing else.
const USAGE = {
  'run-list': 'usage: orca-cli.mjs run-list [--environment <env>] [--limit <n>] [--cursor <c>]',
  'task-list': 'usage: orca-cli.mjs task-list --run <runId> [--environment <env>]',
  'worker-show': 'usage: orca-cli.mjs worker-show --dispatch <dispatchId> [--environment <env>]',
};
const USAGE_ROOT = 'usage: orca-cli.mjs <run-list|task-list|worker-show> [options]';

// Distinct from an Orca failure so the exit code can tell the two apart
// (2 = bad argv, matching the other repo CLIs like linear-cli.mjs; 1 = the
// Orca call itself failed).
class UsageError extends Error {}

function parseFlags(args, allowed, usage) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      throw new UsageError(usage);
    }
    const name = arg.slice(2);
    if (!allowed.includes(name)) {
      throw new UsageError(usage);
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(usage);
    }
    flags[name] = value;
    i += 1;
  }
  return flags;
}

function resolveEnvironment(flags, env, usage) {
  const environment = flags.environment ?? env.ORCA_ENVIRONMENT;
  if (!environment) {
    throw new UsageError(usage);
  }
  return environment;
}

// main() takes every dependency as an injectable default so the CLI can be
// tested against a fake exec and captured streams -- the real orca binary is
// never spawned from a test. Called bare by the guard at the bottom of this
// file, where the defaults are the real process argv/env/stdio/exitCode.
export async function main({
  argv = process.argv.slice(2),
  execImpl,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => { process.exitCode = code; },
} = {}) {
  const [command, ...rest] = argv;
  const usage = USAGE[command];
  if (!usage) {
    stderr.write(`${USAGE_ROOT}\n`);
    setExitCode(2);
    return;
  }
  try {
    let payload;
    if (command === 'run-list') {
      const flags = parseFlags(rest, ['environment', 'limit', 'cursor'], usage);
      payload = await runList({
        environment: resolveEnvironment(flags, env, usage),
        limit: flags.limit,
        cursor: flags.cursor,
        execImpl,
      });
    } else if (command === 'task-list') {
      const flags = parseFlags(rest, ['run', 'environment'], usage);
      if (!flags.run) throw new UsageError(usage);
      payload = await taskList({
        runId: flags.run,
        environment: resolveEnvironment(flags, env, usage),
        execImpl,
      });
    } else {
      const flags = parseFlags(rest, ['dispatch', 'environment'], usage);
      if (!flags.dispatch) throw new UsageError(usage);
      payload = await workerShow({
        dispatch: flags.dispatch,
        environment: resolveEnvironment(flags, env, usage),
        execImpl,
      });
    }
    // The exported function already returns the unwrapped payload; print it
    // as-is (pretty JSON), never the Orca {id, ok, result, _meta} envelope.
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    setExitCode(0);
  } catch (error) {
    // A usage error and a real Orca failure both go to stderr as one line;
    // only the exit code differs (2 vs 1). Never a raw stack trace.
    stderr.write(`${error.message}\n`);
    setExitCode(error instanceof UsageError ? 2 : 1);
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
