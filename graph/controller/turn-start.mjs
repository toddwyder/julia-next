// turn-start.mjs -- JUL-98 step 3, item 3: proof that a worker's turn actually
// STARTED, as opposed to a prompt that was merely accepted.
//
// WHY THIS FILE EXISTS. On 19-20 September a builder sat at Claude Code's
// folder-trust screen for about eight hours. Orca had said `input_accepted`;
// nothing asked it whether a turn had begun, and `input_accepted` was read as
// "it is working". Orca distinguishes the two and always did:
//
//   terminal-send.wait-submit.turn-started.json       stages: input_accepted,
//                                                     turn_started
//   terminal-send.wait-submit.no-turn-started.json    stages: input_accepted
//                                                     ONLY, plus Orca's own
//                                                     warning naming the
//                                                     request id to replay with
//
// AND A THIRD, FOR AN AGENT ORCA CANNOT OBSERVE AT ALL (JUL-98 step 6).
// Measured live on 2026-09-22 against a real adopted `agy` (Antigravity)
// worker, which is how a Gemini seat is started:
//
//   worker-start --terminal ->  prompt: { stages: ["input_accepted"],
//                                         provider: "unsupported",
//                                         observation: "unsupported" }
//   worktree ps             ->  agents: []   (no agent tracked for it)
//   terminal wait --for tui-idle --timeout-ms 4000  ->  timeout
//
// Orca says, in its own field, that it cannot observe a turn for this provider,
// and it tracks no agent for it, so neither of the two proofs below can ever
// exist for such a seat. What it CAN still answer is whether the terminal is
// idle -- and the TRANSITION is the proof, not the single reading:
// ./adopt.mjs waits for the terminal to go IDLE before it delivers the brief
// (that is how it knows the agent finished starting), and then asks again
// immediately after. Busy means the agent took the brief and began. A TUI
// sitting on a trust or login screen -- the 19-20 September failure -- is idle
// at both readings and is caught.
//
// ITS ONE BLIND SPOT, stated rather than hidden: a turn that BEGINS AND ENDS
// inside the short busy window reads as idle, and is then reported as never
// started. That is the safe direction (a seat falls back; nothing is waited on
// for hours) and it cannot happen for a real step, which takes minutes.
//
// TWO RECORDED PROOFS, AND NO THIRD, for a seat Orca DOES observe. There is
// exactly one other recording in
// which Orca says an agent is really running: `worktree ps`, where
// `agents[].state` is `"working"` (worktree-ps.agent-working.json; the fixture
// README is explicit that `projection.stage.activity` is `"unknown"` for a
// worker's whole life and that Orca's "working" lives in `worktree ps`). So
// this file accepts those two and nothing else. In particular:
//
//   * `worker-start` answers `stage: "input_accepted"` even for probe 1, which
//     went on to succeed (worker-start.claude-model-effort.json). It can never
//     be proof.
//   * `worker-show` for a REAL in-flight worker whose task text was silently
//     lost says exactly the same thing (worker-show.in-flight-input-accepted.json,
//     the Pi adoption whose prompt vanished into a still-starting agent). That
//     recording is the bug itself; treating it as started is the defect.
//
// Pure. It classifies answers that were already fetched; it fetches nothing,
// sleeps on nothing, and reads no screen.

export const INPUT_ACCEPTED = 'input_accepted';
export const TURN_STARTED = 'turn_started';

// The states `worktree ps` gives an agent that has really begun. `done` counts:
// an agent that has finished a turn unarguably started one.
const STARTED_AGENT_STATES = new Set(['working', 'done']);

function stagesOf(send) {
  const stages = send?.send?.prompt?.stages;
  return Array.isArray(stages) ? stages : [];
}

// A `terminal send --wait-submit` answer: did Orca observe a turn start?
export function turnStartedFromSend(send) {
  return stagesOf(send).includes(TURN_STARTED);
}

// The second `terminal wait --for tui-idle` ./adopt.mjs takes, immediately
// after the brief was delivered: NOT satisfied means the terminal is busy,
// which -- given it was idle a moment earlier -- means the agent took the brief
// and began.
export function turnStartedFromBusyTerminal(busy) {
  return Boolean(busy) && busy.satisfied === false;
}

// A `worktree ps` worktree (the `worktree` object, as recorded): is an agent in
// it actually running?
export function turnStartedFromWorktreePs(worktree) {
  const agents = worktree?.agents;
  if (!Array.isArray(agents)) return false;
  return agents.some((agent) => STARTED_AGENT_STATES.has(agent?.state));
}

// The stage a `worker-start` or `worker-show` answer reports, wherever the
// recording puts it: `result.stage` on a start, `result.worker.stage` on a
// show, and `result.projection.stage.detail` beside it.
export function observedStage(answer) {
  return answer?.stage ?? answer?.worker?.stage ?? answer?.projection?.stage?.detail ?? null;
}

// One verdict from whatever the controller has in hand.
//
//   { started: true,  source }            proof, and which recording shape gave it
//   { started: false, reason, warnings, retryRequestId }
//
// `retryRequestId` is Orca's own advice, carried rather than re-derived: the
// warning on a no-turn-started send names the request id to reissue with, so
// the confirmation costs nothing and sends nothing twice.
export function proveTurnStarted({ send = null, worktree = null, busy = null, start = null, show = null } = {}) {
  if (send && turnStartedFromSend(send)) {
    return { started: true, source: 'terminal-send', stages: stagesOf(send), warnings: [] };
  }
  if (worktree && turnStartedFromWorktreePs(worktree)) {
    return { started: true, source: 'worktree-ps', stages: [], warnings: [] };
  }
  if (turnStartedFromBusyTerminal(busy)) {
    return { started: true, source: 'terminal-busy', stages: [], warnings: [] };
  }
  if (busy) {
    return {
      started: false,
      source: 'terminal-busy',
      stages: [],
      warnings: [],
      retryRequestId: null,
      reason: 'the terminal was idle again the moment the brief was delivered, and it was idle before: nothing took the brief, which is what a trust or login screen looks like',
    };
  }

  const warnings = Array.isArray(send?.warnings) ? send.warnings : [];
  const retryRequestId = send?.send?.prompt?.requestId ?? send?.mutation?.requestId ?? null;

  if (send) {
    return {
      started: false,
      source: 'terminal-send',
      stages: stagesOf(send),
      warnings,
      retryRequestId,
      reason: `Orca reported ${stagesOf(send).join(', ') || 'no stages'} and no ${TURN_STARTED}: the input was accepted but no turn began, which is what a login or folder-trust screen looks like`,
    };
  }
  if (start) {
    return {
      started: false,
      source: 'worker-start',
      stages: [],
      warnings,
      retryRequestId: start?.mutation?.requestId ?? null,
      reason: `worker-start reported stage ${observedStage(start) ?? 'none'}, which it reports for a healthy start too: a worker-start answer is never proof that a turn began`,
    };
  }
  if (show) {
    return {
      started: false,
      source: 'worker-show',
      stages: [],
      warnings,
      retryRequestId: null,
      reason: `worker-show reported stage ${observedStage(show) ?? 'none'}: ${INPUT_ACCEPTED} is exactly what the worker whose task text was lost reported, so it is not proof a turn began`,
    };
  }
  return {
    started: false,
    source: null,
    stages: [],
    warnings,
    retryRequestId: null,
    reason: 'nothing was observed at all, so nothing is proven; a turn is never assumed to have started',
  };
}
