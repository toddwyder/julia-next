// Process-tree time limit used by the current delivery launcher.
import { spawn } from 'node:child_process';

export const LIMITS = {
  builder: { fallback: 60 * 60, max: 3 * 60 * 60 },
};

export function runLimited(command, args, options, {
  seconds, graceMs = 10_000, spawnFn = spawn, kill = process.kill.bind(process), started = () => {},
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
    const limit = setTimeout(() => {
      stopped = true;
      signalGroup('SIGTERM');
      grace = setTimeout(() => signalGroup('SIGKILL'), graceMs);
    }, seconds * 1000);
    child.on('error', (error) => {
      clearTimeout(limit);
      clearTimeout(grace);
      resolve({ code: null, signal: null, stopped: false, error });
    });
    child.on('close', (code, signal) => {
      clearTimeout(limit);
      clearTimeout(grace);
      if (stopped) signalGroup('SIGKILL');
      resolve({ code, signal, stopped, error: null });
    });
  });
}
