// mailbox.mjs -- JUL-98 step 3, items 2 and 7: the controller SLEEPS on Orca's
// mailbox, and mirrors every message it hears to Axiom.
//
// THE RULE THIS FILE EXISTS TO KEEP. The controller must never watch a screen
// or poll a terminal to guess whether a worker has finished. Nothing in this
// module can: it takes ONE observation dependency, `checkWaitImpl`, which is
// `orca orchestration check --wait`. There is no terminal read, no
// `worker-show` poll and no `worktree ps` here at all, so "it guessed from the
// screen" is not a mistake this code can make.
//
// WHAT IT IS BUILT FROM. Only recorded answers, in graph/fixtures/orca-1.4.205/:
//
//   * mailbox.check-all.status-heartbeat-escalation-done.json -- seven real
//     messages. Each has `type` (status, heartbeat, escalation, worker_done),
//     `subject`, `body` and `payload` as a JSON *string* carrying `taskId`,
//     `dispatchId`, and for a worker_done `outcome`.
//   * mailbox.check-wait-batch.jsonl -- what a blocking wait returns: the same
//     messages plus a `deliveryId` and `timedOut: false`.
//   * check-wait.empty-inbox-timeout.json -- an expired wait: no messages,
//     `timedOut: true`, `deliveryId: null`. Exit 0: an expiry is not a failure
//     and is not a verdict either.
//   * failure.mailbox.check-all.claude-codex-pi.json -- worker_done with
//     `outcome: "failed"` from Claude, Codex and Pi. Both outcomes are handled;
//     a failure is never smoothed into a success.
//
// ACKNOWLEDGEMENT. JUL-109 section 4a: "until then the same message wakes the
// next `check --wait`, so a waiter that does not ack will keep waking on old
// news". So each wait acknowledges the batch before it, and the batch that
// carried the verdict is acknowledged on the way out.

import { recordCoordinatorEvent } from '../../scripts/coordinator-events.mjs';

// The four types a worker sends. Passed to `--types` so the wait is woken by
// exactly these and nothing else.
export const WORKER_MESSAGE_TYPES = Object.freeze(['status', 'heartbeat', 'escalation', 'worker_done']);

// Orca's own outcome vocabulary on a worker_done, both recorded.
export const SUCCEEDED = 'succeeded';
export const FAILED = 'failed';

// How many expired waits the controller will sit through before it says so.
// Each wait is a real `--wait --timeout-ms`, so this is a count of sleeps, not
// a spin: the recorded empty wait held for 20.5 seconds.
export const DEFAULT_MAX_WAITS = 120;
export const DEFAULT_WAIT_TIMEOUT_MS = 90000;

function parsePayload(message) {
  const raw = message?.payload;
  if (raw == null) return { payload: {}, payloadError: false };
  if (typeof raw === 'object') return { payload: raw, payloadError: false };
  try {
    const parsed = JSON.parse(raw);
    return { payload: parsed && typeof parsed === 'object' ? parsed : {}, payloadError: false };
  } catch {
    // A message whose payload cannot be read is still a message: it is
    // classified, mirrored and reported. It is simply never a verdict.
    return { payload: {}, payloadError: true };
  }
}

// One recorded message -> the flat facts the controller acts on.
export function classifyMessage(message) {
  const { payload, payloadError } = parsePayload(message);
  return {
    id: message?.id ?? null,
    type: message?.type ?? null,
    subject: message?.subject ?? '',
    body: message?.body ?? '',
    createdAt: message?.created_at ?? null,
    runId: message?.run_id ?? null,
    fromHandle: message?.from_handle ?? null,
    taskId: payload.taskId ?? null,
    dispatchId: payload.dispatchId ?? null,
    phase: payload.phase ?? null,
    // ONLY a worker_done carries an outcome. Reading one off a status message
    // would let a "phase: succeeded" status end a step.
    outcome: message?.type === 'worker_done' ? (payload.outcome ?? null) : null,
    payloadError,
  };
}

export function isWorkerDone(message) {
  return (message?.type ?? null) === 'worker_done';
}

export function outcomeOf(message) {
  return classifyMessage(message).outcome;
}

// The Axiom mirror, built on the relay that already exists
// (scripts/coordinator-events.mjs -> scripts/journey-events.mjs -> the relay on
// 127.0.0.1:8943). No relay change and no new event vocabulary: a worker_done
// maps onto the relay's existing `completed`/`failed` stages and everything
// else onto `progress`.
export function createAxiomMirror({ runId, recordEventImpl = recordCoordinatorEvent } = {}) {
  return async function mirror(classified) {
    const stage = classified.type === 'worker_done'
      ? (classified.outcome === FAILED ? 'failed' : 'completed')
      : 'progress';
    return recordEventImpl(stage, {
      runId,
      messageId: classified.id,
      messageType: classified.type,
      dispatchId: classified.dispatchId,
      taskId: classified.taskId,
      subject: classified.subject,
      phase: classified.phase,
      outcome: classified.outcome,
    });
  };
}

// Sleep on the mailbox until THIS worker reports done.
//
// Returns `{ outcome, message, messages, waits, acknowledged, mirrorFailures,
// timedOut, source }`. `source` is always 'mailbox': there is no other way this
// function can reach a verdict.
export async function waitForWorkerDone({
  checkWaitImpl,
  terminal,
  runId,
  dispatchId,
  types = WORKER_MESSAGE_TYPES,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  maxWaits = DEFAULT_MAX_WAITS,
  mirrorImpl = null,
  // The delivery left unacknowledged by a previous chain of waits, if any: it
  // is acknowledged by the first wait here.
  initialAck = null,
  // How the LAST delivery is acknowledged. Optional, and separate from
  // `checkWaitImpl` on purpose: acknowledging is not waiting, and a caller that
  // is about to start another chain of waits can simply pass the returned
  // `acknowledged` value in as the next chain's `initialAck` instead.
  ackImpl = null,
  onMessage = null,
  onEscalation = null,
  onStatus = null,
} = {}) {
  const seen = [];
  let ack = initialAck;
  let waits = 0;
  let mirrorFailures = 0;

  async function mirrorOne(classified) {
    if (!mirrorImpl) return;
    try {
      await mirrorImpl(classified);
    } catch {
      // A relay that is down must never stop the controller acting on a
      // message it has already been given. The count is reported instead.
      mirrorFailures += 1;
    }
  }

  while (waits < maxWaits) {
    const batch = await checkWaitImpl({ terminal, runId, types, timeoutMs, ack });
    waits += 1;
    ack = batch?.deliveryId ?? null;

    for (const message of batch?.messages ?? []) {
      const classified = classifyMessage(message);
      seen.push(classified);
      // EVERY message, in the order it arrived -- not only the one that ends
      // the wait.
      await mirrorOne(classified);
      if (onMessage) await onMessage(classified);
      if (classified.type === 'escalation' && onEscalation) await onEscalation(classified);
      if (classified.type === 'status' && onStatus) await onStatus(classified);
    }

    const done = seen.find((message) => message.type === 'worker_done' && message.dispatchId === dispatchId);
    if (done) {
      // Acknowledge the batch that carried the verdict, so no later wait is
      // woken by it again. Either through `ackImpl`, or -- when the caller
      // chains another set of waits -- by passing `acknowledged` back in as
      // that chain's `initialAck`.
      if (ack && ackImpl) await ackImpl({ terminal, runId, deliveryId: ack });
      return {
        outcome: done.outcome,
        message: done,
        messages: seen,
        waits,
        acknowledged: ack,
        mirrorFailures,
        timedOut: false,
        source: 'mailbox',
      };
    }
  }

  return {
    outcome: null,
    message: null,
    messages: seen,
    waits,
    acknowledged: ack,
    mirrorFailures,
    timedOut: true,
    source: 'mailbox',
  };
}
