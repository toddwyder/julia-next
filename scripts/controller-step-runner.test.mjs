// controller-step-runner.test.mjs -- JUL-98 step 8: one step in rounds --
// build, test, review, and the verdict READ from the reviewer's answer.
// Fake seats, a fake git state and a fake test run: the real route is proven on
// the server by scripts/controller-stand-in.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runBuildAndReview, attemptTag, suitePassed, MAX_ROUNDS } from '../graph/controller/step-runner.mjs';

const card = { identifier: 'JUL-92', title: 'Docs match' };
const step = { key: 'work', title: 'Docs match', brief: 'Fix the docs.' };
const launches = { builder: { agent: 'agy', model: 'gemini-3.8-flash' }, reviewer: { agent: 'pi', model: 'deepseek-v4-pro' } };
const zeroCost = (seat) => ({ seat, vendor: 'stand-in', model: 'm', totalTokens: 0, peakContext: 0, minutes: 1, usd: 0, tokens: { input: 0, output: 0 } });

// A scripted world: each builder run makes a new commit; `verdicts` are the
// reviewer's answers in order; `tests` the suite results in order.
function world({ verdicts = [], tests = [], builder = () => ({}), afterReview = null } = {}) {
  let head = 'base0000000000000000000000000000000000000';
  let commits = 0;
  let clean = true;
  const briefs = { builder: [], reviewer: [] };
  const suiteKeys = [];
  const runSeatImpl = async ({ seat, round, brief }) => {
    briefs[seat].push(brief);
    if (seat === 'builder') {
      const override = builder(round) ?? {};
      if (override.result) return { costLine: zeroCost(seat), ...override.result };
      if (!override.noCommit) { commits += 1; head = `c${commits}`.padEnd(40, '0'); }
      if (override.dirty) clean = false;
      return { ok: true, answer: { outcome: 'done', summary: `built round ${round}` }, costLine: zeroCost(seat) };
    }
    const verdict = verdicts.shift();
    if (afterReview) ({ head = head, clean = clean } = afterReview({ head, clean }) ?? {});
    if (verdict?.result) return { costLine: zeroCost(seat), ...verdict.result };
    return { ok: true, answer: verdict, costLine: zeroCost(seat) };
  };
  const readWorktreeStateImpl = async () => ({ known: true, commit: head, shortCommit: head.slice(0, 7), clean, dirtyCount: clean ? 0 : 1, dirty: clean ? [] : ['?? stray.txt'] });
  const suiteRunner = { async runOnce({ key }) { suiteKeys.push(key); return tests.shift() ?? { pass: 10, fail: 0, skipped: 0, total: 10, startedAt: '2026-09-23T05:00:00Z', endedAt: '2026-09-23T05:00:05Z', durationMs: 5000, command: 'node --test', worktree: '/w' }; } };
  return { runSeatImpl, readWorktreeStateImpl, suiteRunner, briefs, suiteKeys };
}

const run = (w, extra = {}) => runBuildAndReview({
  card, step, launches, worktreePath: '/w', branch: 'jul-92-work-a1', baseCommit: 'base0000000000000000000000000000000000000',
  suiteRunner: w.suiteRunner, runSeatImpl: w.runSeatImpl, readWorktreeStateImpl: w.readWorktreeStateImpl, ...extra,
});
const failing = { pass: 9, fail: 1, skipped: 0, total: 10, startedAt: '2026-09-23T05:00:00Z', endedAt: '2026-09-23T05:00:05Z', durationMs: 5000, command: 'node --test', worktree: '/w' };

test('round 1 approved over a passing suite: the step passes, with both seats costed and one test run', async () => {
  const w = world({ verdicts: [{ verdict: 'approve', summary: 'checked' }] });
  const result = await run(w);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.rounds.length, 1);
  assert.equal(result.candidate, 'c1'.padEnd(40, '0'));
  assert.equal(result.costText.length, 2);
  assert.deepEqual(w.suiteKeys, ['work:round-1']);
  assert.match(w.briefs.reviewer[0], /commit `c1/);
  assert.match(w.briefs.reviewer[0], /\*\*Change nothing\*\*/);
  assert.match(w.briefs.reviewer[0], /built round 1/, 'the builder\'s hand-in travels to the reviewer');
});

test('THE SEND-BACK: changes needed in round 1 go to a fresh round-2 builder AS ITS FINDING, and round 2\'s approve passes the step', async () => {
  const w = world({ verdicts: [{ verdict: 'changes_needed', findings: 'F1: the rename missed CLAUDE.md' }, { verdict: 'approve', summary: 'ok' }] });
  const result = await run(w);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[0].verdict, 'changes_needed');
  assert.doesNotMatch(w.briefs.builder[0], /finding you are fixing/);
  assert.match(w.briefs.builder[1], /## The review finding you are fixing\n\nF1: the rename missed CLAUDE\.md/);
  assert.deepEqual(w.suiteKeys, ['work:round-1', 'work:round-2'], 'one test run per round, never two for one commit');
  assert.equal(result.costText.length, 4);
});

test('a CHANGES NEEDED verdict never passes the step -- the regression that would have merged a rejected change', async () => {
  const w = world({ verdicts: [{ verdict: 'changes_needed', findings: 'F1' }, { verdict: 'changes_needed', findings: 'F2: still wrong' }] });
  const result = await run(w);
  assert.equal(result.ok, false);
  assert.equal(result.parked, true);
  assert.match(result.reason, /two review rounds used .* parks here .* The last finding: F2: still wrong/);
  assert.equal(result.rounds.length, MAX_ROUNDS);
});

test('an approve over a FAILING suite is not a pass: the failing run goes back as the finding', async () => {
  const w = world({ verdicts: [{ verdict: 'approve', summary: 'looks fine' }, { verdict: 'approve', summary: 'fixed' }], tests: [failing] });
  const result = await run(w);
  assert.equal(result.ok, true);
  assert.match(w.briefs.builder[1], /the controller's own test run did not pass, and nothing merges with failing tests/);
  assert.equal(suitePassed(failing), false);
  assert.equal(suitePassed({ total: 0, fail: 0 }), false, 'a run that ran nothing is not a pass');
});

test('a reviewer that changed the candidate has its review rejected, whatever it said', async () => {
  const moved = world({ verdicts: [{ verdict: 'approve', summary: 'ok' }], afterReview: () => ({ head: 'ffff'.padEnd(40, 'f') }) });
  let result = await run(moved);
  assert.equal(result.ok, false);
  assert.match(result.reason, /reviewer \(round 1\) changed the candidate/);
  const dirty = world({ verdicts: [{ verdict: 'approve', summary: 'ok' }], afterReview: ({ head }) => ({ head, clean: false }) });
  result = await run(dirty);
  assert.match(result.reason, /changed the candidate .*1 uncommitted/);
});

test('a builder that says done but made no commit, or left changes uncommitted, stops the step with that reason', async () => {
  let result = await run(world({ builder: () => ({ noCommit: true }) }));
  assert.match(result.reason, /said done but made no new commit/);
  result = await run(world({ builder: () => ({ dirty: true }) }));
  assert.match(result.reason, /left 1 uncommitted change \(\?\? stray\.txt\)/);
});

test('a builder that stops and says why, or a seat that fails (stuck, timed out, no answer), stops the step with ITS reason and keeps its cost line', async () => {
  let result = await run(world({ builder: () => ({ result: { ok: true, answer: { outcome: 'blocked', summary: 'needs root' } } }) }));
  assert.match(result.reason, /builder \(round 1\) stopped and said why: needs root/);
  assert.equal(result.costLines.length, 1);
  result = await run(world({ builder: () => ({ result: { ok: false, stuck: true, reason: 'the builder (round 1) was stopped as stuck' } }) }));
  assert.match(result.reason, /stopped as stuck/);
  result = await run(world({ verdicts: [{ result: { ok: false, timedOut: true, reason: 'the reviewer (round 1) ran past its 20-minute limit' } }] }));
  assert.match(result.reason, /20-minute limit/);
  assert.equal(result.costLines.length, 2);
});

test('the attempt token goes forwards and never collides with the first attempt\'s names', () => {
  assert.equal(attemptTag(1), 'a1');
  assert.equal(attemptTag(7), 'a7');
  assert.equal(attemptTag(0), 'a1');
  assert.equal(attemptTag(undefined), 'a1');
});
