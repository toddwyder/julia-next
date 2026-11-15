import { readFileSync, statfsSync } from 'node:fs';
import { freemem } from 'node:os';

import { cleanLeftoversAsync, collectSnapshotAsync } from '../../scripts/check-server-in-use.mjs';
import { evaluateServerState } from '../../scripts/server-in-use.mjs';

export const DEFAULT_MIN_FREE_MEMORY_MB = 1024;
export const DEFAULT_MIN_FREE_DISK_GB = 10;

const parsePositive = (raw, fallback) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function readAvailableMemoryMb({
  platform = process.platform,
  readFile = readFileSync,
  freeMemory = freemem,
} = {}) {
  if (platform === 'linux') {
    try {
      const meminfo = readFile('/proc/meminfo', 'utf8');
      const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
      if (match) return Math.floor(Number(match[1]) / 1024);
    } catch {
      // Fall back to os.freemem when /proc/meminfo is unavailable.
    }
  }
  return Math.floor(freeMemory() / (1024 * 1024));
}

export function readAvailableDiskGb({ path = '/', statfs = statfsSync } = {}) {
  const disk = statfs(path);
  const bytes = Number(disk.bavail) * Number(disk.bsize);
  return Number((bytes / 1_000_000_000).toFixed(2));
}

export function measureShortages({
  path = '/',
  minMemoryMb = parsePositive(process.env.FLOW_MIN_FREE_MEMORY_MB, DEFAULT_MIN_FREE_MEMORY_MB),
  minDiskGb = parsePositive(process.env.FLOW_MIN_FREE_DISK_GB ?? process.env.JULIA_DISK_THRESHOLD_GB, DEFAULT_MIN_FREE_DISK_GB),
  readMemoryMb = () => readAvailableMemoryMb(),
  readDiskGb = () => readAvailableDiskGb({ path }),
} = {}) {
  const availableMemoryMb = readMemoryMb();
  const availableDiskGb = readDiskGb();
  const short = [];
  if (availableMemoryMb < minMemoryMb) {
    short.push({
      resource: 'memory',
      available: availableMemoryMb,
      required: minMemoryMb,
      unit: 'MB',
      detail: `memory (${availableMemoryMb} MB available, requires ${minMemoryMb} MB)`,
    });
  }
  if (availableDiskGb < minDiskGb) {
    short.push({
      resource: 'disk',
      available: availableDiskGb,
      required: minDiskGb,
      unit: 'GB',
      detail: `disk (${availableDiskGb} GB available, requires ${minDiskGb} GB)`,
    });
  }
  return { availableMemoryMb, availableDiskGb, minMemoryMb, minDiskGb, short };
}

export async function defaultCleanIdle({ card, studioUrl = process.env.FLOW_STUDIO_URL ?? 'http://127.0.0.1:4111' } = {}) {
  try {
    const snapshot = await collectSnapshotAsync({
      local: true,
      studioUrl,
      extraActiveCards: card ? [card] : [],
    });
    const evaluation = evaluateServerState(snapshot);
    if (evaluation.studioReachable === false || evaluation.leftovers.length === 0) return false;
    await cleanLeftoversAsync(evaluation, { local: true, allowStudioRestart: false });
    return true;
  } catch {
    return false;
  }
}

export async function ensureCardResources({
  card = '',
  dir = '/',
  minMemoryMb,
  minDiskGb,
  readMemoryMb,
  readDiskGb,
  cleanIdle = () => defaultCleanIdle({ card }),
} = {}) {
  const initial = measureShortages({ path: dir, minMemoryMb, minDiskGb, readMemoryMb, readDiskGb });
  if (initial.short.length === 0) {
    return { ok: true, cleaned: false, ...initial, reason: '' };
  }

  const cleaned = Boolean(await cleanIdle({ card, short: initial.short }));
  const after = measureShortages({ path: dir, minMemoryMb, minDiskGb, readMemoryMb, readDiskGb });
  if (after.short.length === 0) {
    return { ok: true, cleaned, ...after, reason: '' };
  }

  const reason = `Insufficient resources after clearing idle leftovers: ${after.short.map(item => item.detail).join('; ')}`;
  return { ok: false, cleaned, ...after, reason };
}

export async function stopIfResourcesShort({ inputData, state, setState }, dir, options) {
  const check = await ensureCardResources({ card: state.card || inputData.card, dir, ...options });
  if (check.ok) return null;
  await setState({ ...state, stopPart: 'Resources', stopWhy: check.reason, stopped: true });
  return { card: state.card || inputData.card, kind: state.kind || inputData.kind, ...inputData, stopped: true, detail: check.reason };
}
