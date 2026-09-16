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
const DEFAULT_BIN = process.env.ORCA_BIN
  || 'C:\\Users\\toddw\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

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
      throw new Error(`orca ${args.join(' ')} failed (${structured.code}): ${structured.message}`);
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
    throw new Error(`orca ${args.join(' ')} failed (${code ?? 'unknown_error'}): ${message ?? 'no error message'}`);
  }
  return parsed.result;
}

async function defaultExecImpl(bin, args) {
  const resolvedBin = bin === 'orca' ? DEFAULT_BIN : bin;
  return execFileAsync(resolvedBin, args, { maxBuffer: 10 * 1024 * 1024 });
}

export async function runCreate({ environment, from, objective, execImpl } = {}) {
  return run(['orchestration', 'run-create', '--environment', environment, '--from', from, '--objective', objective, '--json'], { execImpl });
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

export async function terminalRead({ environment, terminal, execImpl } = {}) {
  return run(['terminal', 'read', '--environment', environment, '--terminal', terminal, '--json'], { execImpl });
}
