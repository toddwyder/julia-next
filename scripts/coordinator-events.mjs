// coordinator-events.mjs -- lifecycle observability for a graph run
// (JUL-43's own coordinator/publish pipeline), built entirely on the
// existing journey-relay infrastructure. No relay or client changes: the
// relay already accepts any event name, so this just fixes a small,
// documented vocabulary and always logs locally too, so a run's outcome is
// visible in the terminal/CI log even if the relay or Axiom is unreachable.
import { recordEvent } from './journey-events.mjs';

const STAGES = Object.freeze(['started', 'progress', 'completed', 'failed']);

export async function recordCoordinatorEvent(stage, { runId, fetchImpl, ...context } = {}) {
  if (!STAGES.includes(stage)) {
    throw new Error(`recordCoordinatorEvent: stage must be one of ${STAGES.join(', ')}, got ${JSON.stringify(stage)}`);
  }
  const event = `julia.journey0.coordinator_${stage}`;
  const result = await recordEvent({
    event,
    attempted: stage,
    reason: null,
    context: JSON.stringify({ runId, ...context }),
    interrupted: false,
    fetchImpl,
  });
  const line = `[coordinator] ${event} runId=${runId} sent=${result.sent}`;
  // A failed stage, or a stage the relay could not be reached to accept,
  // must be visible locally without depending on the relay/Axiom being up
  // -- that is the one thing a "startup failed silently" report can never
  // be allowed to happen from.
  if (stage === 'failed' || result.sent === false) console.error(line);
  else console.log(line);
  return result;
}
