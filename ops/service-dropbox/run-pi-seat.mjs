// run-pi-seat.mjs -- launches Pi for a backup seat (builder-on-DeepSeek,
// reviewer-on-DeepSeek-Pro, orchestrator-on-DeepSeek) with the seat's
// secret injected into the child process's environment only -- never as an
// argv entry, never interpolated into a shell string. See read-secret.mjs for
// why: JUL-72's incident was exactly a secret reaching a shell/argv position.
//
// JUL-79 step 3 adds an optional effort (Low/Medium/High, default Medium) to
// every seat, translated here to Pi's own spelling: Pi has no graded effort
// setting, only `--thinking` on/off, so Low is off and Medium/High are on.
// The launcher on the other side (scripts/julia-run.mjs) passes the neutral
// `--effort <level>` label, never a vendor flag, so this module stays the one
// place that knows how Pi spells it. Duplicating the low/medium/high default
// rule from scripts/effort.mjs is deliberate: the seat namespace here
// (`builder-backup`, `orchestrator-deepseek`) is not the seat-table entry
// namespace there (`pi-deepseek`), so the two maps cannot literally be one.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readSecret } from './read-secret.mjs';

export const EFFORT_LEVELS = ['low', 'medium', 'high'];
export const DEFAULT_EFFORT = 'medium';

export const SEATS = {
  'builder-backup': {
    envVar: 'DEEPSEEK_API_KEY',
    secretField: 'deepseek',
    piArgs: (mode) => ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '-p', '--mode', mode],
  },
  // The reviewer backup is DeepSeek Pro, through Command Code's GOAT plan
  // (JUL-98, Todd's 15:01:54Z Decision), not the native DeepSeek provider --
  // moved off Codex-as-primary-reviewer immediately, not after step 6
  // merges, once the 13:43Z probe on this card proved Command Code returns
  // real token counts for both DeepSeek models. The model id is namespaced
  // (`deepseek/deepseek-v4-pro`), confirmed live against Command Code's own
  // `/models` listing -- the bare `deepseek-v4-pro` id 400s with
  // `unsupported_model` on this endpoint. Routing needs the `commandcode`
  // provider entry in `runner`'s `~/.pi/agent/models.json` (canonical copy:
  // `ops/service-dropbox/pi-models.commandcode.json`) installed first.
  // It used to be GLM, which the cost rule bars (about $10 on one issue);
  // GLM has since been removed everywhere (JUL-93): no seat launches it.
  'reviewer-backup': {
    envVar: 'COMMANDCODE_API_KEY',
    secretField: 'commandcode',
    piArgs: (mode) => ['--provider', 'commandcode', '--model', 'deepseek/deepseek-v4-pro', '-p', '--mode', mode],
  },
  // The V4 Flash shadow (JUL-98, Todd's 13:43Z + 15:01:54Z Decisions):
  // dispatched by the coordinator alongside every real reviewer-backup
  // review, on the same candidate. It never decides anything -- its verdict
  // and cost line are recorded next to the real review's, nothing more --
  // and is what the 13:43Z Decision's Flash-vs-Pro comparison is built from
  // after ten paired reviews. Same provider and secret as reviewer-backup;
  // only the model differs.
  'reviewer-shadow-flash': {
    envVar: 'COMMANDCODE_API_KEY',
    secretField: 'commandcode',
    piArgs: (mode) => ['--provider', 'commandcode', '--model', 'deepseek/deepseek-v4-flash', '-p', '--mode', mode],
  },
  // The orchestrator's DeepSeek route (JUL-79 step 3, `pi-deepseek` in
  // graph/seat-table.mjs). Its config is byte-for-byte builder-backup's --
  // same native provider, model, secret field and env var -- and that
  // duplication is intentional: the seat NAME carries the semantics (an
  // orchestrator wake on DeepSeek), and a future change to one seat's model
  // must not silently move the other.
  'orchestrator-deepseek': {
    envVar: 'DEEPSEEK_API_KEY',
    secretField: 'deepseek',
    piArgs: (mode) => ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '-p', '--mode', mode],
  },
};

// Pi's effort spelling. `--thinking` REQUIRES a level (off|minimal|low|medium|
// high|xhigh|max; `pi --help`): a bare `--thinking` makes Pi read the next
// argv entry as the level, which is how the coordinator launch died in the
// JUL-79 relaunches (`-p` swallowed, prompt parsed as an option). Pi's own
// levels are graded, so the ticket's Low/Medium/High map to off/medium/high --
// Low is thinking off, Medium/High are on. Medium is the default for an
// omitted or unrecognized level -- never a throw, matching scripts/effort.mjs's
// own rule and the ticket's stated default.
const THINKING_LEVEL = { low: 'off', medium: 'medium', high: 'high' };
export function thinkingArgs(effort) {
  const level = EFFORT_LEVELS.includes(effort) ? effort : DEFAULT_EFFORT;
  return ['--thinking', THINKING_LEVEL[level]];
}

// Put the --thinking pair immediately before `-p`.
function withThinking(args, effort) {
  const extra = thinkingArgs(effort);
  const pIndex = args.indexOf('-p');
  const at = pIndex === -1 ? args.length : pIndex;
  return [...args.slice(0, at), ...extra, ...args.slice(at)];
}

export function buildPiSpawnSpec(seat, prompt, { mode = 'json', effort, readSecretImpl = readSecret } = {}) {
  const def = SEATS[seat];
  if (!def) {
    throw new Error(`buildPiSpawnSpec: unknown seat '${seat}' -- must be one of ${Object.keys(SEATS).join('|')}`);
  }
  return {
    command: 'pi',
    // The prompt (which can be the whole coordinator skill, and starts with
    // `---`) is always the LAST entry, after a `--` separator, so Pi can
    // never read its leading dashes as an option.
    args: [...withThinking(def.piArgs(mode), effort), '--', prompt],
    env: { ...process.env, [def.envVar]: readSecretImpl(def.secretField) },
  };
}

export function runPiSeat(seat, prompt, { spawnImpl = spawn, spawnOpts, ...specOpts } = {}) {
  const spec = buildPiSpawnSpec(seat, prompt, specOpts);
  return spawnImpl(spec.command, spec.args, { env: spec.env, ...(spawnOpts || {}) });
}

function errorTextOf(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return null;
}

// Read Pi's `--mode json` stream (one JSON event per line) and decide whether
// the turn ended in a vendor error. Verified live twice on 2026-09-19: a
// spent Z.ai balance makes Pi retry, settle, and exit 0 with an EMPTY stderr;
// the only trace is the assistant message's `stopReason: "error"` plus its
// `errorMessage` (e.g. `429 {"code":"1113","message":"Insufficient balance
// or no resource package. Please recharge."}`). A later successful assistant
// message clears an earlier transient error, so only the FINAL assistant
// stopReason decides. Pure and JSON-only: non-JSON lines are ignored, never a
// crash.
export function parsePiJsonStream(text) {
  let lastAssistant = null;
  let topLevelError = null;
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event?.type === 'error') {
      topLevelError = errorTextOf(event.error ?? event.message ?? event);
    }
    const messages = [];
    if (event?.message) messages.push(event.message);
    if (Array.isArray(event?.messages)) messages.push(...event.messages);
    for (const message of messages) {
      if (message?.role === 'assistant' && typeof message.stopReason === 'string') {
        lastAssistant = message;
      }
    }
  }

  if (lastAssistant) {
    if (lastAssistant.stopReason === 'error') {
      return { ok: false, errorText: errorTextOf(lastAssistant.errorMessage) ?? 'Pi reported a vendor error' };
    }
    return { ok: true, errorText: null };
  }
  if (topLevelError) return { ok: false, errorText: topLevelError };
  return { ok: true, errorText: null };
}

// Watch a spawned Pi child to completion: tee its stdout through unchanged
// (the JSON stream stays visible), then turn a vendor error in that stream
// into a NON-ZERO exit with the vendor text on stderr. A normal turn resolves
// with the child's own exit code and writes nothing to stderr. Resolves only
// once the child has exited AND its stdout has fully drained, so the last
// JSON line is never missed.
export function supervisePiSeat(child, { stdout = process.stdout, stderr = process.stderr } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let exited = false;
    let exitCode = null;
    let stdoutDone = !child.stdout;
    let settled = false;

    const finalize = () => {
      if (settled || !exited || !stdoutDone) return;
      settled = true;
      const { ok, errorText } = parsePiJsonStream(output);
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

// CLI entry: `{ cat SKILL.md; printf ...; } | node run-pi-seat.mjs <seat>
// [--effort low|medium|high]` -- mirrors julia-run.mjs's existing codex launch
// pattern (prompt text piped in via stdin, not an argv entry) so the same
// shell-command string works for every seat, and never carries a secret
// itself -- the secret is read in-process by buildPiSpawnSpec above.
export function readAllStdin({ readFileSyncImpl = readFileSync } = {}) {
  return readFileSyncImpl(0, 'utf8');
}

export function parseSeatArgs(argv) {
  const seat = argv[0];
  let effort = DEFAULT_EFFORT;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--effort') effort = argv[++i];
    else if (arg.startsWith('--effort=')) effort = arg.slice('--effort='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { seat, effort };
}

async function main() {
  let parsed;
  try {
    parsed = parseSeatArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  const { seat, effort } = parsed;
  if (!seat) {
    console.error(`usage: <prompt on stdin> | node run-pi-seat.mjs <seat> [--effort ${EFFORT_LEVELS.join('|')}] -- seat must be one of ${Object.keys(SEATS).join('|')}`);
    process.exitCode = 2;
    return;
  }
  const prompt = readAllStdin();
  // Pipe stdout (rather than inherit it) so the JSON stream can be inspected
  // for a vendor error while still being shown live; supervisePiSeat turns a
  // silent vendor failure into a non-zero exit with the vendor text on
  // stderr -- the fix for the two invisible run deaths (2026-09-19).
  const child = runPiSeat(seat, prompt, { mode: 'json', effort, spawnOpts: { stdio: ['ignore', 'pipe', 'pipe'] } });
  process.exitCode = await supervisePiSeat(child);
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
