// run-pi-seat.mjs -- launches Pi for a backup seat (builder-on-DeepSeek,
// reviewer/orchestrator-on-GLM, orchestrator-on-DeepSeek) with the seat's
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
    piArgs: (prompt, mode) => ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '-p', prompt, '--mode', mode],
  },
  'reviewer-backup': {
    envVar: 'ZAI_PAYG_API_KEY',
    secretField: 'zai',
    piArgs: (prompt, mode) => ['--provider', 'glm-5-3', '--model', 'glm-5.3', '-p', prompt, '--mode', mode],
  },
  'orchestrator-backup': {
    envVar: 'ZAI_PAYG_API_KEY',
    secretField: 'zai',
    piArgs: (prompt, mode) => ['--provider', 'glm-5-3', '--model', 'glm-5.3', '-p', prompt, '--mode', mode],
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
    piArgs: (prompt, mode) => ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '-p', prompt, '--mode', mode],
  },
};

// Pi's effort spelling (live-verified: `pi --thinking` exists). Medium is the
// default for an omitted or unrecognized level -- never a throw, matching
// scripts/effort.mjs's own rule and the ticket's stated default.
export function thinkingArgs(effort) {
  const level = EFFORT_LEVELS.includes(effort) ? effort : DEFAULT_EFFORT;
  return level === 'low' ? [] : ['--thinking'];
}

// Put --thinking immediately before `-p`, so the prompt text (which can be
// the entire coordinator skill) always stays the trailing argv entry and a
// future flag appended after `--mode` cannot push it around.
function withThinking(args, effort) {
  const extra = thinkingArgs(effort);
  if (extra.length === 0) return args;
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
    args: withThinking(def.piArgs(prompt, mode), effort),
    env: { ...process.env, [def.envVar]: readSecretImpl(def.secretField) },
  };
}

export function runPiSeat(seat, prompt, { spawnImpl = spawn, spawnOpts, ...specOpts } = {}) {
  const spec = buildPiSpawnSpec(seat, prompt, specOpts);
  return spawnImpl(spec.command, spec.args, { env: spec.env, ...(spawnOpts || {}) });
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
  const child = runPiSeat(seat, prompt, { mode: 'json', effort, spawnOpts: { stdio: ['ignore', 'inherit', 'inherit'] } });
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
