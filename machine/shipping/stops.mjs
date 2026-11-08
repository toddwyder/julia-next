// The four ways a review stops before it answers: it goes quiet, it repeats
// itself, it works without judging a new criterion, or it spends its budget.
// Mastra's own `stopWhen` names the last three at a step boundary. The first is
// caught here because a review blocked inside a tool call never reaches one.

export const IDLE_STOP_MS = 7 * 60_000;
export const SPINNING_TOOL_CALLS = 30;
export const TOKEN_CEILING = 10_000_000;
export const REPEAT_CYCLES = 3;

// A stage that answers with a document rather than a verdict keeps its own wall
// clock, because nothing in its answer marks a step boundary to watch. A
// Shipping review does not use this: it stops on what it is doing, not on how
// long it has been doing it.
export const limitNote = ms => {
  const minutes = Math.round(ms / 60_000);
  return `longer than ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
};

export async function runWithinTimeLimit(start, { limitMs, onLimit = null, log = () => {} } = {}) {
  let timer = null;
  const limit = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true }), limitMs);
    timer.unref?.();
  });
  try {
    const raced = await Promise.race([start().then(value => ({ timedOut: false, value })), limit]);
    if (!raced.timedOut) return raced;
    log(`The stage ran ${limitNote(limitMs)} and was ended.`);
    if (onLimit) await onLimit();
    return { timedOut: true, value: undefined };
  } finally {
    clearTimeout(timer);
  }
}

const CRITERION = /CRITERION\s+(\d+)\s*:/gi;

const toolCalls = step => (Array.isArray(step?.toolCalls) ? step.toolCalls : []);

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

// The call's own arguments. Mastra's step result carries them on `args`; the
// same call inside `content` carries `input`. Both are read so a signature never
// collapses to null and makes three different commands look like one.
function argsOf(call) {
  if (!call || typeof call !== 'object') return null;
  if (call.args !== undefined) return call.args;
  if (call.input !== undefined) return call.input;
  return null;
}

export function stepSignature(step) {
  return toolCalls(step)
    .map(call => `${call?.toolName ?? 'unknown'}(${stable(argsOf(call))})`)
    .join(' ');
}

export function criterionNumbers(steps) {
  const found = new Set();
  for (const step of steps ?? []) {
    for (const match of String(step?.text ?? '').matchAll(CRITERION)) found.add(Number(match[1]));
  }
  return found;
}

export function criterionCount(steps) {
  return criterionNumbers(steps).size;
}

export function inputTokens(steps) {
  return (steps ?? []).reduce((total, step) => total + (Number(step?.usage?.inputTokens) || 0), 0);
}

// The criterion count after each tool call, in order. Spinning is a count that
// does not move across a window of calls, so the window needs this timeline.
function countsAfterEachCall(steps) {
  const seen = new Set();
  const counts = [];
  for (const step of steps ?? []) {
    for (const match of String(step?.text ?? '').matchAll(CRITERION)) seen.add(Number(match[1]));
    for (let call = 0; call < toolCalls(step).length; call++) counts.push(seen.size);
  }
  return counts;
}

export function spinningStop(steps, { calls = SPINNING_TOOL_CALLS } = {}) {
  const counts = countsAfterEachCall(steps);
  if (counts.length < calls) return null;
  const before = counts[counts.length - calls - 1] ?? 0;
  if (counts[counts.length - 1] !== before) return null;
  return {
    kind: 'spinning',
    detail: `${calls} tool calls and still ${before} ${before === 1 ? 'criterion' : 'criteria'} judged`,
    toolCalls: calls,
    criteriaJudged: before,
  };
}

export function ceilingStop(steps, { tokens = TOKEN_CEILING } = {}) {
  const used = inputTokens(steps);
  if (used < tokens) return null;
  return {
    kind: 'ceiling',
    detail: `${used.toLocaleString('en-US')} input tokens, at the ${tokens.toLocaleString('en-US')} ceiling`,
    tokensUsed: used,
    ceiling: tokens,
  };
}

export function repeatingStop(steps, { cycles = REPEAT_CYCLES } = {}) {
  const signatures = (steps ?? []).map(stepSignature).filter(Boolean);
  for (let length = 1; length <= 3; length++) {
    const span = length * cycles;
    if (signatures.length < span) continue;
    const window = signatures.slice(-span);
    const block = window.slice(0, length);
    const repeats = window.every((signature, index) => signature === block[index % length]);
    if (!repeats) continue;
    return {
      kind: 'repeating',
      detail: `the same ${length === 1 ? 'step' : `${length} steps`} ran ${cycles} times in a row`,
      steps: block,
      repeats: cycles,
    };
  }
  return null;
}

// Mastra calls each condition at a step boundary and stops on the first true.
// The holder keeps which stop fired, because the predicate itself only answers
// yes or no.
export function reviewStops({ cycles = REPEAT_CYCLES, calls = SPINNING_TOOL_CALLS, tokens = TOKEN_CEILING } = {}) {
  const fired = { stop: null };
  const take = stop => {
    if (!stop) return false;
    fired.stop = fired.stop ?? stop;
    return true;
  };
  return {
    fired,
    conditions: [
      ({ steps }) => take(repeatingStop(steps, { cycles })),
      ({ steps }) => take(spinningStop(steps, { calls })),
      ({ steps }) => take(ceilingStop(steps, { tokens })),
    ],
  };
}

// A review that goes quiet is not at a step boundary, so nothing in the loop can
// see it. This watch reports the quiet spell and the caller aborts the run.
export function createIdleWatch({ limitMs = IDLE_STOP_MS, now = Date.now } = {}) {
  let lastAt = now();
  return {
    touch() {
      lastAt = now();
    },
    idleMs(at = now()) {
      return at - lastAt;
    },
    idleStop(at = now()) {
      if (at - lastAt < limitMs) return null;
      const minutes = Math.round(limitMs / 60_000);
      return { kind: 'stuck', detail: `no activity for ${minutes} minutes`, idleMs: at - lastAt };
    },
    arm({ onIdle, everyMs = 1000 }) {
      const timer = setInterval(() => {
        const stop = this.idleStop();
        if (!stop) return;
        clearInterval(timer);
        onIdle(stop);
      }, everyMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
