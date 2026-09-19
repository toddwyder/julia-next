// Guards the two systemd units the Ready queue runs from (JUL-79). They are
// installed as root by a laptop session and never again by the graph, so the
// test pins the one property that matters: the queue runs as orchestrator-svc,
// never root, and runs nothing but node on the queue script in the read-only,
// root-owned checkout -- code orchestrator-svc can read and run but cannot
// change, so it can never become a way to gain more than the account has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

// Minimal INI reader: { section: [[key, value], ...] }, order and repeats kept.
function parseUnit(text) {
  const sections = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) { current = sections[header[1]] = []; continue; }
    assert.ok(current, `directive before any section: ${line}`);
    assert.doesNotMatch(line, /\\$/, `line continuation hides directives: ${line}`);
    const eq = line.indexOf('=');
    assert.ok(eq > 0, `not a key=value line: ${line}`);
    current.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()]);
  }
  return sections;
}

const service = parseUnit(read('julia-ready-queue.service'));
const timer = parseUnit(read('julia-ready-queue.timer'));
const values = (section, key) => (section ?? []).filter(([k]) => k === key).map(([, v]) => v);

test('the service is a oneshot that runs as orchestrator-svc, never root', () => {
  assert.deepEqual(values(service.Service, 'Type'), ['oneshot']);
  assert.deepEqual(values(service.Service, 'User'), ['orchestrator-svc']);
  assert.deepEqual(values(service.Service, 'Group'), ['orchestrator-svc']);
  assert.deepEqual(values(service.Service, 'NoNewPrivileges'), ['yes']);
});

test('no directive can switch to root or run something outside the one command', () => {
  for (const [key, value] of service.Service) {
    assert.doesNotMatch(key, /^Exec(Start(Pre|Post)|Stop(Post)?|Reload|Condition)$/, `extra Exec directive: ${key}`);
    assert.doesNotMatch(key, /^(PermissionsStartOnly|AmbientCapabilities|CapabilityBoundingSet|SupplementaryGroups|DynamicUser)$/, `privilege directive: ${key}`);
    assert.doesNotMatch(value, /^root$/i);
  }
  assert.equal(values(service.Service, 'User').length, 1);
  // A "+", "!" or "@" prefix on ExecStart changes who or how it runs.
  assert.equal(values(service.Service, 'ExecStart').length, 1);
});

test('ExecStart is node on the queue script in the read-only checkout, with fixed arguments', () => {
  const [execStart] = values(service.Service, 'ExecStart');
  assert.match(
    execStart,
    /^\/usr\/bin\/node \/srv\/orchestrator-svc\/julia-next\/scripts\/ready-queue\.mjs --check --interval-minutes 5$/,
  );
});

test('the service names only the environment the queue needs', () => {
  assert.deepEqual(values(service.Service, 'Environment'), ['ORCA_BIN=/opt/Orca/orca-ide']);
  assert.equal(values(service.Service, 'EnvironmentFile').length, 0);
});

test('the timer fires the service every 5 minutes and installs under timers.target', () => {
  assert.deepEqual(values(timer.Timer, 'Unit'), ['julia-ready-queue.service']);
  assert.deepEqual(values(timer.Timer, 'OnUnitActiveSec'), ['5min']);
  assert.deepEqual(values(timer.Timer, 'OnBootSec'), ['1min']);
  assert.deepEqual(values(timer.Install, 'WantedBy'), ['timers.target']);
});

test('the service has no [Timer]/[Install] section and the timer has no [Service] section', () => {
  assert.equal(service.Timer, undefined);
  assert.equal(service.Install, undefined);
  assert.equal(timer.Service, undefined);
});
