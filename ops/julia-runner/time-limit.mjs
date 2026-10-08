// time-limit.mjs -- the time limit a worker's own launcher enforces (JUL-126).
//
// run-gemini.mjs and run-tests.mjs start their work through runLimited, so a
// worker that runs too long is stopped even when the graph that started it
// has died. The work runs in its own process group. At the limit the group
// gets SIGTERM, and SIGKILL after a grace period. Then everything else the
// worker's account still runs is killed too, because a child that left the
// group (setsid) would otherwise outlive the stop. The account runs one
// worker at a time, and only the two worker accounts are ever swept.
//
// A stopped worker exits STOPPED_EXIT and says so on stderr, as GNU timeout does.
import { spawn } from 'node:child_process';
import { userInfo } from 'node:os';

export const STOPPED_EXIT = 124;

// Seconds. The graph asks for a limit; a missing or odd value gets the
// fallback, and no value can go past the cap.
export const LIMITS = {
  builder: { fallback: 60 * 60, max: 3 * 60 * 60 },
  tests: { fallback: 15 * 60, max: 60 * 60 },
};

// The only accounts whose leftover processes are swept after a stop.
export const SWEPT_ACCOUNTS = ['gemini-worker', 'julia-tester'];

export function limitSeconds(asked, { fallback, max }) {
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, max) : fallback;
}

export const stoppedLine = (seconds) => `stopped: ran longer than its ${seconds}-second time limit`;

export function runLimited(command, args, options, {
  seconds, graceMs = 10_000, spawnFn = spawn, kill = process.kill.bind(process),
  account = userInfo().username, started = () => {},
}) {
  return new Promise((resolve) => {
    let stopped = false;
    let grace = null;
    let child;
    try { child = spawnFn(command, args, { ...options, detached: process.platform !== 'win32' }); }
    catch (error) { resolve({ code: null, signal: null, stopped: false, error }); return; }
    started(child);
    const signalGroup = (signal) => {
      if (process.platform === 'win32') {
        if (!child.pid) return;
        const stopper = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        stopper.on('error', () => { try { child.kill(); } catch { /* already gone */ } });
        return;
      }
      try { kill(-child.pid, signal); } catch { /* the group is gone */ }
    };
    const sweep = () => {
      if (process.platform === 'win32' || !SWEPT_ACCOUNTS.includes(account)) return;
      try { kill(-1, 'SIGKILL'); } catch { /* nothing left to kill */ }
    };
    const limit = setTimeout(() => {
      stopped = true;
      signalGroup('SIGTERM');
      grace = setTimeout(() => { signalGroup('SIGKILL'); sweep(); }, graceMs);
    }, seconds * 1000);
    child.on('error', (error) => {
      clearTimeout(limit);
      clearTimeout(grace);
      resolve({ code: null, signal: null, stopped: false, error });
    });
    child.on('close', (code, signal) => {
      clearTimeout(limit);
      clearTimeout(grace);
      if (stopped) {
        signalGroup('SIGKILL');
        sweep();
      }
      resolve({ code, signal, stopped, error: null });
    });
  });
}
