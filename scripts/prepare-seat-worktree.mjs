// prepare-seat-worktree.mjs -- JUL-98 step 6. One worktree made ready for one
// agent, on ONE line of JSON, printed by a process that RUNS AS THE WORKER.
//
// WHY IT RUNS AS THE WORKER, and not in the controller. Both things it does are
// the worker's to do:
//
//   * the agent's folder-trust list is the worker's own file. Measured on this
//     host on 2026-09-22: ~/.gemini/antigravity-cli/settings.json is mode 0600,
//     owned by `runner`. The controller runs as `orchestrator-svc` and cannot
//     read it, let alone write it -- the same wall scripts/read-seat-cost.mjs
//     exists for (graph/controller/cost-read.mjs's header).
//   * the allowance reading is `agy`'s own answer, and agy is signed in as the
//     worker.
//
// THE OUTPUT CONTRACT is scripts/read-seat-cost.mjs's, deliberately identical,
// because the caller reads both out of a terminal transcript that also holds a
// shell prompt and the echoed command: success prints EXACTLY ONE line of JSON
// to stdout and nothing else; failure prints a sentence to STDERR and exits
// non-zero. A worktree that could not be prepared must never look prepared --
// an untrusted folder is what stops a TUI dead, and that stall is the whole
// reason the trust entry is written in advance.

import { pathToFileURL } from 'node:url';

import { prepareSeatWorktree } from '../graph/controller/seat-worktree.mjs';

export const USAGE = 'usage: node scripts/prepare-seat-worktree.mjs --seat <seat> --agent <agy|pi> --worktree <path>';

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

export async function prepareToJsonLine(argv, { prepareImpl = prepareSeatWorktree, ...rest } = {}) {
  const { seat, agent, worktree } = parseArgs(argv);
  if (!seat || !agent || !worktree) throw new Error(`prepare-seat-worktree: --seat, --agent and --worktree are all required. ${USAGE}`);
  return JSON.stringify({ seat, ...(await prepareImpl({ agent, worktreePath: worktree, ...rest })) });
}

export async function main(argv, { out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), setExitCode = (code) => { process.exitCode = code; }, ...rest } = {}) {
  try {
    out(`${await prepareToJsonLine(argv, rest)}\n`);
    return 0;
  } catch (error) {
    err(`${error.message}\n`);
    setExitCode(1);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
