// cost-read.mjs -- the Gemini allowance reading, and nothing else.
//
// A Gemini seat records no per-session usage anywhere (the search is in
// ../rate-table.mjs), so its figure is the allowance ASKED of agy before the
// seat runs and again after, differenced (./cost.mjs `geminiExtractFromAllowance`).
// scripts/run-seat.mjs takes both readings, as the worker, around the seat, and
// writes them into the seat's run record.
//
// JUL-98 step 8 (23 Sep) retired the rest of this file: the readers of Claude
// transcripts, Codex rollouts and Pi session files, run through a worker-side
// terminal after the seat. A DeepSeek seat's figures now come from its own
// JSON stream, which run-seat.mjs saves in the working copy, and Claude and
// Codex are not seats on the single-command route yet.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { RATE_TABLE } from '../rate-table.mjs';

const execFileAsync = promisify(execFile);

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
// THE RESET TIME TRAVELS WITH THE FRACTION, because a bucket's window can roll
// over between the two readings a cost line is differenced from -- agy's
// 5-hour limit does so every five hours -- and the difference is then
// meaningless. ./cost.mjs's geminiExtractFromAllowance compares the two reset
// times and says "not measurable" rather than printing a clamped zero.
export function geminiAllowanceFromUsage(answer, { buckets } = {}) {
  const groups = answer?.command?.data?.groups ?? [];
  const found = {};
  for (const group of groups) {
    for (const bucket of group?.buckets ?? []) {
      if (buckets.includes(bucket?.id) && Number.isFinite(bucket.remaining_fraction)) {
        found[bucket.id] = { remaining: bucket.remaining_fraction, resetTime: bucket.reset_time ?? null };
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

// The buckets an agy seat spends, taken from the rate table rather than
// repeated here -- every Gemini model shares one group, which is agy's own
// statement ("Models within this group: Gemini Flash, Gemini Pro").
export function geminiAllowanceBuckets() {
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
