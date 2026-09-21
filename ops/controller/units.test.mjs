// units.test.mjs -- JUL-98 step 4, Task A. Guards the controller's systemd
// USER unit.
//
// WHY EVERY DIRECTIVE IS PINNED. The runbook's "The controller runs as a user
// service of `orchestrator-svc`" section names five properties the unit must
// carry, and each of them is load-bearing in a way a later edit could quietly
// drop without anything failing at install time:
//
//   Restart=always            a controller that exits stays exited, and the
//                             board stops moving with nothing to say so.
//   RestartSec=5              the bound on a crash loop. Without it systemd
//                             restarts with its own default and a bad build
//                             spins much faster.
//   NoNewPrivileges=yes       proven accepted in a user unit by the 2026-09-21
//                             probe; it is the one hardening directive the
//                             probe established works here.
//   StartLimitIntervalSec=0   systemd never gives up and leaves the controller
//                             down. The trade-off is a forever crash loop,
//                             which graph/controller/crash-loop.mjs makes
//                             visible instead (Task C).
//   [Install] WantedBy=default.target
//                             without it `systemctl --user enable` cannot make
//                             the lingering user manager start it at boot.
//
// A USER unit also cannot set User=/Group=: systemd refuses the directive and
// the identity is the account whose manager runs it. A User= line copied over
// from the ready-queue SYSTEM unit would be a unit that never starts, so it is
// refused here rather than discovered on the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UNIT = 'julia-controller.service';
const CHECKOUT = '/srv/orchestrator-svc/julia-next';

const read = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

// Minimal INI reader: { section: [[key, value], ...] }, order and repeats kept.
// The same reader ops/ready-queue/units.test.mjs uses, and for the same reason:
// systemd merges repeated sections, so a second [Service] could hide a
// directive from a test that only looked at the first.
function parseUnit(text) {
  const sections = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) {
      assert.equal(sections[header[1]], undefined, `section [${header[1]}] appears twice`);
      current = sections[header[1]] = [];
      continue;
    }
    assert.ok(current, `directive before any section: ${line}`);
    assert.doesNotMatch(line, /\\$/, `line continuation hides directives: ${line}`);
    const eq = line.indexOf('=');
    assert.ok(eq > 0, `not a key=value line: ${line}`);
    current.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()]);
  }
  return sections;
}

const unit = parseUnit(read(UNIT));
const values = (section, key) => (section ?? []).filter(([k]) => k === key).map(([, v]) => v);

test('the unit carries the five directives the runbook requires, each exactly once', () => {
  assert.deepEqual(values(unit.Service, 'Restart'), ['always']);
  assert.deepEqual(values(unit.Service, 'RestartSec'), ['5']);
  assert.deepEqual(values(unit.Service, 'NoNewPrivileges'), ['yes']);
  // StartLimitIntervalSec belongs to [Unit], not [Service]: systemd moved the
  // start-rate-limit directives there, and one written under [Service] is
  // accepted-and-ignored on current systemd -- which would silently restore
  // the "systemd gives up and the board stops" behaviour this exists to avoid.
  assert.deepEqual(values(unit.Unit, 'StartLimitIntervalSec'), ['0']);
  assert.deepEqual(values(unit.Service, 'StartLimitIntervalSec'), []);
  assert.deepEqual(values(unit.Install, 'WantedBy'), ['default.target']);
});

test('ExecStart is node on the controller entry point in the read-only checkout', () => {
  const execStart = values(unit.Service, 'ExecStart');
  assert.equal(execStart.length, 1, 'exactly one ExecStart');
  assert.match(
    execStart[0],
    new RegExp(`^/usr/bin/node ${CHECKOUT.replace(/\//g, '\\/')}/graph/controller/main\\.mjs --loop$`),
  );
  assert.deepEqual(values(unit.Service, 'WorkingDirectory'), [CHECKOUT]);
});

test('it is a USER unit: no User=, no Group=, and nothing naming root', () => {
  for (const entries of Object.values(unit)) {
    for (const [key, value] of entries) {
      assert.doesNotMatch(key, /^(User|Group|DynamicUser|SupplementaryGroups)$/, `a user unit cannot set ${key}`);
      assert.doesNotMatch(value, /(^|[\s=])root([\s/]|$)/i, `${key} names root: ${value}`);
    }
  }
});

test('no directive can run anything but the one ExecStart', () => {
  for (const [key] of unit.Service) {
    assert.doesNotMatch(key, /^Exec(Start(Pre|Post)|Stop(Post)?|Reload|Condition)$/, `extra Exec directive: ${key}`);
    assert.doesNotMatch(key, /^(PermissionsStartOnly|AmbientCapabilities|CapabilityBoundingSet)$/, `privilege directive: ${key}`);
  }
  // A "+", "!" or "@" prefix on ExecStart changes who or how it runs.
  assert.doesNotMatch(values(unit.Service, 'ExecStart')[0], /^[-+!@:]/);
});

test('only the directives listed here exist (an allowlist, not a denylist)', () => {
  const allowed = {
    Unit: ['Description', 'Documentation', 'StartLimitIntervalSec'],
    Service: ['Type', 'WorkingDirectory', 'Environment', 'EnvironmentFile', 'ExecStart', 'Restart', 'RestartSec', 'NoNewPrivileges', 'SyslogIdentifier'],
    Install: ['WantedBy'],
  };
  assert.deepEqual(Object.keys(unit).sort(), Object.keys(allowed).sort(), 'unexpected sections');
  for (const [section, entries] of Object.entries(unit)) {
    for (const [key] of entries) {
      assert.ok(allowed[section].includes(key), `[${section}] has a directive not on the allowlist: ${key}`);
    }
  }
});

test('the controller never writes into its own read-only checkout: no state or cache directive points at it', () => {
  // The checkout is root-owned and read-only to orchestrator-svc. Anything the
  // controller keeps goes under $XDG_STATE_HOME (see
  // graph/controller/state.mjs) or into the Orca run.
  for (const [key, value] of unit.Service) {
    if (key === 'WorkingDirectory' || key === 'ExecStart' || key === 'EnvironmentFile') continue;
    assert.ok(!value.includes(CHECKOUT), `${key} points writes at the read-only checkout: ${value}`);
  }
  assert.deepEqual(values(unit.Service, 'StateDirectory'), []);
});

test('the environment it names is ORCA_BIN, and the publisher key file is optional so a missing one does not stop node from starting', () => {
  assert.deepEqual(values(unit.Service, 'Environment'), ['ORCA_BIN=/opt/Orca/orca-ide']);
  // A REQUIRED EnvironmentFile that is missing makes systemd fail the start
  // before node runs at all -- so the crash-loop banner and card comment (Task
  // C) could never be printed, which is the one case they exist for. The `-`
  // makes it optional; the controller's own preflight is what refuses to work
  // without the key, loudly, from inside node.
  assert.deepEqual(values(unit.Service, 'EnvironmentFile'), ['-/etc/orchestrator-svc/.env.publisher']);
});
