#!/usr/bin/env node
// Points every outside font host at 0.0.0.0 in /etc/hosts and proves the block took
// effect, so a build that still reaches for one of them fails instead of succeeding
// over the network. Run it before `next build`.

import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_HOSTS } from './font-hosts.mjs';

const HOSTS_FILE = '/etc/hosts';
const BLOCKED_ADDRESS = '0.0.0.0';

export function missingEntries(hostsText, hosts = FONT_HOSTS) {
  const blocked = new Set();
  for (const line of String(hostsText).split(/\r?\n/)) {
    const [address, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    if (address === BLOCKED_ADDRESS) names.forEach(name => blocked.add(name.toLowerCase()));
  }
  return hosts.filter(host => !blocked.has(host)).map(host => `${BLOCKED_ADDRESS} ${host}`);
}

export function isBlocked(address) {
  return address === BLOCKED_ADDRESS;
}

async function proveBlocked(host) {
  const { address } = await lookup(host);
  if (!isBlocked(address)) throw new Error(`${host} resolves to ${address}, not ${BLOCKED_ADDRESS}`);
  try {
    await fetch(`https://${host}/`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return;
  }
  throw new Error(`${host} answered a request`);
}

export async function blockFontHosts() {
  const entries = missingEntries(readFileSync(HOSTS_FILE, 'utf8'));
  if (entries.length) {
    const [command, args] = process.getuid?.() === 0 ? ['tee', ['-a', HOSTS_FILE]] : ['sudo', ['-n', 'tee', '-a', HOSTS_FILE]];
    const appended = spawnSync(command, args, { input: `${entries.join('\n')}\n`, encoding: 'utf8' });
    if (appended.status !== 0) throw new Error(`could not write ${HOSTS_FILE}: ${appended.stderr || appended.error?.message}`);
  }
  for (const host of FONT_HOSTS) {
    await proveBlocked(host);
    console.log(`${host} is unreachable`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  blockFontHosts().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
