// coordinator-events.mjs -- lifecycle observability for a graph run
// (JUL-43's own coordinator/publish pipeline), built entirely on the
// existing journey-relay infrastructure. No relay or client changes: the
// relay already accepts any event name, so this just fixes a small,
// documented vocabulary and always logs locally too, so a run's outcome is
// visible in the terminal/CI log even if the relay or Axiom is unreachable.
import { recordEvent } from './journey-events.mjs';

const STAGES = Object.freeze(['started', 'progress', 'completed', 'failed']);

export async function recordCoordinatorEvent(stage, {
  runId, tokensUsed = null, quotaRemaining = null, interrupted = false, fetchImpl, ...context
} = {}) {
  if (!STAGES.includes(stage)) {
    throw new Error(`recordCoordinatorEvent: stage must be one of ${STAGES.join(', ')}, got ${JSON.stringify(stage)}`);
  }
  const event = `julia.journey0.coordinator_${stage}`;
  // JUL-43 criterion 4 requires token/quota/interruption accounting to be
  // preserved, not just time and context -- these were previously
  // hardcoded away (tokensUsed/quotaRemaining always null, interrupted
  // always false regardless of the real values a caller had) (PR #3
  // review, JUL-43 criterion 4).
  const result = await recordEvent({
    event,
    attempted: stage,
    reason: null,
    context: JSON.stringify({ runId, ...context }),
    tokensUsed,
    quotaRemaining,
    interrupted,
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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

// A real CLI entry point -- SKILL.md's "Journey accounting" section runs
// this as a plain shell command inside a diagnostic terminal on the OVH
// runner (the only place that reaches the relay's 127.0.0.1:8943
// binding), not as an import. It previously had none, so that documented
// command silently did nothing (PR #3 review, finding C3).
//
// Context travels as base64 (--context-b64), never as raw JSON embedded
// in a shell string: JSON.stringify does not escape apostrophes for a
// shell, so a context value containing one could break quoting and, once
// an executable event path exists, become a command-injection vector
// (PR #3 review, finding C3). Base64's alphabet is shell-safe either way.
async function main() {
  const [stage, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    // Decoding/parsing --context-b64 belongs inside the same try as the
    // rest of main(): malformed input must produce this script's own
    // controlled error/exit code, not an uncaught exception's raw stack
    // trace (fix-verification review, 2026-09-16).
    const context = args['context-b64']
      ? JSON.parse(Buffer.from(args['context-b64'], 'base64').toString('utf8'))
      : {};
    const result = await recordCoordinatorEvent(stage, {
      runId: args['run-id'],
      tokensUsed: args['tokens-used'] !== undefined ? Number(args['tokens-used']) : null,
      quotaRemaining: args['quota-remaining'] !== undefined ? Number(args['quota-remaining']) : null,
      interrupted: args.interrupted === 'true',
      ...context,
    });
    process.exitCode = result.sent ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
