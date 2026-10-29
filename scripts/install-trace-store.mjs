#!/usr/bin/env node
// Installs the nightly job that caps Mastra Code's trace store. On 29 October the store
// reached 22.6 GB with nothing watching it, which stopped the scorecard copying it and
// would eventually have filled the disk.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_HOSTNAME = 'vps-ce27cb55';
export const UNIT_DIR = '/etc/systemd/system';
export const CHECKOUT = '/home/ubuntu/julia-dashboard';
export const UNITS = Object.freeze(['julia-trace-store.service', 'julia-trace-store.timer']);
export const TIMER = 'julia-trace-store.timer';

const here = dirname(fileURLToPath(import.meta.url));
export const opsDir = join(here, '..', 'ops');

export function identityProblem({ hostname: name = hostname(), units = UNIT_DIR } = {}) {
  if (name !== SERVER_HOSTNAME) return `this is ${name}, not the Julia server ${SERVER_HOSTNAME}`;
  if (!existsSync(units)) return `${units} does not exist, so there is no systemd to install into`;
  return '';
}

function main() {
  const problem = identityProblem();
  if (problem) {
    console.error(problem);
    return 1;
  }
  for (const unit of UNITS) {
    const from = join(opsDir, unit);
    if (!existsSync(from)) {
      console.error(`missing ${from}`);
      return 1;
    }
    execFileSync('sudo', ['-n', 'install', '-m', '0644', from, join(UNIT_DIR, unit)], { stdio: 'inherit' });
  }
  execFileSync('sudo', ['-n', 'systemctl', 'daemon-reload'], { stdio: 'inherit' });
  execFileSync('sudo', ['-n', 'systemctl', 'enable', '--now', TIMER], { stdio: 'inherit' });
  console.log(execFileSync('systemctl', ['list-timers', TIMER, '--no-pager'], { encoding: 'utf8' }));
  if (!existsSync(join(CHECKOUT, 'scripts', 'trace-store.mjs'))) {
    console.log(`${CHECKOUT}/scripts/trace-store.mjs is not there yet; the timer starts working once that commit is on main.`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
