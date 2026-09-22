// step-runner.mjs -- JUL-98 step 3: how the controller actually uses a worker,
// start to finish, in ONE order.
//
// The pieces each have their own file and their own tests. This is the order
// they happen in, which is itself a rule:
//
//   1. dispatch a FRESH worker (./dispatch.mjs)
//   2. prove its turn really started (./turn-start.mjs). If nothing was
//      observed, take ONE bounded look at the mailbox before concluding
//      anything: it is the only authoritative record of what a worker did, and
//      a turn that began and ended between two terminal readings looks exactly
//      like a turn that never began (round 2, finding 2). A worker that
//      reported is costed for real; one that sent anything of its own is
//      waited on. Only when the mailbox says NOTHING is Orca asked what it
//      recorded, once, through `worker-show` -- and that answer decides
//      between the three outcomes (round 4b):
//
//        live verdict, seen at any point  -> it ran; keep it, cost it
//        recorded failure signature       -> it never started; stop HERE
//        anything else, including a
//          reading that could not be taken -> POSSIBLY RUNNING: keep the
//          worktree, read the cost, release nothing, start no backup
//
//      That stop is still seconds, not the eight hours of 19-20 September.
//   3. sleep on the mailbox until that worker's own worker_done arrives
//      (./mailbox.mjs), mirroring every message to Axiom on the way
//   4. run the test suite ONCE, as the controller, in the candidate worktree
//      (./test-run.mjs) -- the same result object goes to both seats
//   5. READ THE COST, then release the worker, then remove its worktree
//      (./release.mjs). Never any other way round.
//
// Every boundary is injected. Nothing here calls Orca, Linear, Axiom or git;
// step 4 is what wires the real implementations and switches it on.

import { dispatchWorker } from './dispatch.mjs';
import { proveTurnStarted } from './turn-start.mjs';
import { waitForWorkerDone } from './mailbox.mjs';
import { finishWorker, assertEverySeatCosted } from './release.mjs';
import { formatCostLine, neverStartedCostLine, readFailedCostLine, assertCostLineComplete } from './cost.mjs';
// The seat rules are scripts/seat-labels.mjs's, imported rather than repeated.
// A seat that CANNOT BE LAUNCHED takes exactly the route a CAPPED seat already
// takes (JUL-98 step 2, item 6): the same `fallbackSeatChoice`, the same seat
// table, the same family guard. There is no second fallback machine here.
import { fallbackSeatChoice } from '../../scripts/seat-labels.mjs';

// How long the ONE reconciliation look at the mailbox may block for before a
// seat is declared never-started. A worker that has already reported is in the
// mailbox now and answers immediately; this is the margin for one that reported
// a moment ago or is slow to pick the brief up. Short, because the alternative
// failure -- sleeping on a worker that is going nowhere -- is the eight-hour
// stall of 19-20 September.
export const DEFAULT_RECONCILE_WAIT_MS = 30000;

// How many deliveries that reconciliation may read before it gives up, whatever
// the clock says. The budget above bounds TIME, and a mailbox that answers
// instantly -- a replay storm, or a long poll that returns without consuming
// its timeout -- barely spends any, so time alone bounds nothing. Round 2's
// `maxWaits: 1` was a hard cap on reads and removing it removed that bound:
// this replaces it. Eight is well past what a controller carrying one card at a
// time puts on its own mailbox in half a minute, and far short of a spin.
export const DEFAULT_RECONCILE_MAX_READS = 8;

// Both detectors below read ONE shape, and there is no unwrapping left to do:
// the `result` of an `orchestration worker-show` answer, exactly as
// ./wiring.mjs's `workerShowImpl` hands it over. That boundary goes through
// `orcaCall`, which already returns `parsed.result` (scripts/orca-cli.mjs), so
// no producer passes anything else.
//
// ROUND 4b REMOVED THREE LEGS THAT ENCODED SHAPES NOTHING PRODUCES: `.show`,
// which only ever came from a test stand-in; `.observed`, which in production
// is the adopt route's `{ busy: {...} }` (scripts/controller-adopt.test.mjs)
// and carries no verdict; and `.result`, kept at first for "a caller that
// forgot to unwrap", which is a caller that does not exist. The first two made
// the detectors look like they could read a turn-start reading. They cannot;
// see `workerShowImpl` in ./wiring.mjs.

// THE RECORDED FAILURE SIGNATURE (JUL-98 step 6, round 4; Todd Decision 2026-09-22 15:01:01Z).
// Orca recorded failure signature (failed at agent readiness, no agent terminal)
// means the worker never started. Concluded ONLY on these exact five fields:
//   1. worker.state === 'failed'
//   2. worker.stage === 'agent_readiness'
//   3. worker.agentTerminalHandle === null
//   4. dispatch.status === 'failed'
//   5. typeof dispatch.lastFailure === 'string' && dispatch.lastFailure.length > 0
// Read from:
//   - graph/fixtures/orca-1.4.205/worker-show.failed-agent-readiness.json
//   - graph/fixtures/orca-1.4.205/base-checkout.new-path-untrusted.worker-show.json
//   - docs/research/jul109-orca-1.4.205-findings.md (section 2 fact 3, section 4a)
//   - coordinator live measurement at 15:53:09Z (agent-trust-workspace blocked)
export function hasFailedAgentReadinessSignature(candidate) {
  if (!candidate) return false;
  const worker = candidate.worker ?? null;
  const dispatch = candidate.dispatch ?? null;

  return (
    worker?.state === 'failed' &&
    worker?.stage === 'agent_readiness' &&
    worker?.agentTerminalHandle === null &&
    dispatch?.status === 'failed' &&
    typeof dispatch?.lastFailure === 'string' &&
    dispatch.lastFailure.length > 0
  );
}

// POSITIVE LIVENESS VERDICT (JUL-98 step 6, round 4; Todd Decision 2026-09-22 15:01:01Z).
// "Orca liveness verdict live, seen at any point, means the worker ran."
// If live is seen in projection.liveness.verdict, worker.liveness.verdict,
// or observation.status at any point, seenLive is recorded true, preventing
// any never-started conclusion even if the mailbox is silent.
export function hasLiveLivenessVerdict(candidate) {
  if (!candidate) return false;
  if (candidate.liveness?.verdict === 'live') return true;
  if (candidate.projection?.liveness?.verdict === 'live') return true;
  if (candidate.worker?.liveness?.verdict === 'live') return true;
  if (candidate.observation?.status === 'live') return true;
  return false;
}

// One seat, one step.
export async function runWorkerStep({
  seat,
  card,
  step,
  choice,
  files = [],
  environment,
  runId,
  from,
  repo,
  worktreeName,
  requestId,

  workerStartImpl,
  // The Orca boundaries the START-THEN-ADOPT route needs (JUL-98 step 6), for
  // the seats `worker-start --agent` has no launcher for. Passed straight
  // through: ./dispatch.mjs decides whether they are used at all.
  adoptBoundaries = {},
  // Returns whatever the controller has observed about the start: a
  // `terminal send --wait-submit` answer, a `worktree ps` worktree, or both.
  // It is the only thing allowed to look at the worker before it reports.
  observeStartImpl,
  // THE START RULE'S PRODUCTION SOURCE (JUL-98 step 6 round 4b). Answers Orca's
  // worker-show INSPECT structure for one dispatch -- the only reading that
  // carries the rule's fields; `observeStartImpl` above cannot (./wiring.mjs).
  // Asked ONCE, below, and only where the alternative is to conclude
  // never-started. Absent or throwing, the step keeps the worker.
  workerShowImpl = null,
  checkWaitImpl,
  suiteRunner,
  suiteKey,
  readCostImpl,
  releaseImpl,
  removeWorktreeImpl,
  mirrorImpl = null,
  runSuite = true,
  waitOptions = {},
  // The BOUNDED look at the mailbox taken before a seat is declared
  // never-started (item 2 below). Separate from `waitOptions` on purpose: this
  // one must stay short, because it happens on the path that exists to catch a
  // worker that is going nowhere.
  reconcileOptions = {},
  // The controller's own clock, for a seat whose vendor records no duration.
  now = () => new Date().toISOString(),
  // The clock the reconciliation's budget is measured on, in milliseconds.
  // Defaults to `performance.now()`, which is monotonic and unaffected by wall
  // clock steps. Injected so a test can spend the budget without sleeping.
  clockMs = () => performance.now(),
} = {}) {
  // 1. A fresh worker.
  const dispatched = await dispatchWorker({
    workerStartImpl, adoptBoundaries, environment, runId, from, repo,
    seat, card, step, choice, files, worktreeName, requestId, now,
  });
  if (!dispatched.ok) {
    // ITEM 2 (JUL-98 step 5, fifth fix): A SEAT THAT NEVER STARTED IS COSTED AS
    // ONE, NOT LEFT BLANK. Nothing was launched, so there is no session file to
    // read -- exactly the case ./cost.mjs's `neverStartedCostLine` already
    // exists for, and it is reused here rather than a second line being
    // written. Without it the seat had NO cost line at all, and
    // `assertEverySeatCosted` then reported the stop as "no cost line for the
    // <seat> seat" -- which is what the live JUL-92 run put on the card while
    // the real reason (the reviewer's entry was refused before dispatch) was
    // said nowhere. The mark is explicit, so an ORDINARY blank line still fails
    // the step exactly as before.
    return {
      ok: false,
      seat,
      stage: 'dispatch',
      reason: dispatched.reason,
      launchRefused: dispatched.launchRefused === true,
      dispatchId: dispatched.dispatchId ?? null,
      residualResources: dispatched.residualResources ?? [],
      cost: neverStartedCostLine({ seat, reason: dispatched.reason }),
    };
  }

  // A closure so every exit below cleans up the same way, in the same order.
  //
  // `turnStarted` is the ONE thing an exit has to tell it. A worker whose turn
  // never began wrote no session file -- no Claude transcript, no Codex
  // rollout, no Pi message_end -- so asking the real reader for its figures can
  // only fail, and that failure stops the order at step 1 and LEAKS the
  // worktree (the 19-20 September case, which is the whole reason this step
  // exists). So the turn-start exit below says so, `finishWorker` skips the
  // read and gives the seat an explicit never-started line, and cleanup still
  // runs. It defaults to true, so every worker that DID run is unchanged:
  // read, then release, then remove, with a bad cost still stopping the rest.
  async function close(partial, { turnStarted = true } = {}) {
    const finished = await finishWorker({
      seat,
      dispatchId: dispatched.dispatchId,
      worktree: dispatched.worktree,
      // The agent that was ACTUALLY launched travels with the read. A seat that
      // moved to its backup is a different vendor from the one the card's label
      // resolved to, and the cost reader has to read the session file of the
      // vendor that ran -- not the one that was refused.
      readCostImpl: (args) => readCostImpl({
        ...args,
        agent: dispatched.launch?.agent ?? null,
        model: dispatched.launch?.model ?? null,
        // An allowance-billed seat has no session file: its only figure is the
        // difference between the reading taken before it started and one taken
        // now (./cost.mjs geminiExtractFromAllowance).
        allowanceBefore: dispatched.allowanceBefore ?? null,
        // The controller started it and has now seen it report: that IS the
        // duration for a vendor that records none.
        startedAt: dispatched.startedAt ?? null,
        endedAt: dispatched.startedAt ? now() : null,
      }),
      releaseImpl,
      removeWorktreeImpl,
      turnStarted,
      ...(turnStarted === false && partial?.reason ? { neverStartedReason: partial.reason } : {}),
    });
    return {
      ...partial,
      seat,
      dispatchId: dispatched.dispatchId,
      taskId: dispatched.taskId,
      terminal: dispatched.terminal,
      worktree: dispatched.worktree,
      cost: finished.cost,
      released: finished.released,
      worktreeRemoved: finished.worktreeRemoved,
      // A step is only ok if the work succeeded AND its figures were read.
      ok: Boolean(partial.ok) && finished.ok,
      reason: partial.reason ?? finished.reason,
    };
  }

  // 2. Proof the turn started. Nothing is waited on until this holds.
  //
  // A dispatch that carries its OWN observation is believed and nothing else is
  // asked. That is the start-then-adopt route (JUL-98 step 6): Orca reports the
  // agent's provider as `unsupported` for turn observation and tracks no agent
  // for it, so `worktree ps` -- the only thing `observeStartImpl` can look at --
  // would answer `agents: []` for a worker that is visibly working. The route
  // takes the one reading Orca can still give, and ./turn-start.mjs judges it
  // by the same rules as every other seat's.
  const observed = dispatched.observed ?? await observeStartImpl({ seat, dispatch: dispatched });
  const proof = proveTurnStarted(observed ?? {});

  // SEEN LIVE HAS EXACTLY ONE SOURCE, AND IT IS worker-show (round 4b). Round 4
  // seeded this from `dispatched` and `observed`; neither can carry a verdict,
  // so the seed was always false and the rule had no live branch at all. Why
  // neither can: ./wiring.mjs, above `workerShowImpl`. It is taken below.
  let seenLive = false;
  let heard = null;
  let initialAck = waitOptions.initialAck ?? null;

  if (!proof.started) {
    // THE RECONCILIATION (JUL-98 step 6, round 2, finding 2), and why a
    // not-started reading is no longer a verdict on its own.
    //
    // Every turn-start proof this controller has is an OBSERVATION OF A
    // TERMINAL, and each one has the same hole: a turn that begins and ends
    // between two readings looks exactly like a turn that never began. The
    // adopt route's window is seconds wide (./adopt.mjs DEFAULT_BUSY_WINDOW_MS)
    // and a short step can fit inside it. Round 1 called that never-started,
    // skipped the mailbox entirely, threw away the real allowance in favour of
    // a zero-cost never-started line, and released the seat -- and because that
    // exit carries no `launchRefused`, no backup ran either. A finished step
    // and its cost were simply lost.
    //
    // The mailbox is the one AUTHORITATIVE record of what a worker did: a
    // worker that reported demonstrably ran, and so did one that sent a
    // heartbeat. So it is asked FIRST, and briefly -- a bounded look, not the
    // long sleep this whole step exists to avoid (the 19-20 September
    // eight-hour stall). Three answers, three different truths:
    //
    //   * a worker_done  -- the turn ran and finished. Keep the REAL cost.
    //   * any other message from this dispatch -- it is alive and still
    //     working, so fall through to the ordinary wait.
    //   * nothing at all -- combined with the idle reading, that is the
    //     never-started case, and it is now a fact rather than an inference.
    //
    // AND WHY IT IS A BUDGET, NOT ONE DELIVERY (round 3). Round 2 asked for
    // exactly one delivery (`maxWaits: 1`). But this mailbox belongs to the
    // CONTROLLER, not to this worker: every card in flight, every earlier
    // dispatch and every replayed delivery wakes the same wait. So a single
    // unrelated or replayed message consumed the one look, nothing in it
    // belonged to this worker, and the code fell through to the never-started
    // path anyway -- zero cost line, resources released, a backup started
    // beside a seat that had already finished, and its real allowance thrown
    // away. That is finding 2's own failure mode through a narrower door.
    //
    // A DELIVERY THAT CARRIES NO MESSAGE FOR THIS WORKER IS NOT A VERDICT. So
    // the look reads ON past it, and what bounds it is TIME, not deliveries:
    // one budget, shared across however many deliveries arrive, with each read
    // given only what is left of it. The never-started case is unchanged --
    // an expired wait that carried nothing at all still answers at once, in one
    // read -- and the busy-mailbox case can now cost the budget and no more.
    const {
      timeoutMs: reconcileBudgetMs = DEFAULT_RECONCILE_WAIT_MS,
      maxReads: reconcileMaxReads = DEFAULT_RECONCILE_MAX_READS,
      ...reconcileRest
    } = reconcileOptions;
    const reconcileDeadline = clockMs() + reconcileBudgetMs;
    const reconciledMessages = [];
    let reconciled = null;
    let fromThisWorker = [];
    let reads = 0;
    let mirrorFailures = 0;
    let remainingMs = reconcileBudgetMs;

    for (;;) {
      reconciled = await waitForWorkerDone({
        checkWaitImpl,
        terminal: from,
        runId,
        dispatchId: dispatched.dispatchId,
        mirrorImpl,
        initialAck,
        maxWaits: 1,
        ...reconcileRest,
        timeoutMs: remainingMs,
      });
      reads += 1;
      // NO LIVENESS DETECTOR HERE (round 4b, and this is TASK 3 of round 4b).
      // Round 4 asked `hasLiveLivenessVerdict(reconciled)` of every batch. A
      // batch is `{runId, deliveryId, messages[], count, timedOut}` -- a
      // mailbox delivery, never an Orca inspect structure -- so the call had no
      // `liveness`, `projection`, `worker` or `observation` key to find and
      // could not fire whatever the mailbox said. What a message from this
      // worker DOES prove is handled where it is proof: `fromThisWorker` below
      // breaks the loop, and a `worker_done` is the real cost.
      mirrorFailures += reconciled.mirrorFailures ?? 0;
      reconciledMessages.push(...(reconciled.messages ?? []));
      fromThisWorker = reconciledMessages.filter((message) => message.dispatchId === dispatched.dispatchId);
      // CARRY THE ACKNOWLEDGEMENT FORWARD on every exit path that has one
      // (round 3 P2a): if a message from this worker breaks the loop, the
      // ordinary wait that follows must not re-read this delivery.
      if (reconciled.acknowledged != null) {
        initialAck = reconciled.acknowledged;
      }
      if (reconciled.outcome != null || fromThisWorker.length > 0) break;
      // A wait that expired carrying NOTHING AT ALL is the answer, not a step
      // towards one: there is no traffic to read past. It is the never-started
      // reading, and it is given at once rather than after the budget.
      if ((reconciled.messages ?? []).length === 0) break;
      // READING ON IS ONLY POSSIBLE WHILE A DELIVERY CAN BE ACKNOWLEDGED.
      // ./mailbox.mjs takes its ack from the delivery's own id, and JUL-109
      // section 4a is that an unacknowledged delivery "will keep waking the
      // next check --wait". A delivery carrying messages but no id to
      // acknowledge therefore comes back identical however often it is asked
      // for, so asking again learns nothing and merely spins for the budget.
      if (reconciled.acknowledged == null) break;
      // TWO BOUNDS, because one is not enough. The budget bounds a mailbox that
      // makes this look WAIT; the read cap bounds one that answers INSTANTLY,
      // where the clock barely moves and the budget alone would allow a spin.
      if (reads >= reconcileMaxReads) break;
      remainingMs = reconcileDeadline - clockMs();
      if (remainingMs <= 0) break;
    }

    if (reconciled?.outcome != null) {
      // EVERYTHING HEARD ON THE WAY, not just the delivery that carried the
      // verdict: the foreign ones were mirrored too, and a mirror that failed
      // while hearing one is part of this step's record as much as any other.
      heard = { ...reconciled, messages: reconciledMessages, mirrorFailures, waits: reads };
    } else if (fromThisWorker.length > 0) {
      // `initialAck` is already chained to the last delivery read above, so the
      // ordinary wait below starts where this look stopped.
    } else {
      // THE VERDICT IS ASKED FOR HERE, AND ONLY HERE (JUL-98 step 6 round 4b).
      //
      // Nothing has come from this worker: no outcome, no message of its own.
      // That is the ONE point at which the three-way start rule has to choose,
      // so it is the one point at which Orca is asked what it recorded about
      // this dispatch -- one `worker-show`, on the path that would otherwise
      // conclude never-started, and never on the ordinary path where a worker
      // answered for itself.
      //
      // WHY IT IS ASKED AT ALL. Round 4 read the rule's five fields off
      // `observed` and `dispatched`, neither of which carries them, so the
      // failure-signature branch could not fire in the running controller and
      // the rule silently degraded to one outcome. The shapes, and which verb
      // does answer: ./wiring.mjs, above `workerShowImpl`.
      let shown = null;
      let showError = null;
      try {
        // `seat` travels for the same reason it travels to `observeStartImpl`
        // above: the production boundary ignores it (./wiring.mjs), and a
        // boundary that wants to say WHICH seat it is answering about -- a
        // fixture Orca, a diagnostic -- has it without a second signature.
        shown = workerShowImpl ? await workerShowImpl({ seat, dispatchId: dispatched.dispatchId }) : null;
      } catch (error) {
        showError = error.message;
      }
      if (hasLiveLivenessVerdict(shown)) seenLive = true;

      // AN OBSERVATION THAT ITSELF FAILED IS NOT A VERDICT, and neither is one
      // that was never taken. `showError != null` is a controller that could
      // not ask; `shown == null` is a controller with no boundary to ask
      // through. Both fall to possibly-running below: absence is not proof, and
      // the cost of being wrong here is releasing a worker that is still
      // spending and starting a second one beside it.
      if (!seenLive && showError == null && hasFailedAgentReadinessSignature(shown)) {
        // THE RECORDED FAILURE SIGNATURE (JUL-98 step 6, round 4; Todd Decision 2026-09-22 15:01:01Z):
        // "Orca recorded failure signature (failed at agent readiness, no agent terminal)
        // means it never started."
        // Concluded ONLY on this exact recorded signature.
        // THE CARD SAYS WHAT DECIDED IT. `proof.reason` describes the
        // turn-start READING ("nothing was observed at all"), which on its own
        // is exactly the ambiguous sentence round 2 found: a turn that began
        // and ended between two readings says the same. What makes this a
        // never-started VERDICT is Orca's own record, so the record is quoted.
        const closed = await close({
          ok: false,
          stage: 'turn-start',
          reason: `${proof.reason} -- and Orca's own record for dispatch ${dispatched.dispatchId} is the recorded never-started signature: the worker failed at stage agent_readiness with no agent terminal (${shown?.dispatch?.lastFailure})`,
          retryRequestId: proof.retryRequestId ?? null,
          warnings: proof.warnings,
          outcome: null,
          testRun: null,
        }, { turnStarted: false });
        return { ...closed, launchRefused: closed.released === true && closed.worktreeRemoved === true };
      }

      // EVERYTHING ELSE IS TREATED AS POSSIBLY RUNNING (Todd Decision 2026-09-22 15:01:01Z):
      // "Everything else is treated as possibly running: its worktree is kept,
      // its cost is read, no backup starts beside it. Not seeing live is never
      // proof of never-started."
      //
      // Covers: budget exhausted, cap exhausted, observation failed, nothing heard at all.
      let cost = null;
      try {
        cost = await readCostImpl({
          seat,
          dispatchId: dispatched.dispatchId,
          worktree: dispatched.worktree,
          agent: dispatched.launch?.agent ?? null,
          model: dispatched.launch?.model ?? null,
          allowanceBefore: dispatched.allowanceBefore ?? null,
          startedAt: dispatched.startedAt ?? null,
          endedAt: dispatched.startedAt ? now() : null,
        });
        assertCostLineComplete(cost);
      } catch (error) {
        cost = readFailedCostLine({
          seat,
          model: dispatched.launch?.model ?? null,
          reason: error.message,
        });
      }

      // WHAT THE CARD IS TOLD. Every branch below ends in the same outcome --
      // possibly running -- so what differs is the EVIDENCE, and the card gets
      // whatever of it there is. The kept/read/not-released/no-backup clause is
      // written once, at the end, because it is true of all of them.
      //
      // A SEAT ORCA CALLS LIVE COMES FIRST, and it is the finding that put this
      // cascade in order (round 4b review, spec axis). `proof.reason` says
      // "nothing was observed at all", which for a worker Orca reports LIVE is
      // simply false: the turn-start reading saw nothing, but Orca did. Said
      // plainly, the card was reporting a demonstrably running worker as though
      // nothing had been seen of it, with only the `seenLive` flag to say
      // otherwise.
      //
      // AND THE TWO FAILURES ARE NAMED TOGETHER, not one instead of the other:
      // a seat can be adopted-but-unobservable AND have a worker-show that
      // failed, and both are facts about the same stuck seat.
      const failures = [
        dispatched.observationError ? `the adopt route could not observe it (${dispatched.observationError})` : null,
        showError ? `Orca could not be asked what it recorded (worker-show failed: ${showError})` : null,
      ].filter(Boolean);

      let evidence;
      if (seenLive) {
        evidence = `Orca reports it LIVE, but nothing has come from it through the mailbox yet`;
      } else if (failures.length > 0) {
        evidence = `${failures.join(', and ')} -- a reading that could not be taken is not a verdict`;
      } else if (proof.started === false) {
        evidence = `${proof.reason}, and Orca's record shows no never-started signature`;
      } else {
        evidence = `it did not report within the reconciliation budget and did not exhibit the recorded failure signature`;
      }
      const reason = `the ${seat} seat (dispatch ${dispatched.dispatchId}): ${evidence} -- it may still be running, so its worktree is kept, its cost is read, it is neither released nor removed, and no backup is started beside it`;

      return {
        ok: false,
        seat,
        stage: 'turn-start',
        possiblyRunning: true,
        launchRefused: false,
        dispatchId: dispatched.dispatchId,
        taskId: dispatched.taskId,
        terminal: dispatched.terminal,
        worktree: dispatched.worktree,
        cost,
        released: false,
        worktreeRemoved: false,
        outcome: null,
        testRun: null,
        ...(seenLive ? { seenLive: true } : {}),
        warnings: proof.warnings,
        reason,
      };
    }
  }

  // 3. Sleep on the mailbox.
  if (!heard) {
    heard = await waitForWorkerDone({
      checkWaitImpl,
      terminal: from,
      runId,
      dispatchId: dispatched.dispatchId,
      mirrorImpl,
      ...waitOptions,
      initialAck,
    });
  }

  // 4. The test suite: once, by the controller, in the candidate worktree.
  let testRun = null;
  if (runSuite && suiteRunner) {
    testRun = suiteRunner.ran(suiteKey)
      ? suiteRunner.resultFor(suiteKey)
      : await suiteRunner.runOnce({ key: suiteKey, worktree: worktreePathOf(dispatched.worktree) });
  }

  // 5. Cost, then release, then worktree.
  return close({
    ok: heard.outcome === 'succeeded',
    stage: 'done',
    outcome: heard.outcome,
    reason: heard.outcome === 'succeeded' ? null : `the ${seat} reported ${heard.outcome ?? 'nothing before the wait expired'}`,
    testRun,
    messages: heard.messages,
    mirrorFailures: heard.mirrorFailures,
    acknowledged: heard.acknowledged,
    // Todd's Decision, 2026-09-22 (JUL-92 attempt 3 and 4 both stopped this
    // exact way): a reviewer's worker_done with outcome 'failed' and no
    // findings text at all is not a verdict about the CODE -- it is the
    // reviewer's own turn producing nothing usable. runBuildAndReview below
    // reads this mark to retry the review once, rather than stopping the
    // card on a verdict that names no defect.
    reviewGaveNoVerdict: reviewGaveNoVerdict({ seat, outcome: heard.outcome, message: heard.message }),
  });
}

// Pure: does this worker_done carry anything a human or the next reviewer
// could act on? Checked only for the reviewer seat's own 'failed' outcome --
// a builder reporting failed with nothing said is a different problem
// (openScope's own existing stop already covers it) and 'succeeded' never
// needs this at all.
export function reviewGaveNoVerdict({ seat, outcome, message } = {}) {
  if (seat !== 'reviewer' || outcome !== 'failed') return false;
  const subject = String(message?.subject ?? '').trim();
  const body = String(message?.body ?? '').trim();
  return subject === '' && body === '';
}

// Orca names a worktree `<repoId>::<path>`; the suite runs in the path.
function worktreePathOf(worktreeId) {
  if (typeof worktreeId !== 'string') return worktreeId;
  const marker = worktreeId.indexOf('::');
  return marker < 0 ? worktreeId : worktreeId.slice(marker + 2);
}

// THE ATTEMPT TOKEN, and why every name a second attempt uses carries it.
//
// A stopped attempt leaves things behind. JUL-92 stopped at build-and-review on
// 2026-09-21 with the cost read refusing, which is BEFORE
// `finishWorker` releases the worker and removes its worktree -- so the
// worktree `jul-92-work` is still registered with Orca (`orca worktree list
// --json` on the host, 2026-09-21: path
// /home/runner/orca/workspaces/julia-next/jul-92-work, displayName
// `jul-92-work`, branch `refs/heads/jul-92-work`). Put the card back in Ready
// and the next attempt asks for those same names again.
//
// WHAT ORCA ACTUALLY DOES WITH A REPEATED NAME -- measured, not assumed, by
// creating the same `--name` three times on this host at 1.4.205 and recording
// the answers (graph/fixtures/orca-1.4.205/worktree-create.duplicate-name-suffixed.json):
// it does NOT refuse. It silently creates a DIFFERENT path and a DIFFERENT
// branch -- `jul98-5d-probe-2`, then `-3` -- while keeping
// `displayName: "jul98-5d-probe"` with `displayNameMode: "fixed"` on every one
// of them. So two attempts on one card leave two rows sharing one display
// name, and Orca's own `name:<displayName>` selector can then no longer address
// either: `worktree rm --worktree name:jul98-5d-probe` answered
// `selector_ambiguous`
// (graph/fixtures/orca-1.4.205/worktree-rm.duplicate-name-ambiguous.error.json).
// The controller removes by `id:`, so it survives that -- but the branch it
// publishes stops being the branch the card is named after, and no operator can
// clean up by name any more.
//
// AND THE HARDER HALF, which a unique name is the same fix for: the request
// ledger. `requestId` below is the controller's logical key for a
// `worker-start`, and ./wiring.mjs turns a key it has already seen into
// `--retry-request <id>`, which Orca REPLAYS -- "no second worker" is the whole
// point of it. A second attempt on the same card with the same key would
// therefore not start a worker at all: it would be handed the stopped
// attempt's dispatch back, whose terminal and worker are gone, and then wait on
// a mailbox nothing will ever post to.
//
// So the attempt number goes into BOTH the worktree name and the request key.
// It is not invented here: ./main.mjs counts it per card in the controller's
// state file and hands it down, so it survives a restart and can only go
// forwards. Nothing leftover is deleted to make room -- `worktree rm` "also
// attempts to delete the checked-out local branch" (`orca worktree rm --help`),
// which would destroy the stopped attempt's commits, and the coordinator reads
// that worktree.
export function attemptTag(attempt) {
  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  return `a${n}`;
}

// ITEM 1 (JUL-98 step 5, fifth fix): THE ONE COMMENT A MOVED SEAT OWES THE
// CARD. Plain English, naming the seat, the entry it was going to run on, the
// entry it ran on instead, and why. It is ONE comment: when the family guard
// also had to move the partner seat out of the way, seat-labels.mjs's own
// `partnerMovedReason` is appended to this same comment verbatim, so the board
// and the code cannot tell two different stories.
export function seatMoveComment({ seat, from, to, modelLabel, reason, partnerMovedReason = null }) {
  const lines = [
    `**The ${seat} seat moved to its backup.** It was going to run on \`${from}\`, which could not be started: ${reason}. So it ran on the backup the seat table already names for it, \`${to}\` (${modelLabel}).`,
  ];
  if (partnerMovedReason) lines.push('', partnerMovedReason);
  return lines.join('\n');
}

// One step end to end: the builder, then the reviewer, on ONE test run, with a
// cost line for each and no way to finish without both.
//
// AND THE SEAT FALLBACK (JUL-98 step 5, fifth fix). A seat whose entry CANNOT
// BE LAUNCHED at all is not a dead end: it takes the same route a CAPPED seat
// takes. `fallbackSeatChoice` -- the very function the capped case uses, with
// the same seat table and the same family guard -- resolves that seat's backup,
// the step is started again on it, and the card is told once.
//
// Why this is not a new policy: the reviewer seat's first choice is
// `pi-deepseek`. At the time this fallback was built, ./dispatch.mjs refused
// to start a DeepSeek seat with a new worktree at all (it could not report to
// the mailbox; JUL-109 section 4), so the controller could never run a review
// of any kind, on any card -- and the only thing it said about it was that a
// cost line was blank. That refusal is gone (the adopt route, then the
// JUL-98/JUL-100 follow-up's interactive-session cost reader), but this
// fallback mechanism stays: any seat whose entry cannot be launched -- for
// whatever reason, on whatever route exists at the time -- still takes its
// seat-table backup rather than stalling. The seat table has named `codex`
// as the reviewer's backup all along.
//
// THREE THINGS IT DELIBERATELY DOES NOT DO:
//   * it never tries a third entry, and never guesses one -- the backup comes
//     from the seat table or the step stops;
//   * it never runs a same-family pair: if the family guard refuses the backup,
//     the step stops and says so;
//   * it never moves a seat that has ALREADY RUN on this step. The partner move
//     `fallbackSeatChoice` can make is offered only while no seat has run yet
//     (`movePartner` below), so a reviewer falling back can never rewrite the
//     builder that is already finished.
export async function runBuildAndReview({
  card,
  step,
  choices,
  suiteRunner,
  suiteKey = `${card.identifier}:${step.key ?? step.title}`,
  seats = ['builder', 'reviewer'],
  // Which attempt on this card this is. 1 on a card that has never been
  // carried; ./main.mjs increments it before the work starts.
  attempt = 1,
  // The capped-seat resolver, injected only so a test can stand a seat table
  // in front of it. The default is the real one.
  seatFallbackImpl = fallbackSeatChoice,
  ...shared
} = {}) {
  const tag = attemptTag(attempt);
  const results = {};
  const seatMoves = [];
  const ran = new Set();
  // The choices actually in play. A seat that moves writes its move back here,
  // so a partner the family guard moved is dispatched on the entry it moved to.
  let inPlay = choices;

  const startSeat = (seat, choice, suffix) => runWorkerStep({
    seat,
    card,
    step,
    choice,
    // A second start for the same seat must collide with nothing the refused
    // one asked for -- the same rule `attemptTag` states for a second attempt.
    worktreeName: `${card.identifier.toLowerCase()}-${step.key ?? 'step'}${seat === 'reviewer' ? '-review' : ''}-${tag}${suffix}`,
    requestId: `${suiteKey}:${seat}:${tag}${suffix}`,
    suiteRunner,
    suiteKey,
    // The reviewer never re-runs the suite: it is handed the builder's run.
    runSuite: true,
    ...shared,
  });

  // A seat that could not be started at all, reported as that rather than as a
  // blank cost line. The never-started line carries the same sentence.
  const stopped = (base, seat, reason) => ({
    ...base, ok: false, reason, cost: neverStartedCostLine({ seat, reason }),
  });

  // ITEM 3 (JUL-98 step 5, round 2): WHAT "IT RAN ON THE BACKUP" IS ALLOWED TO
  // MEAN. The move comment below tells the card the seat RAN on its backup, so
  // it may only be written when the backup's worker actually got going.
  //
  // `launchRefused` is NOT that test. It marks only the one case where nothing
  // at all was created -- ./dispatch.mjs's own comment says so, and says that a
  // `worker-start` that FAILED deliberately keeps `ok: false` WITHOUT the mark.
  // Both of those come back from `runWorkerStep` with `stage: 'dispatch'` and a
  // never-started cost line (line 81 and line 86 above). A worker that was
  // created but whose turn was never proven is the same kind of thing again:
  // `stage: 'turn-start'`, `turnStarted: false`, a never-started cost line, and
  // no work done (line 138).
  //
  // Before this, only `launchRefused` took the stop path, so a backup that
  // failed at `agent_readiness` or the trust screen -- the 19-20 September
  // failure -- put three contradictory things on one card: "it ran on codex",
  // "worker-start failed at agent_readiness", and a cost line reading "never
  // started". So the gate is the stage, which covers all three.
  //
  // AND THE ONE EXCEPTION (round 2, finding 5): a seat whose OBSERVATION failed
  // after it was really adopted is `possiblyRunning`. Nothing is known about it
  // either way, so it is neither "it ran on the backup" nor "it never got
  // going": it must keep its own reason and its absent cost line, and it must
  // never be given the zero-cost never-started line `stopped` below writes.
  const neverGotGoing = (result) => (result.stage === 'dispatch' || result.stage === 'turn-start') && result.possiblyRunning !== true;

  const noVerdictRetries = [];

  for (const seat of seats) {
    const first = inPlay[seat];
    let result = await startSeat(seat, first, '');

    // TODD'S DECISION, 2026-09-22 (JUL-92 attempts 3 and 4 both stopped this
    // exact way): a reviewer's `worker_done` with outcome 'failed' and no
    // findings text at all is not a verdict about the candidate -- it is the
    // review itself coming back unusable. That is a different failure from
    // "the reviewer found something wrong", and treating it as a stop-the-card
    // verdict is what made both attempts park on nothing anyone could act on.
    // So it gets ONE retry, same entry, a fresh worker (never the backup: the
    // entry itself is not what failed) -- never an unbounded loop, so a
    // reviewer that genuinely cannot produce a verdict still stops the card,
    // just with both attempts named on it.
    if (result.reviewGaveNoVerdict) {
      const firstDispatchId = result.dispatchId;
      const retry = await startSeat(seat, first, '-noverdict-retry');
      if (retry.reviewGaveNoVerdict) {
        // Both attempts really ran and really spent -- unlike `stopped()`'s
        // other callers, there is nothing "never started" about this seat, so
        // its real cost line (already read by `close()` inside `startSeat`)
        // travels on the stop rather than being replaced with an invented
        // zero. Only `ok` and `reason` change.
        result = {
          ...retry,
          ok: false,
          reason: `the ${seat} seat reported failed with no findings or reason, twice in a row (dispatch ${firstDispatchId}, then retry dispatch ${retry.dispatchId}) -- treated as the review itself being unusable, not a verdict on the change`,
        };
      } else {
        noVerdictRetries.push({ seat, firstDispatchId, retryDispatchId: retry.dispatchId });
        result = retry;
      }
    }

    if (result.launchRefused) {
      const fromEntry = first?.entry ?? null;
      const fromReason = result.reason;
      // The partner may only be moved while nothing has run yet; once the
      // builder is finished its entry is a fact, not a choice.
      const fallback = seatFallbackImpl(inPlay, seat, { movePartner: ran.size === 0 });

      if (!fallback.ok) {
        result = stopped(result, seat, `the ${seat} seat could not be started on ${fromEntry}: ${fromReason} -- and its backup was refused too: ${fallback.reason}`);
      } else {
        const backup = fallback.choices[seat];
        const second = await startSeat(seat, backup, '-bk');
        if (second.possiblyRunning) {
          // Its cost is unknown, not zero, so the step stops on the missing
          // cost line rather than on an invented one, and the card is told no
          // seat ran on the backup.
          result = second;
        } else if (neverGotGoing(second)) {
          result = stopped(second, seat, `the ${seat} seat could not be started on ${fromEntry}: ${fromReason} -- and its backup ${backup.entry} could not be started either: ${second.reason}`);
        } else {
          inPlay = fallback.choices;
          seatMoves.push({
            seat,
            from: fromEntry,
            to: backup.entry,
            modelLabel: backup.modelLabel,
            reason: fromReason,
            partnerMoved: fallback.partnerMoved ?? null,
            comment: seatMoveComment({
              seat,
              from: fromEntry,
              to: backup.entry,
              modelLabel: backup.modelLabel,
              reason: fromReason,
              partnerMovedReason: fallback.partnerMovedReason ?? null,
            }),
          });
          result = { ...second, movedFrom: fromEntry, movedTo: backup.entry };
        }
      }
    }

    ran.add(seat);
    results[seat] = result;
  }

  const costLines = seats.map((seat) => results[seat].cost).filter(Boolean);
  let ok = seats.every((seat) => results[seat].ok);
  let reason = seats.map((seat) => results[seat].reason).find(Boolean) ?? null;
  let costText = [];
  try {
    // The gate before the card may leave its column.
    assertEverySeatCosted({ seats, costLines });
    costText = costLines.map(formatCostLine);
  } catch (error) {
    ok = false;
    reason = error.message;
  }

  return { ...results, ok, reason, costLines, costText, seatMoves, noVerdictRetries, seatChoices: inPlay, testRun: suiteRunner?.resultFor(suiteKey) ?? null, suiteKey };
}
