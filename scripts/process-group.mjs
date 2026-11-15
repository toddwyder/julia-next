import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const POSIX = process.platform !== 'win32';

function targetPid(pid) {
  return POSIX ? -pid : pid;
}

export function killProcessGroupNow(pid, signal = 'SIGKILL') {
  if (!pid) return;
  try {
    process.kill(targetPid(pid), signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

export function isProcessGroupAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(targetPid(pid), 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

export async function terminateProcessGroup(pid, { signal = 'SIGTERM', graceMs = 2000 } = {}) {
  if (!pid) return;
  killProcessGroupNow(pid, signal);
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(pid)) return;
    await delay(50);
  }
  killProcessGroupNow(pid, 'SIGKILL');
}

export function runWithSignalForwarding(command, args, options = {}, { graceMs = 2000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { ...options, detached: POSIX });
    let settled = false;
    let forwarding = false;

    const cleanup = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      process.off('exit', onExit);
    };

    const onExit = () => {
      if (child.exitCode === null && child.signalCode === null) {
        killProcessGroupNow(child.pid, 'SIGKILL');
      }
    };

    const onSignal = sig => {
      if (forwarding) return;
      forwarding = true;
      void terminateProcessGroup(child.pid, { signal: sig, graceMs }).finally(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({ status: sig === 'SIGINT' ? 130 : 143, signal: sig, error: undefined });
        }
      });
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('exit', onExit);

    child.once('error', error => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ status: null, signal: null, error });
    });

    child.once('close', (status, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ status, signal, error: undefined });
    });
  });
}
