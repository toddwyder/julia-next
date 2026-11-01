// A second copy of the dashboard, running the change under review, with its own
// records folder. The live copy on 4313 keeps serving main and this module only
// ever reads its state folder.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { connect } from 'node:net';

export const PREVIEW_PORT_FROM = 4400;
export const PREVIEW_PORT_TO = 4499;

function walk(dir, base = dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path, base));
    else if (entry.isFile()) found.push({ path, name: relative(base, path) });
  }
  return found.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

// The comparison that proves the live copy kept serving: the same files with the
// same bytes before and after the preview ran.
export function evidenceDigest(dir) {
  if (!dir) return { files: [], digest: null };
  const files = walk(dir).map(({ path, name }) => ({
    path: name,
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }));
  const digest = createHash('sha256').update(files.map(file => `${file.path}:${file.sha256}`).join('\n')).digest('hex');
  return { files, digest };
}

export function sameDigest(before, after) {
  if (!before?.digest || !after?.digest) return false;
  return before.digest === after.digest;
}

// The live service rewrites these on its own timers, so they move whether or not
// a preview is running and cannot say who touched them.
export const LIVE_TIMER_FILES = new Set(['watchdog.json', 'build.json', 'sweep-log.jsonl']);

export function changedSince(before, after) {
  const was = new Map((before?.files ?? []).map(file => [file.path, file.sha256]));
  const now = new Map((after?.files ?? []).map(file => [file.path, file.sha256]));
  const changed = [];
  for (const [path, sha256] of now) {
    if (!was.has(path)) changed.push({ path, how: 'appeared' });
    else if (was.get(path) !== sha256) changed.push({ path, how: 'changed' });
  }
  for (const path of was.keys()) if (!now.has(path)) changed.push({ path, how: 'went away' });
  return changed.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

// What a preview could be blamed for: any live record that moved, other than the
// ones the live service writes by itself.
export function liveTrouble(before, after) {
  return changedSince(before, after).filter(file => !LIVE_TIMER_FILES.has(file.path));
}

// The preview copies the live models file so its Start screen shows the same
// choices Todd sees, and nothing else, so its clicks cannot reach live records.
// The folder starts empty, because last run's clicks are not live records: kept,
// they make the same change pass once and fail the second time.
export function seedState({ from, to, file = 'models.json' } = {}) {
  rmSync(to, { recursive: true, force: true });
  const target = join(to, 'state');
  mkdirSync(target, { recursive: true });
  copyFileSync(join(from, file), join(target, file));
  return { stateDir: to, file: join(target, file) };
}

export function emptyState({ to } = {}) {
  mkdirSync(join(to, 'state'), { recursive: true });
  return { stateDir: to };
}

export function answers(host, port, timeout = 500) {
  return new Promise(resolve => {
    const socket = connect({ host, port, timeout });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

export async function freePort({ host, from = PREVIEW_PORT_FROM, to = PREVIEW_PORT_TO, probe = answers } = {}) {
  for (let port = from; port <= to; port += 1) {
    if (!(await probe(host, port))) return port;
  }
  throw new Error(`no free port between ${from} and ${to} on ${host}`);
}

// The launcher is the same vault wrapper the live service uses, so the preview
// gets its Linear access the same way and no key is written to disk.
export function startPreview({ dir, host, port, stateDir, spawnImpl = spawn, env = process.env } = {}) {
  const child = spawnImpl(process.execPath, ['scripts/julia-agents.mjs', '--', 'node', 'dashboard/server.js'], {
    cwd: dir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, DASHBOARD_HOST: host, DASHBOARD_PORT: String(port), DASHBOARD_STATE_DIR: stateDir },
  });
  let output = '';
  child.stdout?.on('data', chunk => {
    output += chunk;
  });
  child.stderr?.on('data', chunk => {
    output += chunk;
  });
  child.output = () => output;
  return child;
}

export async function waitForAnswer({ url, attempts = 90, gap = 500, fetchImpl = fetch } = {}) {
  const started = Date.now();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
      if (response.status < 500) return { ms: Date.now() - started, status: response.status, attempts: attempt };
    } catch {
      // not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, gap));
  }
  return null;
}

export async function stopPreview(child, { host, port, probe = answers, attempts = 40, gap = 250 } = {}) {
  if (!child) return { stopped: true, note: 'nothing was running' };
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!(await probe(host, port))) return { stopped: true, attempts: attempt };
    await new Promise(resolve => setTimeout(resolve, gap));
  }
  process.kill(-child.pid, 'SIGKILL');
  return { stopped: true, forced: true };
}

export function buildMark(worktree, { file = '.next/BUILD_ID' } = {}) {
  const path = join(worktree, 'dashboard', file);
  try {
    return { path, id: readFileSync(path, 'utf8').trim(), at: statSync(path).mtimeMs };
  } catch {
    return { path, id: null, at: null };
  }
}

