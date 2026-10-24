import { mkdirSync, cpSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, poll } from './maintenance.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const installation = join(home, '.local/share/julia-verification-maintenance');
const configuration = join(home, '.config/julia-verification-maintenance');
const units = join(home, '.config/systemd/user');
const names = ['julia-verification-maintenance.service', 'julia-verification-maintenance.timer'];
const action = process.argv[2];
if (!['install', 'uninstall'].includes(action)) throw new Error('Usage: node install.mjs <install|uninstall>');
if (action === 'uninstall') {
  command('systemctl', ['--user', 'disable', '--now', names[1]]);
  for (const name of names) rmSync(join(units, name), { force: true });
  command('systemctl', ['--user', 'daemon-reload']);
  console.log('Timer removed. Configuration, cursor, sessions, proof, and blocked reports retained.');
} else {
  const versions = { codex: ['--version'], bwrap: ['--version'], node: ['--version'], git: ['--version'], gh: ['--version'] };
  const expected = { codex: 'codex-cli 0.163.0', bwrap: 'bubblewrap 0.9.0', node: 'v24.14.1', git: 'git version 2.43.0', gh: 'gh version 2.45.0 (2025-07-18 Ubuntu 2.45.0-1ubuntu0.3)' };
  for (const [name, args] of Object.entries(versions)) {
    const value = command(name, args).split('\n')[0];
    if (expected[name] && value !== expected[name]) throw new Error(`${name} version changed: ${value}; read matching documentation before updating installation`);
  }
  command('gh', ['auth', 'status']);
  if (command('loginctl', ['show-user', process.env.USER, '-p', 'Linger', '--value']) !== 'yes') throw new Error('User systemd linger must be enabled for the server timer to survive logout');
  for (const dir of [installation, configuration, units]) mkdirSync(dir, { recursive: true });
  const configFile = join(configuration, 'config.json');
  if (!existsSync(configFile)) writeFileSync(configFile, JSON.stringify({ repository: 'https://github.com/toddwyder/julia-next.git', githubRepository: 'toddwyder/julia-next', branch: 'main', state: join(home, '.local/state/julia-verification-maintenance') }, null, 2) + '\n');
  for (const name of ['maintenance.mjs', 'notify-blocked.mjs']) cpSync(join(here, name), join(installation, name));
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.notification ??= { root: '/home/ubuntu/julia-machine-main', issue: 'JUL-251' };
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  const baseline = poll(JSON.parse(readFileSync(configFile, 'utf8')));
  for (const name of names) cpSync(join(here, 'systemd', name), join(units, name));
  command('systemctl', ['--user', 'daemon-reload']);
  command('systemctl', ['--user', 'enable', '--now', names[1]]);
  console.log(JSON.stringify({ installation, configFile, baseline, timer: command('systemctl', ['--user', 'is-active', names[1]]) }));
}
