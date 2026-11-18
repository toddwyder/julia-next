#!/usr/bin/env node
// Points every font-service host at loopback and proves the hosts refuse a
// connection, so a build on this machine cannot reach a font service and quietly
// succeed on a checkout that no longer carries the font. CI runs it before the
// builds; `--unblock` puts the hosts file back.

import { connect } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FONT_HOSTS } from './font-hosts.mjs';

export const MARKER = '# julia-font-block';
const DEFAULT_HOSTS = '/etc/hosts';
const PROBE_TIMEOUT = 5000;

export function blockLines(hosts = FONT_HOSTS) {
  return hosts.flatMap(host => [`0.0.0.0 ${host} ${MARKER}`, `:: ${host} ${MARKER}`]);
}

export function blockedText(text, hosts = FONT_HOSTS) {
  const kept = String(text ?? '')
    .split('\n')
    .filter(line => !line.includes(MARKER))
    .join('\n')
    .replace(/\n+$/, '');
  return `${kept}\n${blockLines(hosts).join('\n')}\n`;
}

export function unblockedText(text) {
  const kept = String(text ?? '')
    .split('\n')
    .filter(line => !line.includes(MARKER))
    .join('\n')
    .replace(/\n+$/, '');
  return `${kept}\n`;
}

export function missingBlocks(text, hosts = FONT_HOSTS) {
  const lines = String(text ?? '').split('\n');
  return blockLines(hosts).filter(line => !lines.includes(line));
}

export function probeHost(host, { timeout = PROBE_TIMEOUT } = {}) {
  return new Promise(resolve => {
    const socket = connect({ host, port: 443 });
    const settle = reachable => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.once('timeout', () => settle(false));
  });
}

export async function assertHostsBlocked({ hosts = FONT_HOSTS, probe = probeHost } = {}) {
  for (const host of hosts) {
    if (await probe(host)) {
      throw new Error(`${host} accepted a connection, so a build could still fetch a font from it`);
    }
  }
}

async function main(args) {
  const hostsPath = args.includes('--hosts') ? args[args.indexOf('--hosts') + 1] : DEFAULT_HOSTS;
  const text = readFileSync(hostsPath, 'utf8');
  if (args.includes('--unblock')) {
    writeFileSync(hostsPath, unblockedText(text));
    console.log(`Removed the font host block from ${hostsPath}.`);
    return;
  }
  if (!args.includes('--check')) {
    writeFileSync(hostsPath, blockedText(text));
  }
  const missing = missingBlocks(readFileSync(hostsPath, 'utf8'));
  if (missing.length) throw new Error(`${hostsPath} is missing ${missing.length} font host lines`);
  await assertHostsBlocked();
  console.log(`Every font host refuses a connection (${FONT_HOSTS.join(', ')}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
