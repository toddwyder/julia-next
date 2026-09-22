// cost-read.mjs -- JUL-98 step 5, fourth fix: reading one seat's figures OFF
// DISK. Nothing in here calls Orca, Linear or git, and that is the point: this
// module is what RUNS AS THE WORKER, inside the worker-side terminal that
// scripts/read-seat-cost.mjs is started in.
//
// WHY IT IS ITS OWN FILE NOW. It used to live in ./wiring.mjs and be called by
// the controller process directly. That cannot work, and the reason is a
// permission, not a path: Claude Code creates each per-project transcript
// directory MODE 0700, owned by the worker account. Measured on the box on
// 2026-09-21 as `orchestrator-svc`:
//
//   $ ls -ld /home/runner /home/runner/.claude /home/runner/.claude/projects
//   drwxr-xr-x 21 runner runner /home/runner
//   drwxrwxr-x 11 runner runner /home/runner/.claude
//   drwxr-xr-x 56 runner runner /home/runner/.claude/projects
//   $ ls -l /home/runner/.claude/projects/-home-runner-orca-workspaces-julia-next-jul-92-work-a1
//   ls: cannot open directory ...: Permission denied
//
// So the LAST hop -- the per-project directory itself -- is closed to the
// controller for good. `wiring.mjs` now reaches these functions the only way
// that works without root: it asks Orca for a plain terminal on the worker
// daemon, which runs as the worker, and that terminal runs
// scripts/read-seat-cost.mjs, which imports this file.
//
// Nothing here computes a new figure. Every total, peak and dollar comes from
// ./cost.mjs and ../rate-table.mjs, and `tokenTotal()` stays the one place a
// token total is worked out.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { claudeExtractFromTranscript, codexExtractFromRollout, geminiExtractFromAllowance, seatCostLine } from './cost.mjs';
import { addTrustedWorkspace, hasTrustStore, trustStoreFor } from './agent-trust.mjs';
import { RATE_TABLE } from '../rate-table.mjs';

const execFileAsync = promisify(execFile);

// AND THE WORKER'S HOME DIRECTORY, named here for the same reason the daemon
// and the checkout are: it belongs to `runner`, not to the account this process
// runs as. A worker's session files -- the Claude transcript under
// `<home>/.claude/projects/` and the Codex rollout under
// `<home>/.codex/sessions/` -- are written BY THE WORKER, so they land under
// this home and nowhere else.
//
// THE CONTROLLER'S OWN HOME IS NEVER THE RIGHT PLACE TO LOOK, which is why the
// cost reader below takes WORKER_HOME and not this process's `os.homedir()`.
// The controller runs as `orchestrator-svc`, whose home is
// /home/orchestrator-svc (its passwd entry: `echo ~orchestrator-svc`); no
// worker has ever written a byte into it, and it is not even readable by
// `runner` (`ls -a /home/orchestrator-svc` as `runner` on 2026-09-21:
// "Permission denied"). Looking there finds no transcript, the reader refuses,
// the seat gets no cost line, and `assertEverySeatCosted` stops the step --
// which is exactly what happened to JUL-92 on 2026-09-21: "stopped at
// build-and-review -- no cost line for the builder seat". That worker's
// transcript is real and is at
// /home/runner/.claude/projects/-home-runner-orca-workspaces-julia-next-jul-92-work
// (listed on the host, 2026-09-21).
export const WORKER_HOME = '/home/runner';

// ---------------------------------------------------------------------------
// The cost read -- NOT an Orca call, because Orca has no such figure
// ---------------------------------------------------------------------------

// Claude Code names a project directory after the worktree path with every
// character that is not a letter or a digit replaced by a dash
// (~/.claude/projects/-home-runner-jul109b-base-julia-next-b is the recorded
// example on this host, and this session's own directory is the same shape).
export function claudeProjectDirName(worktreePath) {
  return String(worktreePath).replace(/[^A-Za-z0-9]/g, '-');
}

// A .jsonl file as the list of its lines, with the blank last line dropped.
function splitJsonl(text) {
  return String(text).split('\n').filter((line) => line.trim() !== '');
}

function newestFile(dir, matches, { readdirImpl, statImpl }) {
  let entries;
  try {
    entries = readdirImpl(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries
    .filter((entry) => entry.isFile() && matches(entry.name))
    .map((entry) => {
      const full = join(dir, entry.name);
      return { full, mtimeMs: statImpl(full).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.full ?? null;
}

// Codex writes ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, so the newest
// rollout is found by walking the three date levels newest-first rather than
// by globbing the whole tree.
function newestCodexRollout(root, { readdirImpl, statImpl }) {
  const descend = (dir, depth) => {
    let names;
    try {
      names = readdirImpl(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    if (depth === 0) return newestFile(dir, (name) => /^rollout-.*\.jsonl$/.test(name), { readdirImpl, statImpl });
    const dirs = names.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
    for (const name of dirs) {
      const found = descend(join(dir, name), depth - 1);
      if (found) return found;
    }
    return null;
  };
  return descend(root, 3);
}

// ---------------------------------------------------------------------------
// The Gemini seat: an allowance, read from agy itself
// ---------------------------------------------------------------------------

// `agy -p "/usage" --output-format json`, as the worker. A SLASH COMMAND, so it
// costs none of the allowance it reports (`num_turns: 0`, `usage.total_tokens:
// 0` in the recorded answer, graph/fixtures/orca-1.4.205/cost.gemini-agy-usage.json).
export const AGY_USAGE_ARGS = Object.freeze(['-p', '/usage', '--output-format', 'json']);

export async function readAgyAllowance({ execImpl = execFileAsync, cwd = undefined } = {}) {
  const { stdout } = await execImpl('agy', [...AGY_USAGE_ARGS], { cwd, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

// The buckets we are billed in, out of agy's own answer, BY ID. agy reports two
// groups -- Gemini, and Claude/GPT -- and only the first is this seat's to
// spend or to report; taking "the first group" would silently follow agy if it
// ever reorders them.
export function geminiAllowanceFromUsage(answer, { buckets } = {}) {
  const groups = answer?.command?.data?.groups ?? [];
  const found = {};
  for (const group of groups) {
    for (const bucket of group?.buckets ?? []) {
      if (buckets.includes(bucket?.id) && Number.isFinite(bucket.remaining_fraction)) {
        found[bucket.id] = bucket.remaining_fraction;
      }
    }
  }
  const missing = buckets.filter((id) => !(id in found));
  if (missing.length > 0) {
    // A refusal, never a default: a missing bucket read as 1.0 would say the
    // seat spent nothing, which is the blank cost line in another costume.
    throw new Error(`geminiAllowanceFromUsage: agy's /usage answer has no ${missing.join(', ')} bucket, so the allowance cannot be read -- refusing to guess one`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Preparing one worktree for one agent, as the worker
// ---------------------------------------------------------------------------

// Two things, both of which only the WORKER can do, and both of which have to
// happen BEFORE the agent is started:
//
//   * the worktree goes into the agent's own folder-trust list, if it has one
//     (./agent-trust.mjs records the measurement that says agy does and Pi does
//     not). `trusted: true` means "this agent will not stop on a trust question
//     in this folder" -- an entry was written, or there is no list to write to.
//   * the allowance is read, for an agent billed against one, so the cost line
//     has something to difference against when the worker reports.
export async function prepareSeatWorktree({
  agent,
  worktreePath,
  workerHome = WORKER_HOME,
  readFileImpl = readFileSync,
  writeFileImpl = writeFileSync,
  mkdirImpl = mkdirSync,
  readAllowanceImpl = readAgyAllowance,
} = {}) {
  let trustStore = null;
  let added = false;
  if (hasTrustStore(agent)) {
    const store = trustStoreFor(agent);
    const file = join(workerHome, store.file);
    let existing = '';
    try {
      existing = readFileImpl(file, 'utf8');
    } catch {
      // No settings file yet: the first run of the agent has not happened here.
      // An empty store is a real starting point; an unreadable one is not, and
      // addTrustedWorkspace refuses that separately.
      existing = '';
    }
    const next = addTrustedWorkspace({ agent, text: existing, worktreePath });
    mkdirImpl(dirname(file), { recursive: true });
    writeFileImpl(file, next.text);
    trustStore = file;
    added = next.added;
  }
  const allowance = agent === 'agy'
    ? geminiAllowanceFromUsage(await readAllowanceImpl(), { buckets: geminiBucketsOf(agent) })
    : null;
  return { agent, worktreePath, trusted: true, trustStore, added, allowance };
}

// The buckets an agy seat spends, taken from the rate table rather than
// repeated here -- the two Gemini models share one group, which is agy's own
// statement ("Models within this group: Gemini Flash, Gemini Pro").
function geminiBucketsOf(agent) {
  if (agent !== 'agy') return [];
  for (const entry of Object.values(RATE_TABLE.models)) {
    if (entry.vendor === 'gemini' && entry.allowanceBuckets) return entry.allowanceBuckets;
  }
  throw new Error('no Gemini allowance buckets are declared in graph/rate-table.mjs');
}

// One seat's figures, read while the worker's session files still exist --
// which is why graph/controller/release.mjs reads BEFORE it releases.
//
// WHERE A CONTROLLER-STARTED WORKER REALLY WRITES, no longer a guess. The
// controller ran for real against JUL-92 on 2026-09-21 and the builder it
// started left its transcript at
// /home/runner/.claude/projects/-home-runner-orca-workspaces-julia-next-jul-92-work
// -- i.e. under the WORKER's home, with the directory named by
// `claudeProjectDirName` of the worker's worktree path. The LAYOUT was already
// recorded (JUL-109 findings, section 5); that run is what pinned the home.
export function createSeatCostReader({
  // THE WORKER'S HOME, never this process's own. See WORKER_HOME at the top of
  // this file for what breaks when the two are confused -- it is the JUL-92
  // blank-cost-line stop, not a hypothetical.
  workerHome = WORKER_HOME,
  readFileImpl = readFileSync,
  readdirImpl = readdirSync,
  statImpl = statSync,
  readAllowanceImpl = readAgyAllowance,
} = {}) {
  return async function readSeatCost({ seat, worktree, agent, model = null, allowanceBefore = null, startedAt = null, endedAt = null }) {
    const worktreePath = worktreePathOf(worktree);
    if (agent === 'claude') {
      const dir = join(workerHome, '.claude', 'projects', claudeProjectDirName(worktreePath));
      const file = newestFile(dir, (name) => name.endsWith('.jsonl'), { readdirImpl, statImpl });
      if (!file) {
        throw new Error(`no Claude transcript for the ${seat} seat under ${dir} -- its cost cannot be read, so the worker and its worktree are left in place`);
      }
      // parseTranscriptLines takes an ARRAY of lines: handing it the raw file
      // text would iterate it one CHARACTER at a time and total nothing at all
      // -- the exact silent-blank failure cost.mjs's own header records.
      return seatCostLine({ seat, ...claudeExtractFromTranscript(splitJsonl(readFileImpl(file, 'utf8'))) });
    }
    if (agent === 'codex') {
      const root = join(workerHome, '.codex', 'sessions');
      const file = newestCodexRollout(root, { readdirImpl, statImpl });
      if (!file) {
        throw new Error(`no Codex rollout for the ${seat} seat under ${root} -- its cost cannot be read, so the worker and its worktree are left in place`);
      }
      const lines = splitJsonl(readFileImpl(file, 'utf8')).map((line) => JSON.parse(line));
      return seatCostLine({ seat, ...codexExtractFromRollout(lines) });
    }
    if (agent === 'agy') {
      // No session file to find: agy writes no per-session token record at all
      // (the search is in graph/rate-table.mjs). The figure is the allowance it
      // drew down, so the reading taken at dispatch is differenced against one
      // taken now, and a missing first reading is a refusal.
      const after = geminiAllowanceFromUsage(await readAllowanceImpl(), { buckets: geminiBucketsOf(agent) });
      return seatCostLine({ seat, ...geminiExtractFromAllowance({ model, before: allowanceBefore, after, startedAt, endedAt }) });
    }
    throw new Error(`no cost source is known for a ${JSON.stringify(agent)} seat (${seat}) -- refusing to guess a figure${startedAt && endedAt ? ` for ${startedAt}..${endedAt}` : ''}`);
  };
}

// Orca names a worktree `<repoId>::<path>`.
export function worktreePathOf(worktreeId) {
  if (typeof worktreeId !== 'string') return worktreeId;
  const marker = worktreeId.indexOf('::');
  return marker < 0 ? worktreeId : worktreeId.slice(marker + 2);
}
