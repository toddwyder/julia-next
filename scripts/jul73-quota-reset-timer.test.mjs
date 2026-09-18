import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TIMER = readFileSync(new URL('../ops/jul73-quota-reset/jul73-quota-reset.timer', import.meta.url), 'utf8');
const SERVICE = readFileSync(new URL('../ops/jul73-quota-reset/jul73-quota-reset.service', import.meta.url), 'utf8');

test('the timer fires exactly once: OnCalendar is a fixed absolute date, not a recurring expression', () => {
  const match = TIMER.match(/^OnCalendar=(.+)$/m);
  assert.ok(match, 'expected an OnCalendar= line');
  const value = match[1].trim();
  // A recurring systemd calendar expression uses wildcards/steps (*, /, ~,
  // a bare weekday/"daily"/"weekly" etc). A fixed one-time date is a full
  // absolute calendar spec: YYYY-MM-DD HH:MM:SS, no wildcard characters.
  assert.doesNotMatch(value, /[*~/]/, `OnCalendar (${value}) must be a fixed date, not a recurring expression`);
  assert.match(value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
});

test('Persistent=false: a missed one-time fire is not caught up later, since there is nothing to catch up to twice', () => {
  assert.match(TIMER, /^Persistent=false$/m);
});

test('the timer unit points at the acceptance-run service by name', () => {
  assert.match(TIMER, /^Unit=jul73-quota-reset\.service$/m);
});

test('the service removes both of its own unit files and disables the timer, regardless of the run outcome', () => {
  const execStopPostLines = SERVICE.match(/^ExecStopPost=.+$/gm) ?? [];
  const joined = execStopPostLines.join('\n');
  assert.match(joined, /systemctl disable --now jul73-quota-reset\.timer/);
  assert.match(joined, /rm -f .*jul73-quota-reset\.service.*jul73-quota-reset\.timer/);
  assert.match(joined, /systemctl daemon-reload/);
});

test('the service is oneshot (runs once to completion, not a long-lived daemon) and has no Restart= directive', () => {
  assert.match(SERVICE, /^Type=oneshot$/m);
  assert.doesNotMatch(SERVICE, /^Restart=/m);
});

test('the service runs the acceptance logic as orchestrator-svc, from the live checkout', () => {
  assert.match(SERVICE, /sudo -u orchestrator-svc .*node \/srv\/orchestrator-svc\/julia-next\/scripts\/jul73-quota-reset-run\.mjs/);
});
