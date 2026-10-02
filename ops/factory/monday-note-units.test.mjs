// monday-note-units.test.mjs -- issue #140: the deployment wiring.
//
// The Monday note timer/service must exist and point at the program this
// repository ships. Trace retention has no systemd trigger: the app's own
// Mastra scheduler runs the supported DuckDB prune (see
// app/observability-retention-schedule.test.mjs). Nothing here runs systemd; it
// only reads the shipped files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const exists = (name) => existsSync(new URL(`./${name}`, import.meta.url));

test('the Monday note post is a weekly timer that runs the production entrypoint', () => {
  const service = read('julia-factory-monday-note.service');
  const timer = read('julia-factory-monday-note.timer');

  assert.match(service, /ExecStart=.*monday-note-run\.mjs/);
  assert.match(service, /EnvironmentFile=\/etc\/julia-factory-monday-note\/config\.env/);
  // Inert until an operator fills the config in: no accidental post on install.
  assert.match(service, /ConditionPathExists=\/etc\/julia-factory-monday-note\/config\.env/);
  assert.match(timer, /OnCalendar=Mon \*-\*-\* 08:00:00 UTC/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /Unit=julia-factory-monday-note\.service/);
});

test('trace retention has no systemd timer or service: the Mastra schedule prunes it', () => {
  // The duplicate trigger this card removes. The supported path is the app's
  // own scheduled workflow, so a second systemd fire would be a duplicate.
  assert.equal(exists('julia-factory-trace-retention.service'), false);
  assert.equal(exists('julia-factory-trace-retention.timer'), false);
  assert.equal(exists('trace-prune-request.mjs'), false);
  assert.equal(exists('app/src/mastra/observability-retention-route.ts'), false);

  const installer = read('install-monday-note.sh');
  assert.doesNotMatch(installer, /julia-factory-trace-retention/);
  assert.doesNotMatch(installer, /JULIA_RETENTION_ROUTE_SECRET/);
  assert.doesNotMatch(installer, /julia-factory-retention/);
});

test('the installer installs the Monday note unit, writes a placeholder config with no secrets, and enables the timer', () => {
  const installer = read('install-monday-note.sh');

  for (const unit of [
    'julia-factory-monday-note.service',
    'julia-factory-monday-note.timer',
  ]) {
    assert.match(installer, new RegExp(unit.replace(/\./g, '\\.')));
  }
  assert.match(installer, /chmod 0640/);
  assert.match(installer, /MONDAY_NOTE_TRACE_TOKEN=$/m, 'the trace token placeholder must be empty');
  assert.match(installer, /MONDAY_NOTE_USE_PUBLISHER_APP=1/m, 'each run mints a fresh App token');
  assert.doesNotMatch(installer, /^\s*MONDAY_NOTE_DISCORD_WEBHOOK=/m, 'Discord webhook placeholder is retired in issue 180');
  assert.match(installer, /systemctl enable julia-factory-monday-note\.timer/);
});

test('the publisher receives phase signals through a projected view, not full message rows', () => {
  const installer = read('install-monday-note.sh');
  const cards = read('factory-cards.sql');
  assert.match(installer, /CREATE OR REPLACE VIEW julia_monday_phase_snapshots/);
  assert.match(installer, /REVOKE SELECT ON mastra_messages FROM "orchestrator-svc"/);
  assert.match(installer, /GRANT SELECT ON julia_monday_phase_snapshots TO "orchestrator-svc"/);
  assert.match(cards, /FROM julia_monday_phase_snapshots m/);
  assert.doesNotMatch(cards, /FROM mastra_messages m/);
  assert.match(installer, /REVOKE SELECT ON work_items, factory_run_bindings FROM "orchestrator-svc"/);
  assert.match(installer, /GRANT SELECT ON julia_monday_work_items, julia_monday_run_bindings/);
  assert.match(cards, /FROM julia_monday_work_items/);
  assert.match(cards, /FROM julia_monday_run_bindings/);
});
