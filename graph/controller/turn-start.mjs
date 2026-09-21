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
// TWO RECORDED PROOFS, AND NO THIRD. There is exactly one other recording in
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
export function proveTurnStarted({ send = null, worktree = null, start = null, show = null } = {}) {
  if (send && turnStartedFromSend(send)) {
    return { started: true, source: 'terminal-send', stages: stagesOf(send), warnings: [] };
  }
  if (worktree && turnStartedFromWorktreePs(worktree)) {
    return { started: true, source: 'worktree-ps', stages: [], warnings: [] };
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
