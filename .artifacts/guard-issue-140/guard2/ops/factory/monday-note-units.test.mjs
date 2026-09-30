// monday-note-units.test.mjs -- issue #140, blocker 1: the deployment wiring.
//
// The timer/service units and the one-time installer must exist and point at
// the programs this repository ships, so the Monday note is a scheduled
// production route and the retention check is a scheduled guard. Nothing here
// runs systemd; it only reads the shipped files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

test('the Monday note post is a weekly timer that runs the production entrypoint', () => {
  const service = read('julia-factory-monday-note.service');
  const timer = read('julia-factory-monday-note.timer');

  assert.match(service, /ExecStart=.*monday-note-run\.mjs/);
  assert.match(service, /EnvironmentFile=\/etc\/julia-factory-monday-note\/config\.env/);
  // Inert until an operator fills the config in: no accidental post on install.
  assert.match(service, /ConditionPathExists=\/etc\/julia-factory-monday-note\/config\.env/);
  assert.match(timer, /OnCalendar=Mon 08:00/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /Unit=julia-factory-monday-note\.service/);
});

test('the retention job is a scheduled prune that runs the app route, not a read-only check', () => {
  const service = read('julia-factory-trace-retention.service');
  const timer = read('julia-factory-trace-retention.timer');

  // Issue #140 review: the unit must run the actual supported prune. It signs an
  // empty body and calls the running app's retention route, which runs the same
  // supported Mastra `prune()` + DuckDB `CHECKPOINT` the daily schedule runs.
  assert.match(service, /ExecStart=.*trace-prune-request\.mjs/);
  assert.doesNotMatch(service, /ExecStart=.*trace-retention\.mjs/);
  // No env flag pretending retention is configured.
  assert.doesNotMatch(service, /MASTRACODE_DUCKDB_RETENTION/);
  // The secret comes from a root-owned file, never argv.
  assert.match(service, /EnvironmentFile=\/etc\/julia-factory-retention\/secret\.env/);
  assert.match(timer, /OnCalendar=daily/);
  assert.match(timer, /Unit=julia-factory-trace-retention\.service/);
});

test('the installer installs the units, writes a placeholder config with no secrets, and enables the timers', () => {
  const installer = read('install-monday-note.sh');

  for (const unit of [
    'julia-factory-monday-note.service',
    'julia-factory-monday-note.timer',
    'julia-factory-trace-retention.service',
    'julia-factory-trace-retention.timer',
  ]) {
    assert.match(installer, new RegExp(unit.replace(/\./g, '\\.')));
  }
  assert.match(installer, /chmod 0640/);
  assert.match(installer, /MONDAY_NOTE_GITHUB_TOKEN=$/m, 'the token placeholder must be empty');
  assert.match(installer, /MONDAY_NOTE_DISCORD_WEBHOOK=$/m, 'the webhook placeholder must be empty');
  assert.match(installer, /systemctl enable --now julia-factory-trace-retention\.timer/);
  // The retention route secret is generated once, in a root-owned file, and is
  // never a literal in the unit or the installer output.
  assert.match(installer, /JULIA_RETENTION_ROUTE_SECRET=\$secret/);
  assert.doesNotMatch(installer, /JULIA_RETENTION_ROUTE_SECRET=[^$\n]/);
});
