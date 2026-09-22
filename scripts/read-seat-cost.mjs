// read-seat-cost.mjs -- JUL-98 step 5, fourth fix. One seat's cost figures, on
// ONE line of JSON, printed by a process that RUNS AS THE WORKER.
//
// WHY THIS SCRIPT EXISTS AT ALL. The controller runs as `orchestrator-svc` and
// the worker runs as `runner`. Claude Code creates each per-project transcript
// directory mode 0700 owned by the worker, so the controller cannot read it and
// never will by reading the filesystem directly. Measured on the box on
// 2026-09-21 as `orchestrator-svc`:
//
//   $ ls -ld /home/runner /home/runner/.claude /home/runner/.claude/projects
//   drwxr-xr-x 21 runner runner /home/runner
//   drwxrwxr-x 11 runner runner /home/runner/.claude
//   drwxr-xr-x 56 runner runner /home/runner/.claude/projects
//   $ ls -l /home/runner/.claude/projects/-home-runner-orca-workspaces-julia-next-jul-92-work-a1
//   ls: cannot open directory ...: Permission denied
//
// The controller therefore asks Orca for a plain terminal on the worker daemon
// -- which runs as the worker -- and that terminal runs this file. See
// graph/controller/wiring.mjs, `createOrcaSeatCostReader`.
//
// THE OUTPUT CONTRACT, and why it is this narrow. Success prints EXACTLY ONE
// line to stdout and nothing else: the JSON of the seat's cost line. The caller
// reads it out of a terminal transcript that also holds a shell prompt, the
// echoed command and anything node decided to say, so "the answer is the one
// line that is JSON" has to be true by construction, not by luck. Failure
// prints a sentence to STDERR and exits non-zero -- never a plausible-looking
// blank, which is the exact failure (a blank builder cost line) this whole
// round of the card exists to stop.
//
// NOTHING IS COMPUTED HERE. Every token total, peak and dollar comes from
// graph/controller/cost.mjs and graph/rate-table.mjs through
// graph/controller/cost-read.mjs; `tokenTotal()` remains the only place a token
// total is worked out.

import { pathToFileURL } from 'node:url';

import { createSeatCostReader } from '../graph/controller/cost-read.mjs';

export const USAGE = 'usage: node scripts/read-seat-cost.mjs --seat <seat> --agent <claude|codex|agy|pi> --worktree <path> [--model <id>] [--allowance-before <json>] [--started-at <iso>] [--ended-at <iso>]';

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

// The whole script as a function, so the test drives it without a subprocess
// and still proves the one-line contract: `out` is called once, with one line.
export async function readSeatCostToJsonLine(argv, { readSeatCostImpl = createSeatCostReader() } = {}) {
  const args = parseArgs(argv);
  const { seat, agent, worktree, model = null } = args;
  if (!seat || !agent || !worktree) throw new Error(`read-seat-cost: --seat, --agent and --worktree are all required. ${USAGE}`);
  // An allowance-billed seat (agy) has no session file: its figure is the
  // difference between the reading taken at dispatch -- handed in here -- and
  // one taken now. A malformed reading is a refusal, never an empty object,
  // which would say the seat spent nothing.
  let allowanceBefore = null;
  const raw = args['allowance-before'];
  if (raw !== undefined) {
    try {
      allowanceBefore = JSON.parse(raw);
    } catch (error) {
      throw new Error(`read-seat-cost: --allowance-before is not valid JSON (${error.message}) -- refusing to cost the ${seat} seat against nothing`);
    }
  }
  const line = await readSeatCostImpl({
    seat,
    worktree,
    agent,
    model,
    allowanceBefore,
    startedAt: args['started-at'] ?? null,
    endedAt: args['ended-at'] ?? null,
  });
  return JSON.stringify(line);
}

export async function main(argv, { out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), setExitCode = (code) => { process.exitCode = code; }, ...rest } = {}) {
  try {
    out(`${await readSeatCostToJsonLine(argv, rest)}\n`);
    return 0;
  } catch (error) {
    // STDERR, so it can never be mistaken for the one JSON line, and a non-zero
    // exit so the caller refuses instead of reading an empty transcript as $0.
    err(`${error.message}\n`);
    setExitCode(1);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
