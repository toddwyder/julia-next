// orca-cli.mjs -- thin wrapper around the `orca` CLI, the dispatch mechanism
// JUL-43 has used throughout (see docs/agents/jul43-coordinator-runbook.md).
// Every call shape here matches command lines already run live earlier in
// this ticket (recorded in the JUL-43 Linear thread) -- not re-derived from
// `orca --help`, since reading the CLI's full help output was previously
// flagged by this environment's own safety layer as out of scope for an
// agent to probe. If the real CLI's flags have since changed, that will
// surface as a clear "orca ... did not return valid JSON" or stderr-carrying
// failure below, not a silent wrong result.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_BIN = process.env.ORCA_BIN
  || 'C:\\Users\\toddw\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

async function run(args, { execImpl = defaultExecImpl, bin = 'orca' } = {}) {
  let stdout;
  try {
    ({ stdout } = await execImpl(bin, args));
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim();
    throw new Error(`orca ${args.join(' ')} failed: ${detail}`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`orca ${args.join(' ')} did not return valid JSON: ${stdout.slice(0, 200)}`);
  }
}

async function defaultExecImpl(bin, args) {
  const resolvedBin = bin === 'orca' ? DEFAULT_BIN : bin;
  return execFileAsync(resolvedBin, args, { maxBuffer: 10 * 1024 * 1024 });
}

export async function runCreate({ environment, from, objective, execImpl } = {}) {
  return run(['orchestration', 'run-create', '--environment', environment, '--from', from, '--objective', objective, '--json'], { execImpl });
}

export async function workerStart({ run: runId, environment, from, spec, worktree, name, agent = 'codex', setup = 'skip', execImpl } = {}) {
  return run([
    'orchestration', 'worker-start',
    '--run', runId,
    '--environment', environment,
    '--from', from,
    '--spec', spec,
    '--worktree', worktree,
    '--name', name,
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
