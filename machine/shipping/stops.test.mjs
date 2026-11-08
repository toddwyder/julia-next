// Each stop gets a test that plants its case, so a condition that stops firing
// fails its own test instead of quietly spending a review's whole budget.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IDLE_STOP_MS,
  SPINNING_TOOL_CALLS,
  TOKEN_CEILING,
  createIdleWatch,
  reviewStops,
  repeatingStop,
  spinningStop,
  ceilingStop,
} from './stops.mjs';

const call = (toolName, input = {}) => ({ toolName, input });
const step = (toolCalls, { text = '', inputTokens = 1000 } = {}) => ({ toolCalls, text, usage: { inputTokens } });

const judging = n => `CRITERION ${n}: PASS — it ran`;

function repeats(times, ...steps) {
  return Array.from({ length: times }, () => steps).flat();
}

test('a review that goes quiet for seven minutes stops as stuck', () => {
  let clock = 0;
  const watch = createIdleWatch({ now: () => clock });

  clock = IDLE_STOP_MS - 1;
  assert.equal(watch.idleStop(), null, 'just under the limit is still working');

  clock = IDLE_STOP_MS;
  const stop = watch.idleStop();
  assert.equal(stop.kind, 'stuck');
  assert.equal(stop.idleMs, IDLE_STOP_MS);
  assert.match(stop.detail, /no activity for 7 minutes/);
});

test('activity resets the idle clock, so a busy review never reads stuck', () => {
  let clock = 0;
  const watch = createIdleWatch({ now: () => clock });
  for (let tick = 0; tick < 10; tick++) {
    clock += IDLE_STOP_MS - 1;
    watch.touch();
    assert.equal(watch.idleStop(), null);
  }
});

test('the idle watch fires once when the clock passes, and the caller aborts', async () => {
  let clock = 0;
  const frees = [];
  const watch = createIdleWatch({ now: () => clock });
  const disarm = watch.arm({ everyMs: 5, onIdle: stop => frees.push(stop) });

  await new Promise(resolve => setImmediate(resolve));
  clock = IDLE_STOP_MS + 1;
  await new Promise(resolve => setTimeout(resolve, 40));
  disarm();

  assert.equal(frees.length, 1, 'the watch aborts the run once, not on every tick');
  assert.equal(frees[0].kind, 'stuck');
});

test('a review whose one step repeats stops and names the repeating step', () => {
  const steps = repeats(3, step([call('view', { path: 'a.mjs' })]));
  const stop = repeatingStop(steps);
  assert.equal(stop.kind, 'repeating');
  assert.equal(stop.repeats, 3);
  assert.deepEqual(stop.steps, ['view({"path":"a.mjs"})']);
  assert.match(stop.detail, /the same step ran 3 times in a row/);
});

test('a review whose short sequence repeats stops and names the sequence', () => {
  const steps = repeats(3, step([call('view', { path: 'a.mjs' })]), step([call('search_content', { pattern: 'x' })]));
  const stop = repeatingStop(steps);
  assert.equal(stop.kind, 'repeating');
  assert.deepEqual(stop.steps, ['view({"path":"a.mjs"})', 'search_content({"pattern":"x"})']);
  assert.match(stop.detail, /the same 2 steps ran 3 times in a row/);
});

test('a review that varies its work is not repeating', () => {
  const steps = [
    step([call('view', { path: 'a.mjs' })]),
    step([call('view', { path: 'b.mjs' })]),
    step([call('view', { path: 'a.mjs' })]),
    step([call('view', { path: 'b.mjs' })]),
  ];
  assert.equal(repeatingStop(steps), null);
});

test('a review whose criteria do not move across thirty calls stops as spinning', () => {
  const steps = Array.from({ length: SPINNING_TOOL_CALLS + 1 }, () => step([call('execute_command', { command: 'npm test' })], { text: judging(1) }));
  const stop = spinningStop(steps);
  assert.equal(stop.kind, 'spinning');
  assert.equal(stop.criteriaJudged, 1);
  assert.match(stop.detail, /30 tool calls and still 1 criterion judged/);
});

test('a review that judges a new criterion inside the window is not spinning', () => {
  const steps = Array.from({ length: SPINNING_TOOL_CALLS }, (_, index) =>
    step([call('execute_command', { command: `check ${index}` })], { text: index === SPINNING_TOOL_CALLS - 1 ? judging(2) : judging(1) })
  );
  assert.equal(spinningStop(steps), null);
});

test('fewer than thirty calls is never counted as spinning', () => {
  const steps = Array.from({ length: SPINNING_TOOL_CALLS - 1 }, () => step([call('view', { path: 'a' })]));
  assert.equal(spinningStop(steps), null);
});

test('a review at the token ceiling stops and names the tokens used', () => {
  const steps = Array.from({ length: 10 }, () => step([call('view')], { inputTokens: 1_000_000 }));
  const stop = ceilingStop(steps);
  assert.equal(stop.kind, 'ceiling');
  assert.equal(stop.tokensUsed, 10_000_000);
  assert.equal(stop.ceiling, TOKEN_CEILING);
  assert.match(stop.detail, /10,000,000 input tokens, at the 10,000,000 ceiling/);
});

test('a review under the ceiling keeps going', () => {
  const steps = Array.from({ length: 9 }, () => step([call('view')], { inputTokens: 1_000_000 }));
  assert.equal(ceilingStop(steps), null);
});

test('each stop keeps the tokens it spent, so the record can name them', () => {
  const steps = Array.from({ length: 10 }, () => step([call('view')], { inputTokens: 1_000_000 }));
  const stop = reviewStops().conditions[2]({ steps });
  assert.equal(stop, true);
});

test('the conditions stop the review on the first case that fires, and say which', () => {
  const { conditions, fired } = reviewStops({ tokens: 3_000 });
  const looping = repeats(3, step([call('view', { path: 'a.mjs' })]));
  const answer = conditions.map(condition => condition({ steps: looping }));
  assert.deepEqual(answer, [true, false, true], 'the repeating and ceiling cases both fire');
  assert.equal(fired.stop.kind, 'repeating', 'the record keeps the first stop that fired');
});

test('a review that is working is not stopped by any condition', () => {
  const { conditions, fired } = reviewStops();
  const steps = [
    step([call('view', { path: 'a.mjs' })], { text: judging(1) }),
    step([call('execute_command', { command: 'npm test' })], { text: judging(2) }),
    step([call('view', { path: 'b.mjs' })]),
  ];
  assert.deepEqual(conditions.map(condition => condition({ steps })), [false, false, false]);
  assert.equal(fired.stop, null);
});

test('the watch owns an abort signal, because the subagent tool reads that and nothing else', async () => {
  const listeners = [];
  const session = {
    subscribe(listener) {
      listeners.push(listener);
      return () => {};
    },
  };
  const stops = [];
  const { watchReview } = await import('./workflow.mjs');
  const watch = watchReview(session, { idleMs: 5000, onStop: stop => stops.push(stop), log: () => {} });

  assert.equal(watch.signal.aborted, false, 'a working review is not aborted');
  for (const listener of listeners) listener({ type: 'tool_start' });
  assert.equal(watch.signal.aborted, false, 'activity never aborts the review');

  await new Promise(resolve => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (watch.signal.aborted || Date.now() - started > 8000) {
        clearInterval(poll);
        resolve();
      }
    }, 20);
  });
  watch.close();

  assert.equal(stops.length, 1, 'the stop is reported once');
  assert.equal(stops[0].kind, 'stuck');
  assert.equal(watch.signal.aborted, true, 'the aborted signal is what stops the subagent run');
});

test('starting a criterion counts as progress, so a working review is not called spinning', () => {
  const calls = (text, count) =>
    Array.from({ length: count }, () => ({ toolCalls: [call('view', { path: 'a' })], text, usage: { inputTokens: 1000 } }));
  const steps = [...calls('CRITERION 1: judging', 10), ...calls('', 10), ...calls('CRITERION 2: judging', 10)];
  assert.equal(spinningStop(steps), null, 'a review that keeps starting new criteria is making progress');
});
