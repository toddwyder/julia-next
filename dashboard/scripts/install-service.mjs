#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SERVER_HOSTNAME = 'vps-ce27cb55';
export const OPERATOR_CHECKOUT = '/home/ubuntu/julia-mastra';
export const DEFAULT_CHECKOUT = '/home/ubuntu/julia-dashboard';
export const STATE_DIR = '/var/lib/julia-dashboard';
export const ENV_FILE = '/etc/julia-dashboard.env';
export const UNIT_DIR = '/etc/systemd/system';
export const SERVICE_USER = 'ubuntu';
export const UNITS = Object.freeze([
  'julia-dashboard.service',
  'julia-dashboard-update.service',
  'julia-dashboard-update.timer',
  'julia-dashboard-watchdog.service',
  'julia-dashboard-watchdog.timer',
]);
export const TIMERS = Object.freeze(['julia-dashboard-update.timer', 'julia-dashboard-watchdog.timer']);

const here = dirname(fileURLToPath(import.meta.url));
const opsDir = join(here, '..', 'ops');

export function serverIdentityProblem({ hostname = osHostname(), operatorCheckout = OPERATOR_CHECKOUT, checkout = DEFAULT_CHECKOUT, exists = existsSync, read = readFileSync } = {}) {
  if (hostname !== SERVER_HOSTNAME) return `this is ${hostname}, not the Julia server ${SERVER_HOSTNAME}`;
  if (!exists(join(operatorCheckout, '.git'))) return `the operator checkout ${operatorCheckout} is not a git checkout`;
  let worktree;
  try {
    worktree = read(join(checkout, '.git'), 'utf8');
  } catch {
    return `${checkout} is not a git worktree`;
  }
  const gitdir = worktree.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim() ?? '';
  if (!gitdir.startsWith(join(operatorCheckout, '.git', 'worktrees') + '/')) {
    return `${checkout} is not a worktree of ${operatorCheckout}`;
  }
  return '';
}

export function envFileContent({ host = '127.0.0.1', port = '4313', checkout = DEFAULT_CHECKOUT, ref = 'origin/main', stateDir = STATE_DIR } = {}) {
  return `# No secret belongs in this file. LINEAR_API_KEY is resolved from 1Password by the vault
# wrapper named in each ExecStart, so it never touches disk.
DASHBOARD_HOST=${host}
DASHBOARD_PORT=${port}
DASHBOARD_STATE_DIR=${stateDir}
DASHBOARD_CHECKOUT=${checkout}
DASHBOARD_UPDATE_REF=${ref}
`;
}

export function readEnvFile(text) {
  const values = {};
  for (const line of String(text).split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function runCommand(command, args, { capture = true, cwd, env } = {}) {
  const output = execFileSync(command, args, { encoding: 'utf8', cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
  return capture ? output.trim() : '';
}

const envPrefix = (user, settings = {}) => ['-u', user, '/usr/bin/env', ...Object.entries(settings).map(([key, value]) => `${key}=${value}`)];

export function installService({ host = '127.0.0.1', port = '4313', ref = 'origin/main', checkout = DEFAULT_CHECKOUT, stateDir = STATE_DIR, uid = process.getuid?.() ?? -1, run = runCommand, log = line => console.log(`julia-dashboard: ${line}`), identity = serverIdentityProblem() } = {}) {
  if (identity) throw new Error(`install-service refuses to run: ${identity}`);
  if (uid !== 0) throw new Error('install-service must run as root: use sudo');
  const steps = [];
  const step = (name, detail) => {
    steps.push({ step: name, detail });
    log(`${name}${detail ? ` ${detail}` : ''}`);
  };

  for (const directory of [stateDir, join(stateDir, 'state'), join(stateDir, 'state', 'runs')]) {
    mkdirSync(directory, { recursive: true });
    chmodSync(directory, 0o755);
  }
  run('chown', ['-R', `${SERVICE_USER}:${SERVICE_USER}`, stateDir]);
  step('state', `${stateDir} owned by ${SERVICE_USER}`);

  if (existsSync(ENV_FILE)) {
    step('env', `${ENV_FILE} kept as it is`);
  } else {
    writeFileSync(ENV_FILE, envFileContent({ host, port, checkout, ref, stateDir }), { mode: 0o600 });
    chmodSync(ENV_FILE, 0o600);
    run('chown', ['root:root', ENV_FILE]);
    step('env', `${ENV_FILE} written root:root 0600`);
  }

  for (const unit of UNITS) {
    const source = join(opsDir, unit);
    if (!existsSync(source)) throw new Error(`missing unit file in the repository: ${source}`);
    writeFileSync(join(UNIT_DIR, unit), readFileSync(source, 'utf8'), { mode: 0o644 });
    chmodSync(join(UNIT_DIR, unit), 0o644);
  }
  step('units', `${UNITS.length} written to ${UNIT_DIR}`);

  run('systemctl', ['daemon-reload']);
  step('daemon-reload', 'systemd reread the units');

  const settings = readEnvFile(readFileSync(ENV_FILE, 'utf8'));
  run('sudo', [...envPrefix(SERVICE_USER, settings), process.execPath, join(here, 'update.mjs')], { cwd: checkout, capture: false });
  step('checkout', `${checkout} synced to ${settings.DASHBOARD_UPDATE_REF ?? ref}`);

  run('systemctl', ['enable', 'julia-dashboard.service']);
  run('systemctl', ['start', 'julia-dashboard.service']);
  step('service', 'julia-dashboard.service enabled and started');

  for (const timer of TIMERS) {
    run('systemctl', ['enable', '--now', timer]);
  }
  step('timers', `${TIMERS.join(' ')} enabled and started`);
  return { steps, units: UNITS, timers: TIMERS, envFile: ENV_FILE, stateDir };
}

function args(argv) {
  const parsed = { host: process.env.DASHBOARD_HOST || '127.0.0.1', port: process.env.DASHBOARD_PORT || '4313', ref: process.env.DASHBOARD_UPDATE_REF || 'origin/main' };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split('=');
    const value = inline ?? argv[index + 1];
    if (flag === '--host') parsed.host = value;
    else if (flag === '--port') parsed.port = value;
    else if (flag === '--ref') parsed.ref = value;
    else throw new Error(`unknown argument: ${flag}`);
    if (inline === undefined) index += 1;
  }
  return parsed;
}

function main() {
  try {
    const result = installService(args(process.argv.slice(2)));
    console.log(`julia-dashboard: installed ${result.units.join(' ')}`);
  } catch (error) {
    console.error(`julia-dashboard: install failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
