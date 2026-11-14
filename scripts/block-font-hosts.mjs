#!/usr/bin/env node
// Makes every outside font host unreachable on this machine, then proves it,
// so the build that follows can only succeed from fonts kept in the repository.
// It edits /etc/hosts, so it is for CI runners and never a shared server.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FONT_HOSTS } from './check-font-sources.mjs';

const HOSTS_FILE = '/etc/hosts';
const BLOCKING_ADDRESSES = ['0.0.0.0', '::'];
const PROBE_URL = 'https://fonts.googleapis.com/css2?family=Inter';

function blockLines() {
  return FONT_HOSTS.flatMap(host => BLOCKING_ADDRESSES.map(address => `${address} ${host}`));
}

function addMissingLines() {
  const present = new Set(readFileSync(HOSTS_FILE, 'utf8').split('\n').map(line => line.trim().split(/\s+/).join(' ')));
  const missing = blockLines().filter(line => !present.has(line));
  if (missing.length) execFileSync('sudo', ['tee', '-a', HOSTS_FILE], { input: `${missing.join('\n')}\n`, stdio: ['pipe', 'ignore', 'inherit'] });
  return missing.length;
}

async function proveBlocked() {
  for (const host of FONT_HOSTS) {
    const resolved = await lookup(host, { all: true });
    const reachable = resolved.filter(({ address }) => !BLOCKING_ADDRESSES.includes(address));
    if (!resolved.length || reachable.length) {
      throw new Error(`${host} still resolves to ${reachable.map(({ address }) => address).join(', ') || 'nothing'}`);
    }
  }
  try {
    await fetch(PROBE_URL, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('fonts.googleapis.com neither answered nor refused within 10 seconds');
    return;
  }
  throw new Error('fonts.googleapis.com answered a request');
}

async function main() {
  const added = addMissingLines();
  await proveBlocked();
  console.log(`${FONT_HOSTS.length} outside font hosts blocked (${added} lines added to ${HOSTS_FILE}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
