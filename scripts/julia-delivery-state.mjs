// julia-delivery-state.mjs -- the run files a delivery restart depends on
// (JUL-196 step 7). Three things live here, all below the runner's seams:
// run files that are replaced whole or not at all, a process identity that
// survives PID reuse, and the lock that keeps two runners off one run.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

// A reader sees the old file or the new one, never half of either: the text
// is flushed to a temporary file first and renamed over the target.
async function replaceFile(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'w');
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}

export async function saveJson(path, value) { await replaceFile(path, jsonText(value)); }

// The file's exact text, or null when it was never written. Any other read
// failure is thrown: an unreadable run file is not the same as a new run.
export async function loadText(path) {
  try { return await readFile(path, 'utf8'); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

// When the process with this id was created, as an opaque string, or null
// when no such process exists. A recorded pid alone proves nothing: the
// system hands a dead process's id to the next one. Pid plus creation time
// names one process. A failed measurement throws; unknown is never "gone".
export function processStarted(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'linux') {
    try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; }
    catch (error) { if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return null; throw error; }
  }
  const windows = process.platform === 'win32';
  const result = windows
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $p) { 'gone' } elseif ($p.StartTime) { 'started ' + $p.StartTime.ToFileTimeUtc() } else { 'unknown' }`], { encoding: 'utf8', windowsHide: true })
    : spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  const answer = (result.stdout ?? '').trim();
  if (!windows && !result.error) return answer || null;
  if (answer === 'gone') return null;
  const started = /^started (\d+)$/.exec(answer)?.[1];
  if (!started) throw new Error(`could not read when process ${pid} started (${result.error?.message ?? (answer || `exit ${result.status}`)})`);
  return started;
}

// Stop one process and everything it started. The caller has just proved the
// pid still names its own worker (processStarted), so nothing else is hit.
export function stopProcessTree(pid) {
  if (process.platform === 'win32') { spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); return; }
  // runLimited starts a worker as the leader of its own process group.
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

let self = null;
const TOKEN = /^[0-9a-f-]{36}$/;

// One runner per run. The lock file is created exclusively, so two runners
// starting together cannot both get it. A lock whose owner is dead (or whose
// pid now names a different process) is taken over, and the takeover itself
// is an exclusive create keyed by the dead lock's token: only one of several
// waiting runners can win it. Takeover markers are never deleted, so a slow
// runner cannot win an old one later and break a newer lock.
export async function acquireRunLock(path, { started = processStarted } = {}) {
  self ??= started(process.pid);
  const mine = { pid: process.pid, started: self, token: randomUUID(), acquiredAt: new Date().toISOString() };
  const create = async (target) => {
    await mkdir(dirname(target), { recursive: true });
    const handle = await open(target, 'wx');
    try { await handle.writeFile(jsonText(mine)); await handle.sync(); } finally { await handle.close(); }
  };
  const release = async () => {
    // Only the lock this runner wrote is ever cleared, and it is cleared by
    // emptying its owner, not by deleting a file another runner may hold.
    try { if (JSON.parse(await readFile(path, 'utf8')).token === mine.token) await replaceFile(path, jsonText({ pid: null, started: null, token: mine.token, releasedAt: new Date().toISOString() })); } catch { /* nothing of ours to release */ }
  };
  try { await create(path); return { ok: true, owner: mine, release }; } catch (error) { if (error?.code !== 'EEXIST') throw error; }
  let held;
  try { held = JSON.parse(await readFile(path, 'utf8')); } catch { return { ok: false, reason: 'the run lock cannot be read, so another runner may be working on this run' }; }
  if (!TOKEN.test(held?.token ?? '')) return { ok: false, reason: 'the run lock is not one this runner wrote' };
  if (held.pid != null) {
    let now;
    try { now = started(held.pid); } catch (error) { return { ok: false, reason: `could not tell whether runner ${held.pid} is still working on this run: ${error.message}` }; }
    if (now && now === held.started) return { ok: false, reason: `runner process ${held.pid} is still working on this run` };
  }
  try { await create(`${path}.takeover-${held.token}`); } catch (error) {
    if (error?.code === 'EEXIST') return { ok: false, reason: 'another runner is already taking over this run' };
    throw error;
  }
  await replaceFile(path, jsonText(mine));
  return { ok: true, owner: mine, release, tookOverFrom: held.pid };
}
