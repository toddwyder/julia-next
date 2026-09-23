// controller-stand-in.mjs -- JUL-98 step 8: the FREE stand-in test, run on the
// server through every real route except the thinking.
//
//   sudo -u orchestrator-svc node scripts/controller-stand-in.mjs --scenario <name> [--base origin/<branch>]
//
// What is REAL: the controller's own carry (graph/controller/main.mjs
// `carryCard`), a real Orca working copy on the worker daemon, a real Orca
// terminal running scripts/run-seat.mjs as `runner`, the brief carried in the
// command, the progress and answer files, the controller reading them as
// `orchestrator-svc`, the five-minute stuck rule and the time limit, the test
// suite run once per round, the git checks, and the working copy's removal.
//
// What is NOT: the seats (scripts/stand-in-seat.mjs follows a scenario, free),
// the board (no card is created -- the card forbids staged cards -- so every
// comment and move is printed instead of posted), and publishing (printed,
// never pushed: nothing a stand-in commits may reach GitHub).
//
// Scenarios: pass | changes-then-pass | timeout | stuck | busy-silent | cut-off.
// `timeout`, `stuck` and `busy-silent` run on short limits (below) so the proof
// takes minutes, not an hour; the rule and the code path are the production ones.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { carryCard } from '../graph/controller/main.mjs';
import { createOrcaBoundaries, createRequestLedger, headShaOf } from '../graph/controller/wiring.mjs';
import { SCENARIOS } from './stand-in-seat.mjs';

// Short limits for the two failure scenarios. The production defaults are
// 30/20 minutes and five minutes stuck (graph/controller/seat-run.mjs).
export const STAND_IN_LIMITS = Object.freeze({
  timeout: { timeLimits: { builder: 90 * 1000, reviewer: 90 * 1000 }, seatOptions: { stuckAfterMs: 10 * 60 * 1000, progressReadMs: 20 * 1000 } },
  stuck: { timeLimits: { builder: 10 * 60 * 1000, reviewer: 10 * 60 * 1000 }, seatOptions: { stuckAfterMs: 60 * 1000, progressReadMs: 15 * 1000 } },
  // The same 60-second stuck rule as `stuck`, against seats that are working
  // but silent for 150 s: they must NOT be stopped.
  'busy-silent': { timeLimits: { builder: 10 * 60 * 1000, reviewer: 10 * 60 * 1000 }, seatOptions: { stuckAfterMs: 60 * 1000, progressReadMs: 15 * 1000 } },
});

export function standInCard(scenario, run = Date.now().toString(36)) {
  return {
    id: `stand-in-${scenario}-${run}`,
    identifier: `STANDIN-${parseInt(run, 36) % 100000}`,
    title: `Stand-in carry (${scenario})`,
    url: null,
    description: `A free stand-in carry. No card, no model, no spend.\n\nStand-in scenario: ${scenario}\n`,
    labels: [],
  };
}

export function printingBoard(print) {
  let next = 0;
  return {
    async comment({ body }) { next += 1; print(`[board] comment c${next}:\n${body}\n`); return { id: `c${next}` }; },
    async updateComment({ commentId, body }) { print(`[board] comment ${commentId} edited:\n${body}\n`); return { id: commentId }; },
    async moveCard({ to }) { print(`[board] card moved to ${to}`); },
  };
}

export function printingPublisher(print, { headShaImpl = headShaOf } = {}) {
  return {
    missingCredentials: () => null,
    async publishAndMerge({ branch, worktreePath, title }) {
      // Read the head the real publisher would pin the merge to -- from the
      // working copy, which must still exist here (the send-back crash).
      const sha = await headShaImpl(worktreePath);
      print(`[publish] NOT published (stand-in): would push ${branch} at ${sha} and open "${title}"`);
      return { ok: true, pr: { url: '(stand-in: not published)', number: 0 }, sha, merged: { merged: true, sha } };
    },
  };
}

export async function runStandIn({ scenario, baseBranch, print = console.log }) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`--scenario must be one of ${SCENARIOS.join(', ')}`);
  const card = standInCard(scenario);
  const seen = new Map();
  const board = printingBoard(print);
  const comments = {
    async postOnce({ issueId, key, body }) {
      if (seen.has(`${issueId}::${key}`)) return { posted: false };
      seen.set(`${issueId}::${key}`, true);
      return { posted: true, comment: await board.comment({ issueId, body }) };
    },
  };
  const limits = STAND_IN_LIMITS[scenario] ?? {};
  const started = Date.now();
  const result = await carryCard({
    card,
    attempt: 1,
    boundaries: createOrcaBoundaries({ ledger: createRequestLedger() }),
    board,
    publisher: printingPublisher(print),
    comments,
    log: print,
    standIn: true,
    seatChoicesImpl: () => ({ builder: null, reviewer: null }),
    timeLimits: limits.timeLimits ?? {},
    seatOptions: limits.seatOptions ?? {},
    ...(baseBranch ? { baseBranch } : {}),
  });
  const summary = {
    scenario,
    ok: result.ok,
    stage: result.stage,
    column: result.column ?? null,
    branch: result.branch ?? null,
    reason: result.reason ?? null,
    parked: result.outcome?.parked ?? false,
    rounds: (result.outcome?.rounds ?? []).map((r) => ({
      round: r.round,
      candidate: r.candidate ?? null,
      tests: r.testRun ? `${r.testRun.pass} pass / ${r.testRun.fail} fail` : null,
      verdict: r.verdict ?? null,
      builder: r.builder ? { ok: r.builder.ok, stuck: r.builder.stuck ?? false, timedOut: r.builder.timedOut ?? false, stopConfirmed: r.builder.stopConfirmed ?? null, progressLines: r.builder.progress?.entries?.length ?? 0 } : null,
      reviewer: r.reviewer ? { ok: r.reviewer.ok, cutOff: r.reviewer.cutOff ?? null, progressLines: r.reviewer.progress?.entries?.length ?? 0 } : null,
    })),
    minutes: Math.round(((Date.now() - started) / 60000) * 10) / 10,
  };
  print(`[stand-in] RESULT ${JSON.stringify(summary)}`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--scenario');
  const base = process.argv.indexOf('--base');
  runStandIn({ scenario: at > -1 ? process.argv[at + 1] : null, baseBranch: base > -1 ? process.argv[base + 1] : undefined }).catch((error) => {
    console.error(`[stand-in] ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
