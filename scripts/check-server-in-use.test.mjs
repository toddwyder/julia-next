import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateServerState, formatReport } from './server-in-use.mjs';

function cleanSnapshot(overrides = {}) {
  return {
    activeCards: [],
    userUnits: [
      { name: 'julia-studio.service', load: 'loaded', active: 'active', sub: 'running' },
      { name: 'datasette-viewer.service', load: 'loaded', active: 'active', sub: 'running' },
      { name: 'julia-disk-check.timer', load: 'loaded', active: 'active', sub: 'waiting' },
      { name: 'dbus.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    systemUnits: [
      { name: 'julia-dashboard.service', load: 'loaded', active: 'active', sub: 'running' },
      { name: 'julia-dashboard-update.timer', load: 'loaded', active: 'active', sub: 'waiting' },
      { name: 'julia-dashboard-watchdog.timer', load: 'loaded', active: 'active', sub: 'waiting' },
      { name: 'tailscaled.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    processes: [
      { pid: 100, rssKb: 720000, cmd: 'node mastra dev', serviceUnit: 'julia-studio.service' },
      { pid: 101, rssKb: 120000, cmd: 'node dashboard/server.js', serviceUnit: 'julia-dashboard.service' },
      { pid: 102, rssKb: 35000, cmd: 'datasette serve mastra.db', serviceUnit: 'datasette-viewer.service' },
      { pid: 103, rssKb: 7000, cmd: 'sshd: ubuntu@notty', serviceUnit: null },
    ],
    checkouts: [
      { path: '/home/ubuntu/julia-builder', diskMb: 3800 },
      { path: '/home/ubuntu/julia-flow-repo', diskMb: 40 },
      { path: '/home/ubuntu/julia-dashboard', diskMb: 1800 },
      { path: '/home/ubuntu/julia-mastra', diskMb: 2450 },
    ],
    worktrees: [
      { path: '/home/ubuntu/julia-builder', diskMb: 3800 },
      { path: '/home/ubuntu/julia-dashboard', diskMb: 1800 },
    ],
    scratchEntries: [
      { name: 'cards', path: '/home/ubuntu/.local/state/julia-scratch/cards', diskMb: 0 },
      { name: 'com.agilebits.op.1000', path: '/home/ubuntu/.local/state/julia-scratch/com.agilebits.op.1000', diskMb: 0 },
    ],
    scratchCards: [],
    builderArtifacts: [],
    flowStudioEntries: [
      { name: 'state.db', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/state.db', diskMb: 1 },
      { name: 'trace.duckdb', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/trace.duckdb', diskMb: 10 },
    ],
    mastracodeEntries: [
      { name: 'mastra.db', path: '/home/ubuntu/.local/share/mastracode/mastra.db', diskMb: 381 },
      { name: 'settings.json', path: '/home/ubuntu/.local/share/mastracode/settings.json', diskMb: 0 },
      { name: 'auth.json', path: '/home/ubuntu/.local/share/mastracode/auth.json', diskMb: 0 },
    ],
    homeExtras: [],
    ...overrides,
  };
}

test('passes when the server holds only items in use right now', () => {
  const result = evaluateServerState(cleanSnapshot());
  assert.equal(result.ok, true);
  assert.equal(result.leftovers.length, 0);
  assert.match(formatReport(result), /Server in-use check: PASS/);
});

test('fails on leftover timer/service, failed unit, process, worktree, scratch, artifacts, and trace files', () => {
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'julia-studio-health.timer', load: 'loaded', active: 'active', sub: 'waiting' },
      { name: 'jul324-start-machine.service', load: 'loaded', active: 'failed', sub: 'failed' },
    ],
    processes: [
      ...cleanSnapshot().processes,
      { pid: 999, rssKb: 230000, cmd: 'command-code --yolo', serviceUnit: null },
    ],
    worktrees: [
      ...cleanSnapshot().worktrees,
      { path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387', diskMb: 400 },
    ],
    scratchEntries: [
      ...cleanSnapshot().scratchEntries,
      { name: 'verify-julia', path: '/home/ubuntu/.local/state/julia-scratch/verify-julia', diskMb: 2200 },
    ],
    scratchCards: [
      { name: 'JUL-387', path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387', diskMb: 400 },
    ],
    builderArtifacts: [
      { name: 'machine', path: '/home/ubuntu/julia-builder/.artifacts/machine', diskMb: 660 },
    ],
    flowStudioEntries: [
      { name: 'state.db', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/state.db', diskMb: 8 },
      { name: 'trace.duckdb', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/trace.duckdb', diskMb: 2700 },
      { name: 'JUL-362', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/JUL-362', diskMb: 1 },
    ],
    mastracodeEntries: [
      ...cleanSnapshot().mastracodeEntries,
      { name: 'traces', path: '/home/ubuntu/.local/share/mastracode/traces', diskMb: 2000 },
    ],
    homeExtras: [
      { name: 'dist', path: '/home/ubuntu/dist', diskMb: 3 },
    ],
  }));

  assert.equal(result.ok, false);
  const kinds = new Set(result.leftovers.map(item => item.kind));
  assert.ok(kinds.has('user-unit'));
  assert.ok(kinds.has('process'));
  assert.ok(kinds.has('worktree'));
  assert.ok(kinds.has('scratch'));
  assert.ok(kinds.has('scratch-card'));
  assert.ok(kinds.has('builder-artifact'));
  assert.ok(kinds.has('trace-db'));
  assert.ok(kinds.has('flow-studio-card'));
  assert.ok(kinds.has('mastracode'));
  assert.ok(kinds.has('home-extra'));
  assert.match(formatReport(result), /Server in-use check: FAIL/);
});

test('allows an active Studio card worktree and run folder, but rejects inactive ones', () => {
  const result = evaluateServerState(cleanSnapshot({
    activeCards: ['JUL-410'],
    worktrees: [
      ...cleanSnapshot().worktrees,
      { path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-410', diskMb: 300 },
      { path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387', diskMb: 300 },
    ],
    scratchCards: [
      { name: 'JUL-410', path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-410', diskMb: 300 },
      { name: 'JUL-387', path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387', diskMb: 300 },
    ],
    flowStudioEntries: [
      { name: 'JUL-410', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/JUL-410', diskMb: 2 },
      { name: 'JUL-387', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/JUL-387', diskMb: 2 },
    ],
  }));

  assert.equal(result.ok, false);
  assert.equal(result.leftovers.length, 3);
  assert.ok(result.leftovers.every(item => item.name.includes('JUL-387')));
  assert.ok(result.kept.some(item => item.name.includes('JUL-410')));
});
