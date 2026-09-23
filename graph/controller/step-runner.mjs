// step-runner.mjs -- one step of one card: build, test, review, in rounds.
//
// JUL-98 step 8 (Todd's Decision, 23 Sep) rewrote this file. The start-then-
// message route it used to drive -- `worker-start`, the adopt route, the Orca
// mailbox, the turn-start guesser, the release step -- is retired, not patched.
// Each seat is now ONE command in the card's working copy (./seat-run.mjs), and
// what it says comes back through files the controller reads itself.
//
// ONE ROUND:
//   1. The builder runs. Its answer must be "done", and it must have left a new
//      commit and nothing uncommitted.
//   2. The controller runs the test suite once, on that commit.
//   3. The reviewer runs in the SAME working copy, on that commit. Afterwards
//      the commit must be unchanged and the working copy clean: its standing
//      orders say any change rejects the review, and this is where that is
//      checked.
//   4. The verdict is READ, not inferred. "approve" with a passing suite ends
//      the step. "changes_needed" -- or "approve" over a failing suite -- sends
//      the findings back to a fresh builder for the next round.
//
// TWO ROUNDS, not three (the two-round limit, Todd). After the second round
// without an approve, the step parks with the reviewer's reasons on the card.
//
// THE SEND-BACK CRASH (JUL-92 attempt 10, 23 Sep 04:15Z) was two faults, both
// gone here: the reviewer's "CHANGES NEEDED" arrived as a *succeeded* worker and
// was never read as a verdict, so the controller went on to publish; and the
// builder's working copy had already been removed, so publishing crashed on it.
// The verdict is now read from the answer file, and the working copy belongs to
// the carry (./main.mjs), which removes it only after publishing.

import { checkEvidence } from '../../scripts/acceptance-check.mjs';
import { buildStepBrief, runSeat as defaultRunSeat } from './seat-run.mjs';
import { readWorktreeState as defaultReadWorktreeState, testRunLine } from './test-run.mjs';
import { formatCostLine } from './cost.mjs';

export const MAX_ROUNDS = 2;

// THE ATTEMPT TOKEN. Every name a second attempt on a card uses carries it:
// Orca does not refuse a repeated worktree name, it silently makes a
// differently-named one (graph/fixtures/orca-1.4.205/worktree-create.duplicate-name-suffixed.json),
// so the branch published would stop being the one the card is named after.
// ./main.mjs counts attempts per card in the state file, so this only goes forwards.
export function attemptTag(attempt) {
  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  return `a${n}`;
}

export function suitePassed(testRun) {
  return Boolean(testRun) && testRun.total > 0 && testRun.fail === 0;
}

function reviewerBriefExtras({ branch, baseCommit, candidate, testRun, builderSummary }) {
  return [
    '## The candidate you are reviewing',
    '',
    `- Branch \`${branch}\`, commit \`${candidate}\`, in THIS working copy. Compare it with \`${baseCommit}\` (where the branch started).`,
    '- Review it here. **Change nothing** -- not one file, committed or not. The controller checks the commit and `git status` after you, and any change rejects your review.',
    '',
    '## The controller\'s test run (the one that counts)',
    '',
    testRun ? testRunLine(testRun) : 'No test run is recorded.',
    '',
    '## The builder\'s hand-in',
    '',
    builderSummary,
    '',
  ].join('\n');
}

function acceptanceFinding(acceptance) {
  return [
    'The reviewer approved and the tests passed, but the acceptance check (scripts/acceptance-check.mjs, a plain script) refused the step, so nothing merges. What is missing:',
    '',
    ...acceptance.missing.map((gap) => `- ${gap}`),
  ].join('\n');
}

function failingTestsFinding(testRun) {
  return [
    'The reviewer approved, but the controller\'s own test run did not pass, and nothing merges with failing tests:',
    '',
    testRun ? testRunLine(testRun) : 'No test run is recorded.',
  ].join('\n');
}

// Run one step to its end. Returns
//   { ok, parked, reason, rounds, costLines, costText, testRun, candidate }
// and never publishes -- ./main.mjs does that, from the working copy it still holds.
export async function runBuildAndReview({
  card,
  step,
  launches,
  worktreePath,
  branch,
  baseCommit,
  suiteRunner,
  boundaries,
  maxRounds = MAX_ROUNDS,
  timeLimits = {},
  seatOptions = {},
  onProgress = async () => {},
  runSeatImpl = defaultRunSeat,
  readWorktreeStateImpl = defaultReadWorktreeState,
} = {}) {
  const rounds = [];
  const costLines = [];
  let priorFinding = null;
  let testRun = null;
  let lastCandidate = baseCommit;

  const finish = (fields) => {
    let costText = [];
    try {
      costText = costLines.map(formatCostLine);
    } catch (error) {
      return { ...fields, ok: false, reason: `${fields.reason ? `${fields.reason}; and ` : ''}${error.message}`, rounds, costLines, costText: [], testRun };
    }
    return { parked: false, ...fields, rounds, costLines, costText, testRun };
  };
  const stop = (reason) => finish({ ok: false, reason, candidate: lastCandidate });

  for (let round = 1; round <= maxRounds; round += 1) {
    const record = { round };
    rounds.push(record);

    // 1. The builder.
    const builderBrief = buildStepBrief({ seat: 'builder', card, step: { ...step, priorFinding } });
    const built = await runSeatImpl({
      ...seatOptions, seat: 'builder', round, launch: launches.builder, worktreePath, brief: builderBrief, boundaries,
      timeLimitMs: timeLimits.builder, onProgress,
    });
    record.builder = built;
    if (built.costLine) costLines.push(built.costLine);
    if (!built.ok) return stop(built.reason);
    if (built.answer.outcome !== 'done') return stop(`the builder (round ${round}) stopped and said why: ${built.answer.summary}`);

    const afterBuild = await readWorktreeStateImpl({ worktree: worktreePath });
    if (!afterBuild.known) return stop(`the working copy could not be read after the builder (round ${round}): ${afterBuild.reason}`);
    if (!afterBuild.clean) return stop(`the builder (round ${round}) said done but left ${afterBuild.dirtyCount} uncommitted ${afterBuild.dirtyCount === 1 ? 'change' : 'changes'} (${afterBuild.dirty.join('; ')})`);
    if (afterBuild.commit === lastCandidate) return stop(`the builder (round ${round}) said done but made no new commit`);
    const candidate = afterBuild.commit;
    lastCandidate = candidate;
    record.candidate = candidate;

    // 2. The one test run, on that commit.
    testRun = await suiteRunner.runOnce({ key: `${step.key}:round-${round}`, worktree: worktreePath });
    record.testRun = testRun;

    // 3. The reviewer, in the same working copy.
    const reviewerBrief = `${buildStepBrief({ seat: 'reviewer', card, step })}\n${reviewerBriefExtras({ branch, baseCommit, candidate, testRun, builderSummary: built.answer.summary })}`;
    const reviewed = await runSeatImpl({
      ...seatOptions, seat: 'reviewer', round, launch: launches.reviewer, worktreePath, brief: reviewerBrief, boundaries,
      timeLimitMs: timeLimits.reviewer, onProgress,
    });
    record.reviewer = reviewed;
    if (reviewed.costLine) costLines.push(reviewed.costLine);
    if (!reviewed.ok) return stop(reviewed.reason);

    const afterReview = await readWorktreeStateImpl({ worktree: worktreePath });
    if (!afterReview.known) return stop(`the working copy could not be read after the reviewer (round ${round}): ${afterReview.reason}`);
    if (afterReview.commit !== candidate || !afterReview.clean) {
      return stop(`the reviewer (round ${round}) changed the candidate (commit ${afterReview.commit.slice(0, 7)} vs ${candidate.slice(0, 7)}, ${afterReview.clean ? 'clean' : `${afterReview.dirtyCount} uncommitted`}), so its review is rejected`);
    }

    // 4. The verdict, read.
    const { verdict } = reviewed.answer;
    record.verdict = verdict;
    if (verdict === 'approve' && suitePassed(testRun)) {
      // 5. THE ACCEPTANCE CHECK (JUL-81; Todd, 23 Sep): a plain script, before
      // anything is merged. Every criterion on the card needs the builder's
      // evidence and the reviewer's "met", by name; every UAT-plan item needs
      // the builder's answer. A gap goes back to the builder as the finding.
      const acceptance = checkEvidence({ description: step.brief ?? '', builder: built.answer, reviewer: reviewed.answer });
      record.acceptance = acceptance;
      if (acceptance.ok) {
        return finish({ ok: true, reason: null, candidate, evidence: { builder: built.answer, reviewer: reviewed.answer, check: acceptance } });
      }
      priorFinding = acceptanceFinding(acceptance);
      record.finding = priorFinding;
      continue;
    }
    priorFinding = verdict === 'approve' ? failingTestsFinding(testRun) : reviewed.answer.findings;
    record.finding = priorFinding;
  }

  return finish({
    ok: false,
    parked: true,
    candidate: lastCandidate,
    reason: `two review rounds used and the step still did not pass -- it parks here (the two-round limit). The last finding: ${priorFinding}`,
  });
}
