// controller-step-runner.test.mjs -- JUL-98 step 3: the whole of how the
// controller uses workers, in one order, on one step.
//
// The pieces are pinned in their own files (dispatch, turn-start, mailbox,
// test-run, cost, release, card-steps). What is pinned HERE is the order they
// happen in, which is where the two rules Todd added on 21 September live:
//
//   * the cost is read BEFORE the worker is released and before its worktree
//     is removed, and
//   * the card's Steps block is written and ticked by the program as the step
//     moves.
//
// Plus the one this step exists to prevent: a worker whose turn never started
// is caught AT ONCE, not waited on. The mailbox is never even opened for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runWorkerStep, runBuildAndReview, attemptTag } from '../graph/controller/step-runner.mjs';
import { createSuiteRunner } from '../graph/controller/test-run.mjs';
import { createFixtureWorkerOrca, loadOrcaFixture } from '../graph/controller/fixture-orca.mjs';
import { turnStartedFromSend } from '../graph/controller/turn-start.mjs';
import { launchForChoice } from '../graph/controller/dispatch.mjs';
import { resolveSeatChoices } from '../scripts/seat-labels.mjs';
import { SEAT_TABLE } from '../graph/seat-table.mjs';

const ALL = loadOrcaFixture('mailbox.check-all.status-heartbeat-escalation-done.json').result;
const TURN_STARTED = loadOrcaFixture('terminal-send.wait-submit.turn-started.json').result;
const NO_TURN = loadOrcaFixture('terminal-send.wait-submit.no-turn-started.json').result;

const GREEN_TAP = '# tests 522\n# pass 521\n# fail 0\n# skipped 1\n# todo 0\n';

const CARD = { identifier: 'JUL-92', title: 'Docs and settings match how things run now' };
const STEP = { key: 'step-1', title: 'Fix the stale runbook lines', brief: 'Rewrite the three stale paragraphs.', criteria: ['the runbook names the real paths'] };
const CHOICES = {
  builder: { entry: 'claude', modelLabel: 'builder-claude-opus', effort: 'medium' },
  reviewer: { entry: 'codex', modelLabel: 'adversary-codex', effort: 'medium' },
};

const COST = { model: 'claude-opus-5', totalTokens: 369994, peakContext: 62524, minutes: 0.71, usd: 0.1057, capped: false, failedOverTo: null };

// A worker_done for whatever dispatch id the fixture Orca hands out, so the
// mailbox stand-in answers about the worker that was actually started.
function doneMessage(dispatchId, outcome = 'succeeded') {
  const recorded = ALL.messages.find((message) => message.type === 'worker_done');
  return { ...recorded, payload: JSON.stringify({ taskId: 'task_x', dispatchId, outcome }) };
}

function harness({ send = TURN_STARTED, outcome = 'succeeded', cost = COST } = {}) {
  const order = [];
  const orca = createFixtureWorkerOrca();
  return {
    order,
    orca,
    deps: {
      environment: 'ovh-local',
      runId: 'run_1bf570ce5660',
      from: 'term_controller',
      repo: 'path:/home/runner/julia-next',
      workerStartImpl: async (options) => { order.push('dispatch'); return orca.workerStart(options); },
      observeStartImpl: async () => { order.push('prove-start'); return { send }; },
      checkWaitImpl: async ({ ack }) => {
        order.push('mailbox-wait');
        const dispatchId = orca.workerStartCalls().length > 0 ? lastDispatchId(orca) : 'ctx_unknown';
        return {
          runId: ALL.runId,
          deliveryId: `delivery_${order.length}`,
          messages: ack ? [doneMessage(dispatchId, outcome)] : [ALL.messages[4], doneMessage(dispatchId, outcome)],
          count: 2,
          timedOut: false,
        };
      },
      // THE STAND-IN INVENTS NOTHING. The real reader reads the worker's own
      // session file -- Claude's transcript, Codex's rollout, Pi's
      // message_end. A worker whose turn never started wrote none of them, so
      // the real reader can only fail. Handing back a figure here is how the
      // suite stayed green over a live gap in round 2: the controller sent a
      // never-started worker down the ordinary read path and the stand-in
      // covered for it. It refuses now, exactly as the real reader would.
      readCostImpl: async ({ seat }) => {
        order.push(`read-cost:${seat}`);
        if (!turnStartedFromSend(send)) {
          throw new Error(`no session file exists for the ${seat}: its turn never started, so there is no cost to read`);
        }
        return { seat, ...cost };
      },
      releaseImpl: async ({ seat }) => { order.push(`release:${seat}`); },
      removeWorktreeImpl: async ({ seat }) => { order.push(`remove-worktree:${seat}`); },
      mirrorImpl: async () => { order.push('mirror'); },
      now: () => '2026-09-21T14:00:00.000Z',
    },
  };
}

let dispatchCounter = 0;
function lastDispatchId(orca) {
  // The fixture Orca derives each dispatch id from the recorded one by suffix.
  dispatchCounter = orca.workersStarted();
  return `ctx_937abab903ae-${dispatchCounter}`;
}

test('one step, in one order: dispatch, prove the turn started, sleep on the mailbox, then the cost, then the release, then the worktree', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({
    execImpl: async () => { h.order.push('test-suite'); return { stdout: GREEN_TAP }; },
    now: () => '2026-09-21T14:00:00.000Z',
  });

  const result = await runWorkerStep({
    seat: 'builder',
    card: CARD,
    step: STEP,
    choice: CHOICES.builder,
    worktreeName: 'jul92-step-1',
    requestId: 'JUL-92:step-1:builder',
    suiteRunner,
    suiteKey: 'JUL-92:step-1',
    ...h.deps,
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.testRun.pass, 521);
  assert.equal(result.cost.totalTokens, 369994);

  const withoutMirrors = h.order.filter((entry) => entry !== 'mirror');
  assert.deepEqual(withoutMirrors, [
    'dispatch',
    'prove-start',
    'mailbox-wait',
    'test-suite',
    'read-cost:builder',
    'release:builder',
    'remove-worktree:builder',
  ]);
});

test('a worker that never started is caught at once: the mailbox is never opened and nothing is waited on', async () => {
  const h = harness({ send: NO_TURN });
  h.deps.checkWaitImpl = async () => { throw new Error('the mailbox must not be opened for a worker that never started'); };
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });

  const result = await runWorkerStep({
    seat: 'builder', card: CARD, step: STEP, choice: CHOICES.builder,
    worktreeName: 'jul92-step-1', requestId: 'r', suiteRunner, suiteKey: 'k',
    ...h.deps,
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage, 'turn-start');
  assert.match(result.reason, /input.accepted/i);
  assert.equal(result.retryRequestId, NO_TURN.send.prompt.requestId, 'Orca\'s own replay advice is carried, so confirming costs nothing');

  // AND IT IS CLEANED UP AS A NEVER-STARTED WORKER. There is no session to
  // read, so the read is not attempted at all: the seat gets an explicit
  // never-started line and the worktree still goes. Round 2 sent this worker
  // down the ordinary read path, where the real reader has nothing to read,
  // and the worktree leaked -- the 19-20 September failure exactly.
  assert.equal(result.cost.neverStarted, true, 'the seat is costed as never started, not with an invented or blank figure');
  assert.equal(result.cost.totalTokens, 0);
  assert.equal(result.released, true);
  assert.equal(result.worktreeRemoved, true, 'the workspace of a worker that never started is still removed');
  const withoutMirrors = h.order.filter((entry) => entry !== 'mirror');
  assert.deepEqual(withoutMirrors, ['dispatch', 'prove-start', 'release:builder', 'remove-worktree:builder']);
});

test('a worker that reports outcome failed is reported as failed, and is still costed and cleaned up', async () => {
  const h = harness({ outcome: 'failed' });
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });

  const result = await runWorkerStep({
    seat: 'builder', card: CARD, step: STEP, choice: CHOICES.builder,
    worktreeName: 'jul92-step-1', requestId: 'r', suiteRunner, suiteKey: 'k',
    ...h.deps,
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.ok, false);
  assert.ok(h.order.includes('read-cost:builder'));
  assert.ok(h.order.indexOf('read-cost:builder') < h.order.indexOf('release:builder'), 'a failed worker is costed before it is released too');
});

test('every mailbox message is mirrored, not just the one that ended the wait', async () => {
  const mirrored = [];
  const h = harness();
  h.deps.mirrorImpl = async (message) => { mirrored.push(message.type); };
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });

  await runWorkerStep({
    seat: 'builder', card: CARD, step: STEP, choice: CHOICES.builder,
    worktreeName: 'jul92-step-1', requestId: 'r', suiteRunner, suiteKey: 'k',
    ...h.deps,
  });
  assert.deepEqual(mirrored, ['status', 'worker_done']);
});

// --- the step as a whole: build, then review, on one test run ---------------

test('the builder and the reviewer are separate fresh workers, handed the SAME single test run', async () => {
  const h = harness();
  let suiteRuns = 0;
  const suiteRunner = createSuiteRunner({
    execImpl: async () => { suiteRuns += 1; h.order.push('test-suite'); return { stdout: GREEN_TAP }; },
    now: () => '2026-09-21T14:00:00.000Z',
  });

  const result = await runBuildAndReview({
    card: CARD, step: STEP, choices: CHOICES, suiteRunner,
    ...h.deps,
  });

  assert.equal(suiteRuns, 1, 'the suite runs once for the step, not once per seat');
  assert.equal(result.builder.testRun, result.reviewer.testRun, 'both seats were handed the very same result');
  assert.notEqual(result.builder.dispatchId, result.reviewer.dispatchId, 'two fresh workers');
  assert.equal(result.ok, true);

  assert.equal(result.costLines.length, 2);
  assert.deepEqual(result.costLines.map((line) => line.seat), ['builder', 'reviewer']);
  for (const text of result.costText) assert.match(text, /peak context/);
});

test('the step cannot be reported done while a seat has no cost line', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });
  h.deps.readCostImpl = async ({ seat }) => {
    h.order.push(`read-cost:${seat}`);
    return seat === 'reviewer' ? { seat, ...COST, peakContext: null } : { seat, ...COST };
  };

  const result = await runBuildAndReview({ card: CARD, step: STEP, choices: CHOICES, suiteRunner, ...h.deps });
  assert.equal(result.ok, false);
  assert.match(result.reason, /peakContext/);
  assert.ok(!h.order.includes('release:reviewer'), 'and the reviewer was not released with its figures unread');
});

// ---------------------------------------------------------------------------
// A SECOND ATTEMPT ON THE SAME CARD (JUL-98 step 5, third fix)
// ---------------------------------------------------------------------------

// The live JUL-92 run stopped at build-and-review, which is before the worker
// is released and its worktree removed -- so `jul-92-work` is still registered
// with Orca. These pin what a second attempt asks for, and the recorded reason
// it has to ask for something different.
test('a repeated worktree name is not refused by Orca -- it is silently suffixed, and the shared display name then addresses nothing', () => {
  const again = loadOrcaFixture('worktree-create.duplicate-name-suffixed.json').result.worktree;
  assert.equal(again.displayName, 'jul98-5d-probe', 'the third create with that same --name');
  assert.equal(again.path, '/home/runner/orca/workspaces/julia-next/jul98-5d-probe-3', 'a DIFFERENT path');
  assert.equal(again.branch, 'refs/heads/jul98-5d-probe-3', 'and a DIFFERENT branch than the name asked for');

  const rm = loadOrcaFixture('worktree-rm.duplicate-name-ambiguous.error.json');
  assert.equal(rm.ok, false);
  assert.equal(rm.error.code, 'selector_ambiguous', "and Orca's own name:<displayName> selector can then address neither");
});

test('a second attempt on the same card asks for a NEW worktree name and a NEW request key, so it collides with nothing a stopped attempt left behind', async () => {
  const h = harness();
  const runner = () => createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });

  const first = await runBuildAndReview({ card: CARD, step: STEP, choices: CHOICES, suiteRunner: runner(), attempt: 1, ...h.deps });
  const second = await runBuildAndReview({ card: CARD, step: STEP, choices: CHOICES, suiteRunner: runner(), attempt: 2, ...h.deps });

  const calls = h.orca.workerStartCalls();
  assert.equal(calls.length, 4, 'two seats, twice');
  assert.deepEqual(calls.map((call) => call.name), [
    'jul-92-step-1-a1', 'jul-92-step-1-review-a1',
    'jul-92-step-1-a2', 'jul-92-step-1-review-a2',
  ], 'every name carries its attempt, so no name is ever asked for twice');
  assert.equal(new Set(calls.map((call) => call.requestId)).size, 4, 'and so does every request-ledger key');

  // The request key is the half that would bite hardest: the ledger turns a
  // repeated key into `--retry-request`, which Orca REPLAYS. Without the
  // attempt in it, the second attempt would be handed the stopped attempt's
  // dispatch -- a worker that no longer exists -- and would then wait on a
  // mailbox nothing will ever post to.
  const dispatchIds = [first.builder.dispatchId, first.reviewer.dispatchId, second.builder.dispatchId, second.reviewer.dispatchId];
  assert.equal(new Set(dispatchIds).size, 4, 'four real workers, no replayed dispatch');
  assert.equal(second.ok, true);
});

test('the attempt number defaults to the first attempt, and a nonsense one is still a usable name', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });
  await runBuildAndReview({ card: CARD, step: STEP, choices: CHOICES, suiteRunner, ...h.deps });
  assert.deepEqual(h.orca.workerStartCalls().map((call) => call.name), ['jul-92-step-1-a1', 'jul-92-step-1-review-a1']);
  assert.equal(attemptTag(undefined), 'a1');
  assert.equal(attemptTag(0), 'a1');
  assert.equal(attemptTag(7), 'a7');
});

// ---------------------------------------------------------------------------
// A SEAT THAT CANNOT BE LAUNCHED AT ALL (JUL-98 step 5, fifth fix)
// ---------------------------------------------------------------------------
//
// THE LIVE FAILURE these pin, from the JUL-92 run of 2026-09-21. The controller
// took the card, built it, ran the suite and costed the builder -- then stopped
// and wrote "no cost line for the reviewer seat". That was TRUE and it was not
// the reason: the reviewer seat's first choice is `pi-deepseek`, and
// graph/controller/dispatch.mjs refuses to start a DeepSeek seat with a new
// worktree outright (PI_REFUSAL: it cannot report to the mailbox, JUL-109
// section 4). The seat never ran, so it had no cost line, and the blank was the
// only thing the card was told.
//
// The seat table has named `codex` as that seat's backup all along. These pin
// that it is now USED -- through the very same `fallbackSeatChoice` a capped
// seat uses, with the same family guard -- and that a stop says the refusal.

test('a reviewer seat whose entry cannot be launched runs on its seat-table backup instead, and the step continues', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });

  // The card's OWN resolution, with no model labels at all: builder `claude`,
  // reviewer `pi-deepseek` -- which is exactly what the live run had.
  const choices = resolveSeatChoices([]);
  assert.equal(choices.reviewer.entry, 'pi-deepseek', 'the reviewer first choice is unchanged by this fix');
  assert.equal(launchForChoice(choices.reviewer).ok, false, 'and it still cannot be launched');

  const result = await runBuildAndReview({ card: CARD, step: STEP, choices, suiteRunner, ...h.deps });

  assert.equal(result.ok, true, 'the step ran to the end instead of stopping on a seat that could not start');
  assert.equal(result.reviewer.movedFrom, 'pi-deepseek');
  assert.equal(result.reviewer.movedTo, 'codex', 'the backup the seat table already names');
  assert.equal(result.reviewer.outcome, 'succeeded');

  const started = h.orca.workerStartCalls();
  assert.deepEqual(started.map((call) => call.agent), ['claude', 'codex'], 'only two workers: the refused entry never reached worker-start');
  assert.equal(started[1].name, 'jul-92-step-1-review-a1-bk', 'the second start asks for a name the refused one did not');
  assert.notEqual(started[0].requestId, started[1].requestId);
  assert.equal(result.costLines.length, 2);
});

test('exactly ONE comment is written for the move, naming both entries and the reason', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });
  const result = await runBuildAndReview({ card: CARD, step: STEP, choices: resolveSeatChoices([]), suiteRunner, ...h.deps });

  assert.equal(result.seatMoves.length, 1, 'one move, one comment -- not one per attempt and not one per seat');
  const [moved] = result.seatMoves;
  assert.equal(moved.seat, 'reviewer');
  assert.equal(moved.from, 'pi-deepseek');
  assert.equal(moved.to, 'codex');
  assert.equal(moved.partnerMoved, null, 'nothing else had to move: claude and codex are already different families');
  assert.equal(
    moved.comment,
    '**The reviewer seat moved to its backup.** It was going to run on `pi-deepseek`, which could not be started: '
    + 'a DeepSeek (Pi) seat cannot be started with a new worktree: the only recorded route that reports to the mailbox '
    + 'is an interactive Pi adopted with worker-start --terminal once it has fully started (JUL-109 findings, section 4), '
    + 'and it carries no model or effort. So it ran on the backup the seat table already names for it, `codex` '
    + '(adversary-codex).',
  );
});

test('a backup that ALSO cannot be launched stops the step, with both entries and both reasons named', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });
  const choices = resolveSeatChoices([]);

  // Today's table has no seat whose backup the launcher also refuses, and this
  // code must not depend on that staying true. The real resolver is stood in
  // front of with one whose backup is a model label no launch model id exists
  // for -- the launcher's OTHER refusal (dispatch.mjs `launchForChoice`).
  const seatFallbackImpl = (given, seat) => ({
    ok: true,
    partnerMoved: null,
    partnerMovedReason: null,
    choices: { ...given, [seat]: { entry: 'claude', modelLabel: 'adversary-claude-turbo', effort: 'medium' } },
  });

  const result = await runBuildAndReview({ card: CARD, step: STEP, choices, suiteRunner, seatFallbackImpl, ...h.deps });

  assert.equal(result.ok, false);
  assert.match(result.reason, /the reviewer seat could not be started on pi-deepseek/);
  assert.match(result.reason, /DeepSeek \(Pi\) seat cannot be started with a new worktree/, 'the first reason');
  assert.match(result.reason, /its backup claude could not be started either/);
  assert.match(result.reason, /no launch model id for model label "adversary-claude-turbo"/, 'the second reason');
  assert.equal(result.seatMoves.length, 0, 'nothing moved, so the card is told of no move');
  assert.equal(h.orca.workerStartCalls().length, 1, 'only the builder ever reached worker-start; no third entry was tried');
});

test('the family guard still refuses a same-family pair, and that refusal stops the step rather than running it', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });

  // A card that names Codex for the feature builder. The reviewer's first
  // choice is refused, and its seat-table backup is Codex TOO -- so the backup
  // would put builder and reviewer in the same (openai) family. The builder has
  // already run by then, so it cannot be moved out of the way, and the real
  // `fallbackSeatChoice` refuses. Nothing here overrides the seat table.
  const choices = resolveSeatChoices(['builder-codex']);
  assert.equal(choices.builder.entry, 'codex');
  assert.equal(SEAT_TABLE['adversarial-reviewer'].backup, 'codex');

  const result = await runBuildAndReview({ card: CARD, step: STEP, choices, suiteRunner, ...h.deps });

  assert.equal(result.ok, false);
  assert.match(result.reason, /and its backup was refused too: refusing the reviewer backup \(codex\)/);
  assert.match(result.reason, /both from the openai model family/, "the family guard's own words, not a second copy of them");
  assert.equal(result.seatMoves.length, 0);
  assert.deepEqual(h.orca.workerStartCalls().map((call) => call.agent), ['codex'], 'the same-family pair was never dispatched');
});

test('a seat refused before dispatch gets an explicit never-started cost line naming the refusal, and the stop names the refusal rather than a blank cost line', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });
  const result = await runBuildAndReview({ card: CARD, step: STEP, choices: resolveSeatChoices(['builder-codex']), suiteRunner, ...h.deps });

  const line = result.costLines.find((entry) => entry.seat === 'reviewer');
  assert.equal(line.neverStarted, true, 'the seat is costed as never started, the way a worker whose turn never began already is');
  assert.equal(line.totalTokens, 0);
  assert.equal(line.usd, 0);
  assert.match(line.reason, /DeepSeek \(Pi\) seat cannot be started/);

  // THE LIVE FAILURE, gone: the card was told the cost line was blank and was
  // never told the seat had been refused.
  assert.equal(result.costLines.length, 2, 'the reviewer HAS a line, so the blank-cost gate is not what stops the step');
  assert.doesNotMatch(result.reason, /no cost line for the reviewer seat/);
  assert.match(result.reason, /could not be started/);
  const reviewerText = result.costText.find((text) => text.startsWith('- **Reviewer**'));
  assert.match(reviewerText, /never started/);
  assert.match(reviewerText, /DeepSeek \(Pi\) seat cannot be started/);
});

test('an ordinary blank cost line still fails the step, and the never-started mark does not excuse it', async () => {
  const h = harness();
  const suiteRunner = createSuiteRunner({ execImpl: async () => ({ stdout: GREEN_TAP }), now: () => '2026-09-21T14:00:00.000Z' });
  // A seat that DID run and came back with nothing: no mark, no figures.
  h.deps.readCostImpl = async ({ seat }) => {
    h.order.push(`read-cost:${seat}`);
    return seat === 'reviewer' ? { seat } : { seat, ...COST };
  };

  const result = await runBuildAndReview({ card: CARD, step: STEP, choices: CHOICES, suiteRunner, ...h.deps });
  assert.equal(result.ok, false);
  assert.match(result.reason, /the reviewer seat's cost line is blank in: model, totalTokens, peakContext, minutes/);
  assert.ok(!h.order.includes('release:reviewer'), 'and it was not released with its figures unread');
});
