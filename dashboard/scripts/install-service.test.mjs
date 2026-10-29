import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENV_FILE, OPERATOR_CHECKOUT, SERVER_HOSTNAME, UNITS, envFileContent, installService, readEnvFile, serverIdentityProblem } from './install-service.mjs';

const WORKTREE_GITDIR = `gitdir: ${join(OPERATOR_CHECKOUT, '.git', 'worktrees', 'julia-dashboard')}\n`;
const thisServer = (overrides = {}) => serverIdentityProblem({
  hostname: SERVER_HOSTNAME,
  exists: path => path === join(OPERATOR_CHECKOUT, '.git'),
  read: () => WORKTREE_GITDIR,
  ...overrides,
});

test('it runs on this server, from a worktree of the operator checkout', () => {
  assert.equal(thisServer(), '');
});

test('it refuses any other machine, checkout or worktree', () => {
  assert.match(thisServer({ hostname: 'someone-laptop' }), /not the Julia server/);
  assert.match(thisServer({ exists: () => false }), /operator checkout .* is not a git checkout/);
  assert.match(thisServer({ read: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }), /is not a git worktree/);
  assert.match(thisServer({ read: () => '/home/ubuntu/verifications/jul-276/owners/pr-2/.git\n' }), /is not a worktree of/);
  assert.match(thisServer({ read: () => `gitdir: /tmp/elsewhere/.git/worktrees/x\n` }), /is not a worktree of/);
});

test('it refuses to write anything at all unless it is root on this server', () => {
  const calls = [];
  const run = (...command) => {
    calls.push(command);
    return '';
  };
  assert.throws(() => installService({ identity: 'this is a laptop', uid: 0, run }), /install-service refuses to run: this is a laptop/);
  assert.throws(() => installService({ identity: '', uid: 1000, run }), /must run as root/);
  assert.deepEqual(calls, []);
});

test('the env file holds settings only, never a secret', () => {
  const text = envFileContent({ host: '100.119.112.9', ref: 'origin/main' });
  assert.match(text, /^DASHBOARD_HOST=100\.119\.112\.9$/m);
  assert.match(text, /^DASHBOARD_PORT=4313$/m);
  assert.match(text, /^DASHBOARD_STATE_DIR=\/var\/lib\/julia-dashboard$/m);
  assert.match(text, /^DASHBOARD_CHECKOUT=\/home\/ubuntu\/julia-dashboard$/m);
  assert.match(text, /^DASHBOARD_UPDATE_REF=origin\/main$/m);
  const settings = text.split('\n').filter(line => line.trim() && !line.startsWith('#')).join('\n');
  assert.doesNotMatch(settings, /API_KEY|TOKEN|SECRET|PASSWORD|op:\/\//);
  assert.deepEqual(readEnvFile(text), {
    DASHBOARD_HOST: '100.119.112.9', DASHBOARD_PORT: '4313', DASHBOARD_STATE_DIR: '/var/lib/julia-dashboard',
    DASHBOARD_CHECKOUT: '/home/ubuntu/julia-dashboard', DASHBOARD_UPDATE_REF: 'origin/main',
  });
  assert.equal(ENV_FILE, '/etc/julia-dashboard.env');
});

test('every unit the installer writes exists in dashboard/ops and obeys the decisions', () => {
  const opsDir = join(import.meta.dirname, '..', 'ops');
  for (const unit of UNITS) {
    const path = join(opsDir, unit);
    assert.ok(existsSync(path), `${unit} is missing from dashboard/ops`);
    const text = readFileSync(path, 'utf8');
    assert.match(text, /^\[(Unit|Service|Timer|Install)\]$/m);
    if (unit === 'julia-dashboard.service') {
      assert.match(text, /^WorkingDirectory=\/home\/ubuntu\/julia-dashboard$/m);
      assert.match(text, /^Restart=always$/m);
      assert.match(text, /^RestartSec=2$/m);
      assert.match(text, /^WantedBy=multi-user\.target$/m);
      assert.match(text, /^EnvironmentFile=\/etc\/julia-dashboard\.env$/m);
      assert.match(text, /ExecStart=\/usr\/local\/bin\/node \/home\/ubuntu\/julia-mastra\/scripts\/julia-agents\.mjs -- \/usr\/local\/bin\/node \/home\/ubuntu\/julia-dashboard\/dashboard\/server\.js/);
    }
    if (unit.endsWith('.timer')) assert.match(text, /^WantedBy=timers\.target$/m);
  }
  assert.match(readFileSync(join(opsDir, 'julia-dashboard-watchdog.timer'), 'utf8'), /^OnUnitInactiveSec=1min$/m);
  assert.match(readFileSync(join(opsDir, 'julia-dashboard-update.timer'), 'utf8'), /^OnUnitInactiveSec=5min$/m);
});
