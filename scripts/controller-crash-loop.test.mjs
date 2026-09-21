// controller-crash-loop.test.mjs -- JUL-98 step 4, Task C.
//
// The unit carries StartLimitIntervalSec=0, so systemd will NEVER give up and
// stop the controller: a bad build restarts every 5 seconds for ever, and by
// default it does so in silence. These tests pin the two things that make it
// visible instead -- a journal line naming the build on EVERY start, and one
// card comment once the restarts pile up -- and pin them by their mechanics
// (the count, the window, the once-per-episode rule), not by their wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRASH_WINDOW_MS,
  CRASH_STARTS_THRESHOLD,
  MAX_RECORDED_STARTS,
  buildBanner,
  recordStart,
  detectCrashLoop,
  shouldReportCrashLoop,
  markCrashLoopReported,
  crashLoopComment,
} from '../graph/controller/crash-loop.mjs';
import { emptyControllerState } from '../graph/controller/state.mjs';

const T0 = Date.parse('2026-09-21T14:00:00.000Z');
// RestartSec=5, so a real crash loop produces a start every ~5 seconds.
const restartsFrom = (state, count, { at = T0, everyMs = 5000, build = 'abc1234' } = {}) => {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    next = recordStart(next, { at: new Date(at + i * everyMs).toISOString(), build, pid: 1000 + i });
  }
  return next;
};

test('the banner names the build, the pid and the mode, so one journal line identifies which build is looping', () => {
  const line = buildBanner({
    build: 'abc1234',
    pid: 4242,
    startedAt: '2026-09-21T14:00:00.000Z',
    checkout: '/srv/orchestrator-svc/julia-next',
    nodeVersion: 'v22.0.0',
    mode: 'loop',
  });
  for (const fragment of ['abc1234', '4242', '2026-09-21T14:00:00.000Z', '/srv/orchestrator-svc/julia-next', 'v22.0.0', 'loop']) {
    assert.ok(line.includes(fragment), `the banner does not name ${fragment}: ${line}`);
  }
  assert.equal(line.split('\n').length, 1, 'the banner is one journal line');
});

test('a build that cannot be identified is still announced, marked as unknown rather than left blank', () => {
  const line = buildBanner({ build: null, pid: 1, startedAt: '2026-09-21T14:00:00.000Z' });
  assert.match(line, /unknown build/i);
});

test('one start, or a few well-spaced ones, is not a crash loop', () => {
  assert.equal(detectCrashLoop(restartsFrom(emptyControllerState(), 1), { at: new Date(T0).toISOString() }).looping, false);
  // The threshold count, but spread over well beyond the window: a controller
  // restarted once a day for a week is not looping.
  const spread = restartsFrom(emptyControllerState(), CRASH_STARTS_THRESHOLD, { everyMs: 24 * 60 * 60 * 1000 });
  const at = new Date(T0 + (CRASH_STARTS_THRESHOLD - 1) * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(detectCrashLoop(spread, { at }).looping, false);
});

test('one start short of the threshold inside the window is not yet a loop; the threshold-th start is', () => {
  const nearly = restartsFrom(emptyControllerState(), CRASH_STARTS_THRESHOLD - 1);
  const nearlyAt = new Date(T0 + (CRASH_STARTS_THRESHOLD - 2) * 5000).toISOString();
  assert.equal(detectCrashLoop(nearly, { at: nearlyAt }).looping, false, 'below the threshold must not report a loop');

  const looping = restartsFrom(emptyControllerState(), CRASH_STARTS_THRESHOLD);
  const at = new Date(T0 + (CRASH_STARTS_THRESHOLD - 1) * 5000).toISOString();
  const detection = detectCrashLoop(looping, { at });
  assert.equal(detection.looping, true);
  assert.equal(detection.starts, CRASH_STARTS_THRESHOLD);
  assert.equal(detection.windowMs, CRASH_WINDOW_MS);
  assert.equal(detection.since, new Date(T0).toISOString());
});

test('starts older than the window are not counted, so an old burst cannot make a healthy controller look broken', () => {
  const old = restartsFrom(emptyControllerState(), CRASH_STARTS_THRESHOLD + 3);
  // An hour later, one fresh start.
  const later = new Date(T0 + 60 * 60 * 1000).toISOString();
  const now = recordStart(old, { at: later, build: 'abc1234', pid: 9 });
  const detection = detectCrashLoop(now, { at: later });
  assert.equal(detection.looping, false);
  assert.equal(detection.starts, 1);
});

test('the start list is bounded, so a forever loop cannot grow the state file without bound', () => {
  const many = restartsFrom(emptyControllerState(), MAX_RECORDED_STARTS + 50);
  assert.equal(many.starts.length, MAX_RECORDED_STARTS);
  // The ones kept are the most recent, which is what the window is read from.
  assert.equal(many.starts[many.starts.length - 1].at, new Date(T0 + (MAX_RECORDED_STARTS + 49) * 5000).toISOString());
});

test('a crash loop is commented on exactly ONCE per episode, not on every restart', () => {
  let state = restartsFrom(emptyControllerState(), CRASH_STARTS_THRESHOLD);
  let at = new Date(T0 + (CRASH_STARTS_THRESHOLD - 1) * 5000).toISOString();
  let detection = detectCrashLoop(state, { at });
  assert.equal(shouldReportCrashLoop(state, detection), true);

  state = markCrashLoopReported(state, { at, build: 'abc1234' });
  // The next restart, still looping: nothing more is posted.
  state = recordStart(state, { at: new Date(Date.parse(at) + 5000).toISOString(), build: 'abc1234', pid: 77 });
  at = new Date(Date.parse(at) + 5000).toISOString();
  detection = detectCrashLoop(state, { at });
  assert.equal(detection.looping, true, 'it is still looping');
  assert.equal(shouldReportCrashLoop(state, detection), false, 'a second comment for the same episode');
});

test('a NEW episode after the controller recovered is reported again', () => {
  let state = restartsFrom(emptyControllerState(), CRASH_STARTS_THRESHOLD);
  const firstAt = new Date(T0 + (CRASH_STARTS_THRESHOLD - 1) * 5000).toISOString();
  state = markCrashLoopReported(state, { at: firstAt, build: 'abc1234' });

  // Quiet for two hours -- the loop cleared -- then a fresh burst.
  const later = T0 + 2 * 60 * 60 * 1000;
  state = restartsFrom(state, CRASH_STARTS_THRESHOLD, { at: later, build: 'abc1234' });
  const at = new Date(later + (CRASH_STARTS_THRESHOLD - 1) * 5000).toISOString();
  const detection = detectCrashLoop(state, { at });
  assert.equal(detection.looping, true);
  assert.equal(shouldReportCrashLoop(state, detection), true, 'a new episode must be reported');
});

test('the comment names the card, the build, the count, the window and the last error, and says systemd will not stop it', () => {
  const body = crashLoopComment({
    identifier: 'JUL-98',
    build: 'abc1234',
    starts: 7,
    windowMs: CRASH_WINDOW_MS,
    since: '2026-09-21T14:00:00.000Z',
    lastError: 'Cannot find module ./nope.mjs',
  });
  for (const fragment of ['JUL-98', 'abc1234', '7', '10 minutes', 'Cannot find module ./nope.mjs']) {
    assert.ok(body.includes(fragment), `the comment does not name ${fragment}`);
  }
  assert.match(body, /StartLimitIntervalSec=0/, 'the comment must say why systemd will not stop it');
});

test('a crash loop with no card in flight is still detected -- it just has nowhere to comment', () => {
  const state = restartsFrom(emptyControllerState(), CRASH_STARTS_THRESHOLD);
  const at = new Date(T0 + (CRASH_STARTS_THRESHOLD - 1) * 5000).toISOString();
  assert.equal(detectCrashLoop(state, { at }).looping, true);
  assert.equal(state.carrying, null, 'nothing was being carried, so there is no card to comment on');
});
