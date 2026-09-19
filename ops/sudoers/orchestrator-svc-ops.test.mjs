// Guards the one sudoers file that gives orchestrator-svc root for a few
// exact commands (JUL-79 laptop session). The rules are the security
// boundary, so the test reads them the way sudo would: every rule must be a
// single fixed command line -- no wildcards, no command lists, no ALL -- and
// every path it names must sit where orchestrator-svc cannot write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('./orchestrator-svc-ops', import.meta.url));
const CHECKOUT_OPS = '/srv/orchestrator-svc/julia-next/ops/';
const UNIT_NAMES = ['julia-ready-queue.service', 'julia-ready-queue.timer'];
const ACCOUNTS = ['runner', 'orchestrator-svc'];
const KEY_GROUPS = ['deepseek-readers', 'zai-readers'];

const rules = readFileSync(FILE, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

const RULE_SHAPE = /^orchestrator-svc ALL=\(root\) NOPASSWD: (\/\S+(?: \S+)*)$/;
const commands = rules.map((rule) => {
  const match = RULE_SHAPE.exec(rule);
  assert.ok(match, `rule is not the fixed NOPASSWD shape: ${rule}`);
  return match[1].split(' ');
});

test('every rule is one fixed command: no wildcards, no lists, no ALL, no negation', () => {
  for (const rule of rules) {
    assert.doesNotMatch(rule, /[*?\[\]{}!\\,]/, `forbidden sudoers metacharacter in: ${rule}`);
    assert.doesNotMatch(rule, /\bALL\b.*\bALL\b.*\bALL\b/, `ALL as a command in: ${rule}`);
    assert.doesNotMatch(rule, /\b(SETENV|NOEXEC|EXEC)\b/, `tag beyond NOPASSWD in: ${rule}`);
  }
  assert.ok(commands.length > 0);
});

test('the only programs named are install, systemctl and usermod, by absolute path', () => {
  for (const [program] of commands) {
    assert.ok(['/usr/bin/install', '/usr/bin/systemctl', '/usr/sbin/usermod'].includes(program), program);
  }
});

test('install copies only the two ready-queue unit files, from the read-only checkout ops folder to /etc/systemd/system', () => {
  const installs = commands.filter(([program]) => program === '/usr/bin/install');
  assert.deepEqual(
    installs.map((c) => c[c.length - 1]).sort(),
    UNIT_NAMES.map((n) => `/etc/systemd/system/${n}`).sort(),
  );
  for (const [, ...args] of installs) {
    assert.deepEqual(args.slice(0, 6), ['-m', '0644', '-o', 'root', '-g', 'root']);
    assert.equal(args.length, 8, 'exactly: modes/owner flags, one source, one destination');
    const [source, destination] = args.slice(6);
    assert.equal(source, `${CHECKOUT_OPS}ready-queue/${destination.split('/').pop()}`);
    assert.doesNotMatch(source, /\.\./);
  }
});

test('systemctl may only reload, and enable/start/restart the ready-queue units', () => {
  const allowed = new Set([
    'daemon-reload',
    'enable --now julia-ready-queue.timer',
    'restart julia-ready-queue.timer',
    'start julia-ready-queue.service',
  ]);
  const seen = commands.filter(([p]) => p === '/usr/bin/systemctl').map(([, ...a]) => a.join(' '));
  assert.deepEqual(new Set(seen), allowed);
  assert.equal(seen.length, allowed.size, 'no duplicate systemctl rules');
});

test('usermod may only append a named account to a named *-readers group, one exact pair per rule', () => {
  const usermods = commands.filter(([p]) => p === '/usr/sbin/usermod').map(([, ...a]) => a);
  const expected = KEY_GROUPS.flatMap((group) => ACCOUNTS.map((account) => ['-aG', group, account]));
  assert.deepEqual(usermods.map((a) => a.join(' ')).sort(), expected.map((a) => a.join(' ')).sort());
  for (const [, group] of usermods) assert.match(group, /^[a-z]+-readers$/);
});

test('no rule lets orchestrator-svc touch sudo itself, the secrets, or any path outside the named ones', () => {
  const text = rules.join('\n');
  assert.doesNotMatch(text, /sudoers|dropbox-secrets|\/etc\/orchestrator-svc|\/etc\/passwd|\/etc\/shadow/);
  for (const path of text.match(/\/[\w./-]+/g)) {
    const ok = path.startsWith(CHECKOUT_OPS)
      || path.startsWith('/etc/systemd/system/julia-ready-queue.')
      || ['/usr/bin/install', '/usr/bin/systemctl', '/usr/sbin/usermod'].includes(path);
    assert.ok(ok, `unexpected path in rules: ${path}`);
  }
});

test('visudo accepts the file (skipped where visudo is not installed)', (t) => {
  const probe = spawnSync('visudo', ['--version'], { encoding: 'utf8' });
  if (probe.error) return t.skip('visudo not available');
  execFileSync('visudo', ['-cf', FILE]);
});
