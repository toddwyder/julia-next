#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { postComment } from './linear-cli.mjs';

const thresholdGb = Number(process.env.JULIA_DISK_THRESHOLD_GB ?? 10);
if (!Number.isFinite(thresholdGb) || thresholdGb <= 0) throw new Error('JULIA_DISK_THRESHOLD_GB must be a positive number');

const disk = statfsSync('/');
const freeBytes = disk.bavail * disk.bsize;
if (freeBytes < thresholdGb * 1_000_000_000) {
  let folders;
  try {
    folders = execFileSync('du', ['-x', '-B1', '--max-depth=2', '/'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    if (error.status !== 1 || !error.stdout) throw error;
    folders = error.stdout;
  }
  const largest = folders.trim().split('\n').map(line => {
    const match = line.match(/^(\d+)\s+(.+)$/);
    return match && { bytes: Number(match[1]), path: match[2] };
  }).filter(folder => folder && folder.path !== '/').sort((a, b) => b.bytes - a.bytes).slice(0, 10);
  const gb = bytes => (bytes / 1_000_000_000).toFixed(1);
  const usedPercent = Math.round(100 * (disk.blocks - disk.bfree) / (disk.blocks - disk.bfree + disk.bavail));
  const lines = [
    'https://linear.app/julia-next/profiles/toddwyder Server disk check:',
    `${usedPercent}% used, ${gb(freeBytes)} GB available on /. Alert threshold: ${thresholdGb} GB.`,
    '', 'Largest readable folders on the root filesystem:',
    ...largest.map(folder => `- ${folder.path}: ${gb(folder.bytes)} GB`),
  ];
  const comment = await postComment('JUL-185', lines.join('\n'));
  console.log(JSON.stringify({ freeBytes, thresholdGb, comment: comment.url }));
} else {
  console.log(JSON.stringify({ freeBytes, thresholdGb, alert: false }));
}
