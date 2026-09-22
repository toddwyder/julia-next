// run-agy-seat.mjs -- launches Antigravity CLI (agy, the Gemini builder
// trial) headless via `agy --print`, in a plain terminal -- the same shape
// run-pi-seat.mjs already uses for DeepSeek/Pi -- instead of through Orca's
// `worker-start`/terminal-adopt orchestration.
//
// Why: JUL-98/JUL-100 found Orca's adopt route deterministically fails at its
// own `agent_readiness` stage for this provider (`state: failed, stage:
// agent_readiness, lastError: timeout`), reproduced live and on demand on
// 2026-09-22 -- with the worktree pre-trusted, agy itself healthy (confirmed
// both by reading the adopted terminal's rendered screen and by a direct
// `agy --print` call succeeding instantly outside Orca), and Orca's own local
// agent-hook HTTP listener answering in milliseconds. The gate lives inside
// Orca's closed-source binary; the only fix available to this repo is to stop
// depending on it. A plain `agy --print` call needs no adopt, no terminal
// hand-over, and therefore no `agent_readiness` gate at all.
//
// agy authenticates via its own stored OAuth subscription token (Google AI
// Pro -- confirmed live: the CLI's own banner reads "(Google AI Pro)"), not a
// drop-box API key, so unlike run-pi-seat.mjs there is no secret to inject
// into the child's environment. Running this way still draws on that
// existing subscription, not a metered API key -- no new spend.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

export const EFFORT_LEVELS = ['low', 'medium', 'high'];
export const DEFAULT_EFFORT = 'medium';

export function normalizeEffort(effort) {
  return EFFORT_LEVELS.includes(effort) ? effort : DEFAULT_EFFORT;
}

// Pure: the argv array for a headless agy turn. `--print` (like Pi's `-p`) is
// variadic -- it reads the very next argv entry as its value -- so it must be
// the LAST flag, immediately followed by the prompt, or a later flag gets
// swallowed as the prompt instead (live-reproduced: `--print` followed by
// `--output-format` took the flag text itself as the prompt). Verified live
// that a prompt beginning with `---` (a coordinator skill's own front matter)
// is unaffected -- spawn's argv array is exec-level, not shell-parsed, so
// there is no `--`-separator trap here the way Pi's `-p` has.
export function buildAgySpawnSpec(prompt, { effort = DEFAULT_EFFORT, model, cwd, printTimeout = '0' } = {}) {
  const level = normalizeEffort(effort);
  const args = [
    '--output-format', 'json',
    '--print-timeout', printTimeout,
    '--dangerously-skip-permissions',
    '--effort', level,
  ];
  if (model) args.push('--model', model);
  args.push('--print', prompt);
  return { command: 'agy', args, options: cwd ? { cwd } : {} };
}

export function runAgySeat(prompt, { spawnImpl = spawn, spawnOpts, ...specOpts } = {}) {
  const spec = buildAgySpawnSpec(prompt, specOpts);
  return spawnImpl(spec.command, spec.args, { ...spec.options, ...(spawnOpts || {}) });
}

// agy's `--output-format json` prints exactly one JSON object once the turn
// ends (not an NDJSON stream like Pi's `--mode json`), and -- unlike the
// adopt route, which has no per-session token record for this provider at
// all -- it carries real usage. Closes that gap as a side effect of the fix.
export function parseAgyJsonResult(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch {
    return { ok: false, errorText: 'agy did not print a parseable JSON result', usage: null, response: null };
  }
  if (parsed?.status !== 'SUCCESS') {
    const errorText = parsed?.error ?? parsed?.response ?? `agy status: ${parsed?.status ?? 'unknown'}`;
    return { ok: false, errorText, usage: parsed?.usage ?? null, response: parsed?.response ?? null };
  }
  return { ok: true, errorText: null, usage: parsed.usage ?? null, response: parsed.response ?? null };
}

// Watch a spawned agy child to completion: tee stdout through unchanged, then
// turn a non-SUCCESS result into a non-zero exit with the reason on stderr --
// same shape as supervisePiSeat, so a caller driving either seat behaves the
// same way.
export function superviseAgySeat(child, { stdout = process.stdout, stderr = process.stderr } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let exited = false;
    let exitCode = null;
    let stdoutDone = !child.stdout;
    let settled = false;

    const finalize = () => {
      if (settled || !exited || !stdoutDone) return;
      settled = true;
      const { ok, errorText } = parseAgyJsonResult(output);
      if (!ok) {
        stderr.write(`${errorText}\n`);
        resolve(exitCode && exitCode !== 0 ? exitCode : 1);
        return;
      }
      resolve(exitCode ?? 1);
    };

    const onExit = (code) => {
      exited = true;
      exitCode = code;
      finalize();
    };

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
      stdout.write(chunk);
    });
    child.stdout?.on('end', () => {
      stdoutDone = true;
      finalize();
    });
    child.stderr?.on('data', (chunk) => stderr.write(chunk));

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      stderr.write(`${error.message}\n`);
      resolve(1);
    });
    child.on('exit', onExit);
    child.on('close', onExit);
  });
}

// CLI entry: `{ cat BRIEF.md; } | node run-agy-seat.mjs [--effort low|medium|high] [--model NAME]`
// -- the prompt on stdin, exactly like run-pi-seat.mjs's own CLI entry, run
// from a plain Orca terminal in the target worktree (its cwd is the worktree
// already, so no --cwd is needed there).
export function readAllStdin({ readFileSyncImpl = readFileSync } = {}) {
  return readFileSyncImpl(0, 'utf8');
}

export function parseAgyArgs(argv) {
  let effort = DEFAULT_EFFORT;
  let model;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--effort') effort = argv[++i];
    else if (arg.startsWith('--effort=')) effort = arg.slice('--effort='.length);
    else if (arg === '--model') model = argv[++i];
    else if (arg.startsWith('--model=')) model = arg.slice('--model='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { effort, model };
}

async function main() {
  let parsed;
  try {
    parsed = parseAgyArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  const prompt = readAllStdin();
  const child = runAgySeat(prompt, {
    effort: parsed.effort,
    model: parsed.model,
    spawnOpts: { stdio: ['ignore', 'pipe', 'pipe'] },
  });
  process.exitCode = await superviseAgySeat(child);
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
