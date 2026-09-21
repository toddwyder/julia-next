// crash-loop.mjs -- JUL-98 step 4, Task C: a crash loop must be VISIBLE.
//
// The unit carries `StartLimitIntervalSec=0`, which the runbook chose
// deliberately: without it a few quick crashes make systemd give up and leave
// the controller down with nothing moving on the board and nobody told. The
// price of that choice is the opposite failure -- a bad build restarting every
// 5 seconds for ever, in silence, which is worse because it LOOKS alive.
//
// So this file does the job systemd has been told not to do, and it does it
// from inside the controller:
//
//   1. EVERY start writes one line to the journal naming the build. That alone
//      turns a silent loop into `journalctl --user -u julia-controller` showing
//      the same build id twelve times a minute.
//   2. Once the starts inside a short window pass a threshold, ONE comment goes
//      on the card the controller was carrying -- once per episode, not once
//      per restart, or the card would get 720 comments an hour and the loop
//      would become a second outage.
//
// Nothing here stops anything. The controller is not asked to kill itself and
// systemd is not asked to give up: the point is that a human reading the board
// or the journal learns within a minute, which is the thing that was missing.
//
// Pure, except that the start record lives in ./state.mjs. It counts, it
// classifies, it words the two messages; it reads no clock and writes no file.

// Ten minutes: long enough that a slow restart loop (RestartSec=5 plus a
// startup that takes a few seconds) is still caught, short enough that the
// deploy-restart-deploy-restart of a normal working session does not trip it.
export const CRASH_WINDOW_MS = 10 * 60 * 1000;

// Five starts in that window. A restart or two inside ten minutes is ordinary
// (a `systemctl --user restart` after a checkout sync, plus one crash); five
// is not something a healthy controller does.
export const CRASH_STARTS_THRESHOLD = 5;

// The start list is bounded so a forever loop cannot grow the state file
// without bound -- at one start every 5 seconds that would otherwise be 17,280
// records a day. Only the window is ever read, and this keeps far more than one
// window's worth.
export const MAX_RECORDED_STARTS = 200;

// ONE journal line, on every start. Written before anything else happens, so a
// build that crashes during its own startup still says which build it was.
export function buildBanner({ build, pid, startedAt, checkout = null, nodeVersion = null, mode = null }) {
  const parts = [
    `julia-controller starting: build ${build || 'unknown build'}`,
    `pid ${pid}`,
    `at ${startedAt}`,
  ];
  if (mode) parts.push(`mode ${mode}`);
  if (checkout) parts.push(`checkout ${checkout}`);
  if (nodeVersion) parts.push(`node ${nodeVersion}`);
  return parts.join(' -- ');
}

export function recordStart(state, { at, build = null, pid = null } = {}) {
  const starts = [...(state?.starts ?? []), { at, build, pid }];
  return {
    ...state,
    starts: starts.slice(Math.max(0, starts.length - MAX_RECORDED_STARTS)),
  };
}

// How many starts fall inside the window ending at `at`, and is that a loop?
export function detectCrashLoop(state, {
  at,
  windowMs = CRASH_WINDOW_MS,
  threshold = CRASH_STARTS_THRESHOLD,
} = {}) {
  const end = Date.parse(at);
  const begin = end - windowMs;
  const inWindow = (state?.starts ?? []).filter((start) => {
    const stamp = Date.parse(start?.at);
    return Number.isFinite(stamp) && stamp >= begin && stamp <= end;
  });
  const since = inWindow.length > 0 ? inWindow[0].at : null;
  return {
    looping: inWindow.length >= threshold,
    starts: inWindow.length,
    threshold,
    windowMs,
    since,
    build: inWindow[inWindow.length - 1]?.build ?? null,
  };
}

// ONE comment per episode.
//
// The rule, and why it is this one rather than "has the first start changed?":
// the window is a sliding one, so inside a single unbroken loop its first start
// moves forward every few minutes, and an episode identified by that start
// would be "new" again every window -- a comment every ten minutes, for ever.
// So the test is against the MOMENT ALREADY REPORTED: while the burst being
// counted now reaches back to at or before the last comment, it is the same
// burst and nothing more is posted. Only a burst that begins entirely AFTER
// that comment is a new episode, which means the controller ran for a whole
// window without looping in between -- it recovered, and broke again.
export function shouldReportCrashLoop(state, detection) {
  if (!detection?.looping) return false;
  const reportedAt = Date.parse(state?.crashReported?.at ?? '');
  if (!Number.isFinite(reportedAt)) return true;
  const since = Date.parse(detection.since ?? '');
  if (!Number.isFinite(since)) return true;
  return since > reportedAt;
}

export function markCrashLoopReported(state, { at, build = null, since = null } = {}) {
  return {
    ...state,
    crashReported: { at, build, since },
  };
}

function minutes(ms) {
  const value = ms / 60000;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} minutes`;
}

// The one comment the card gets. It has to be enough for someone reading only
// the board to know what to do, because the person who reads the board is not
// necessarily the person who can read the journal.
export function crashLoopComment({ identifier, build, starts, windowMs = CRASH_WINDOW_MS, since, lastError = null }) {
  const lines = [
    `**${identifier}: the controller is crash-looping.** ${starts} starts in the last ${minutes(windowMs)}` +
      `${since ? ` (first at ${since})` : ''}, on build \`${build || 'unknown build'}\`.`,
    '',
    'This card was the one in flight when it started looping, so this is where it is being said.',
    '',
    'The unit sets `StartLimitIntervalSec=0`, so **systemd will not stop it** -- it will keep restarting ' +
      'every 5 seconds until somebody intervenes. That is deliberate (the alternative is the controller ' +
      'silently staying down and the whole board stopping), and this comment is the thing that makes it ' +
      'visible instead.',
  ];
  if (lastError) {
    lines.push('', 'The last error the controller reported before it went down:', '', '```', lastError, '```');
  }
  lines.push(
    '',
    'To look: `journalctl --user -u julia-controller -n 100` as `orchestrator-svc` (export ' +
      '`XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` first, or every `systemctl --user` command fails ' +
      'silently). To stop it: `systemctl --user stop julia-controller.service`.',
  );
  return lines.join('\n');
}
