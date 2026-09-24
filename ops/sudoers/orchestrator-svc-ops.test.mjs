// Guards the one sudoers file that gives orchestrator-svc root for a few
// exact commands (JUL-79 laptop sessions). There is deliberately NO rule that
// installs or copies a file: units reach /etc/systemd/system only through a
// laptop session, so no merged change can become root code. The rules are the security
// boundary, so the test reads them the way sudo would: every rule must be a
// single fixed command line -- no wildcards, no command lists, no ALL as the
// command -- and every path it names must sit where orchestrator-svc cannot
// write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('./orchestrator-svc-ops', import.meta.url));
// The minimal runner's worker rules (JUL-122) are orchestrator-svc's only other
// live rules; they are guarded in scripts/julia-runner-ops.test.mjs.
const RUNNER_WORKER_COMMANDS = readFileSync(fileURLToPath(new URL('../julia-runner/sudoers', import.meta.url)), 'utf8')
  .split('\n').filter((line) => line.includes('NOPASSWD:')).map((line) => line.split('NOPASSWD:')[1].trim());
const ACCOUNTS = ['runner', 'orchestrator-svc'];
const KEY_GROUPS = ['deepseek-readers', 'commandcode-readers'];

// Whether THIS process has the kernel's NoNewPrivs attribute set -- read
// directly off /proc/self/status rather than inferred from a sudo error
// message (round-1 review finding: message-matching sudo's own stderr
// confused a genuinely broken sudoers file with this attribute, because a
// sudoers parse error can echo the same words back). A process with this
// bit set can never regain privileges through setuid execve, which is
// exactly what stops `sudo` running at all under
// `ops/controller/julia-controller.service`'s `NoNewPrivileges=yes`.
// Missing or unparseable /proc/self/status (a non-Linux box, a sandboxed
// environment without /proc) reads as false -- absence of evidence is not
// evidence of the attribute, and the caller only uses this to WIDEN a skip,
// never to silence a real failure.
function hasNoNewPrivs() {
  try {
    const status = readFileSync('/proc/self/status', 'utf8');
    return /^NoNewPrivs:\s*1\s*$/m.test(status);
  } catch {
    return false;
  }
}

const raw = readFileSync(FILE, 'utf8');
const rules = raw
  .split(/\r?\n/)
  .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

const RULE_SHAPE = /^orchestrator-svc ALL=\(root\) NOPASSWD: (\/\S+(?: \S+)*)$/;
const commands = rules.map((rule) => {
  const match = RULE_SHAPE.exec(rule);
  assert.ok(match, `rule is not the fixed NOPASSWD shape: ${rule}`);
  return match[1].split(' ');
});

test('the file pulls in nothing else: no #include/#includedir, no line continuations', () => {
  // In sudoers "#include" and "#includedir" are directives, not comments, and a
  // trailing backslash continues a line -- either could hide rules from this test.
  assert.doesNotMatch(raw, /^\s*[#@]\s*include/mi);
  assert.doesNotMatch(raw, /\\[ \t]*\r?$/m);
});

test('every rule is one fixed command: no wildcards, no lists, no ALL, no negation', () => {
  for (const rule of rules) {
    assert.doesNotMatch(rule, /[*?[\]{}!\\,]/, `forbidden sudoers metacharacter in: ${rule}`);
    assert.doesNotMatch(rule, /NOPASSWD:\s*ALL/, `ALL as the command in: ${rule}`);
    assert.doesNotMatch(rule, /\b(SETENV|NOEXEC|EXEC)\b/, `tag beyond NOPASSWD in: ${rule}`);
  }
  assert.ok(commands.length > 0);
});

test('the only programs named are systemctl and usermod, by absolute path', () => {
  for (const [program] of commands) {
    assert.ok(['/usr/bin/systemctl', '/usr/sbin/usermod'].includes(program), program);
  }
});

test('there is no install, cp, mv, tee or any other file-writing rule', () => {
  assert.equal(commands.filter(([program]) => program === '/usr/bin/install').length, 0);
  for (const [program] of commands) {
    assert.doesNotMatch(program, /\/(install|cp|mv|tee|ln|chmod|chown|sh|bash|env)$/);
  }
});

test('systemctl may only enable/disable/start/stop/restart the two named ready-queue units', () => {
  const allowed = new Set([
    'enable --now julia-ready-queue.timer',
    'disable --now julia-ready-queue.timer',
    'start julia-ready-queue.timer',
    'stop julia-ready-queue.timer',
    'restart julia-ready-queue.timer',
    'start julia-ready-queue.service',
    'stop julia-ready-queue.service',
    'restart julia-ready-queue.service',
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

test('GLM is gone: no rule mentions the removed zai-readers group (JUL-93)', () => {
  assert.doesNotMatch(raw, /zai/i);
});

test('no rule lets orchestrator-svc touch sudo itself, the secrets, or any path outside the named ones', () => {
  const text = rules.join('\n');
  assert.doesNotMatch(text, /sudoers|dropbox-secrets|\/etc\/orchestrator-svc|\/etc\/passwd|\/etc\/shadow/);
  for (const path of text.match(/\/[\w./-]+/g)) {
    const ok = ['/usr/bin/systemctl', '/usr/sbin/usermod'].includes(path);
    assert.ok(ok, `unexpected path in rules: ${path}`);
  }
});

test('on the server: an install attempt as orchestrator-svc is refused by sudo', (t) => {
  // Only meaningful where the file is actually installed and this test runs as
  // orchestrator-svc (the server's read-only checkout); skipped everywhere else.
  if (userInfo().username !== 'orchestrator-svc') return t.skip('not running as orchestrator-svc');
  const attempt = spawnSync('sudo', [
    '-n', '/usr/bin/install', '-m', '0644', '-o', 'root', '-g', 'root',
    '/srv/orchestrator-svc/julia-next/ops/ready-queue/julia-ready-queue.service',
    '/etc/systemd/system/julia-ready-queue.service',
  ], { encoding: 'utf8' });
  assert.notEqual(attempt.status, 0, 'sudo allowed an install as orchestrator-svc');
  // The whole live rule set must be exactly this file's rules, the one
  // pre-existing checkout-sync rule and the minimal runner's worker rules --
  // nothing older left installed.
  // A wide COLUMNS: with no terminal, sudo wraps a rule longer than 80
  // characters onto a second line (the runner's worker rules are).
  const listing = spawnSync('sudo', ['-n', '-l'], { encoding: 'utf8', env: { ...process.env, COLUMNS: '4096' } });
  // JUL-98, found live: `ops/controller/julia-controller.service` runs the
  // controller (also as orchestrator-svc, also on this box) under
  // `NoNewPrivileges=yes`, which stops `sudo` from executing AT ALL --
  // distinct from sudo running and correctly refusing. Under the controller
  // this same "sudo -n -l failed" text fired on every single card's suite
  // run, forever, because it asks the wrong question: this check exists to
  // verify the RULES sudo enforces are exactly the right ones, not whether
  // sudo itself can run at all when a caller has deliberately disabled it.
  // A username check alone can't tell those two orchestrator-svc contexts
  // apart.
  //
  // ROUND-1 REVIEW FINDING (Command Code DeepSeek V4 Pro, CHANGES NEEDED):
  // an earlier version of this skip grepped `listing.stderr` for the text
  // "no new privileges", live-reproduced as matching a genuinely BROKEN
  // sudoers file too -- a parse error on a line like
  // `Defaults "no new privileges"` echoes that same phrase back in sudo's
  // syntax-error output, which would have silently skipped the real check
  // this test exists to run. String-matching sudo's own (localizable)
  // stderr was the wrong signal either way. `/proc/self/status`'s
  // `NoNewPrivs` field is the kernel's own record of the attribute that
  // actually blocks sudo's setuid execve, read directly rather than
  // inferred from a message -- it cannot be confused with an unrelated
  // sudo failure, and does not depend on sudo's output locale.
  if (listing.status !== 0 && hasNoNewPrivs()) {
    return t.skip(`this process has NoNewPrivs set (/proc/self/status), which stops sudo executing at all (${listing.stderr.trim()}) -- not a rule this test can check here; the install-refusal assertion above still ran, and NoNewPrivileges itself is what enforces the boundary in this context`);
  }
  assert.equal(listing.status, 0, `sudo -l failed: ${listing.stderr}`);
  const live = listing.stdout.split('\n')
    .filter((line) => line.includes('NOPASSWD:'))
    .map((line) => line.split('NOPASSWD:')[1].trim()).sort();
  const expected = [...commands.map((c) => c.join(' ')), '/usr/bin/systemctl start julia-next-checkout-sync.service', ...RUNNER_WORKER_COMMANDS].sort();
  assert.deepEqual(live, expected);
});

test('visudo accepts the file (skipped where visudo is not installed)', (t) => {
  const probe = spawnSync('visudo', ['--version'], { encoding: 'utf8' });
  if (probe.error) return t.skip('visudo not available');
  execFileSync('visudo', ['-cf', FILE]);
});
