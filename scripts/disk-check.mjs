#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DASHBOARD_CARD, TODD_PROFILE, sendCardAlert } from '../dashboard/lib/ping.js';
import { DEFAULT_MIN_FREE_MEMORY_MB, readAvailableMemoryMb } from '../machine/flow/resources.mjs';
import { cleanLeftovers, collectSnapshot } from './check-server-in-use.mjs';
import { evaluateServerState } from './server-in-use.mjs';

function largestFolders() {
  let folders;
  try {
    folders = execFileSync('du', ['-x', '-B1', '--max-depth=2', '/'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    if (error.status !== 1 || !error.stdout) throw error;
    folders = error.stdout;
  }
  return folders
    .trim()
    .split('\n')
    .map(line => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      return match && { bytes: Number(match[1]), path: match[2] };
    })
    .filter(folder => folder && folder.path !== '/')
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
}

export async function runDailyResourceCheck({
  env = process.env,
  collect = () => collectSnapshot({ local: true }),
  clean = evaluation => cleanLeftovers(evaluation, { local: true }),
  statfs = () => statfsSync('/'),
  readMemoryMb = () => readAvailableMemoryMb(),
  readLargestFolders = largestFolders,
  sendAlert = body => sendCardAlert({ body, card: DASHBOARD_CARD }),
} = {}) {
  const thresholdGb = Number(env.JULIA_DISK_THRESHOLD_GB ?? 10);
  if (!Number.isFinite(thresholdGb) || thresholdGb <= 0) {
    throw new Error('JULIA_DISK_THRESHOLD_GB must be a positive number');
  }
  const minMemoryMb = Number(env.JULIA_MEMORY_THRESHOLD_MB ?? DEFAULT_MIN_FREE_MEMORY_MB);
  if (!Number.isFinite(minMemoryMb) || minMemoryMb <= 0) {
    throw new Error('JULIA_MEMORY_THRESHOLD_MB must be a positive number');
  }

  const before = evaluateServerState(collect());
  if (before.leftovers.length > 0) clean(before);
  const after = before.leftovers.length > 0 ? evaluateServerState(collect()) : before;

  const disk = statfs();
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  const diskShort = freeBytes < thresholdGb * 1_000_000_000;
  const availableMemoryMb = readMemoryMb();
  const memoryShort = availableMemoryMb < minMemoryMb;

  const problems = [];
  const gb = bytes => (bytes / 1_000_000_000).toFixed(1);
  if (diskShort) {
    const usedPercent = Math.round(
      (100 * (Number(disk.blocks) - Number(disk.bfree))) / (Number(disk.blocks) - Number(disk.bfree) + Number(disk.bavail)),
    );
    problems.push(`Disk: ${usedPercent}% used, ${gb(freeBytes)} GB available on / (threshold: ${thresholdGb} GB).`);
  }
  if (memoryShort) {
    problems.push(`Memory: ${availableMemoryMb} MB available (threshold: ${minMemoryMb} MB).`);
  }
  if (after.studioReachable === false) {
    problems.push(`Studio unreachable (${after.studioError ?? 'unknown error'}); active cards could not be verified.`);
  }
  if (after.leftovers.length > 0) {
    problems.push(`Leftovers remaining after cleanup (${after.leftovers.length}): ${after.leftovers.map(item => item.name).join(', ')}.`);
  }

  if (problems.length === 0) {
    return { alert: false, freeBytes, thresholdGb, availableMemoryMb, minMemoryMb };
  }

  const lines = [
    `${TODD_PROFILE} Server resource check failed to recover alone:`,
    ...problems.map(p => `- ${p}`),
  ];
  if (diskShort) {
    lines.push('', 'Largest readable folders on the root filesystem:');
    for (const folder of readLargestFolders()) {
      lines.push(`- ${folder.path}: ${gb(folder.bytes)} GB`);
    }
  }
  const sent = await sendAlert(lines.join('\n'));
  return {
    alert: true,
    freeBytes,
    thresholdGb,
    availableMemoryMb,
    minMemoryMb,
    problems,
    comment: sent.comment,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runDailyResourceCheck();
  console.log(JSON.stringify(result));
}
