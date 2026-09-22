// controller-adopt.test.mjs -- JUL-98 step 6: the START-THEN-ADOPT route, the
// one route a seat whose agent Orca has no launcher for can take and still
// report to the mailbox.
//
// WHAT IT PINS, and why each one is a real failure that happened:
//
//   * the new worktree is TRUSTED BEFORE the agent is started. An untrusted
//     folder is the 19-20 September failure exactly: the TUI sits on its trust
//     question, Orca says `input_accepted`, and nothing ever runs. agy asks the
//     same question Claude Code asks (measured 2026-09-22: "Do you trust the
//     contents of this project?" in a fresh folder).
//   * the REAL BRIEF is the one dispatch. The JUL-98 probe of this route passed
//     the placeholder `adopted-only` as `--spec` and typed the real brief in
//     afterwards (recorded in the runner's own agy history, entry 4 vs entry
//     5). Two deliveries is two chances to lose one, and the placeholder is
//     then what the worker was actually told to do.
//   * a route that cannot be completed TEARS DOWN WHAT IT MADE and says the
//     real reason, naming the seat -- so ../graph/controller/step-runner.mjs's
//     existing `launchRefused` fallback (JUL-98 step 5, fifth fix) is reused
//     rather than a second fallback being built beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startAdoptedWorker } from '../graph/controller/adopt.mjs';
import { launchForChoice } from '../graph/controller/dispatch.mjs';

const GEMINI = { entry: 'gemini', modelLabel: 'builder-gemini-flash', effort: 'medium' };
const SPEC = '# JUL-98 -- step 6\n\nThe real brief, and the only thing the worker is told.\n';

// A recorder for the whole sequence: every boundary appends its name, so the
// ORDER is testable and not merely the individual calls.
function boundaries(overrides = {}) {
  const calls = [];
  const base = {
    calls,
    async worktreeCreateImpl(args) {
      calls.push(['worktree-create', args]);
      return { worktree: { id: `repo-1::/home/runner/orca/workspaces/julia-next/${args.name}`, path: `/home/runner/orca/workspaces/julia-next/${args.name}` } };
    },
    async prepareWorktreeImpl(args) {
      calls.push(['prepare', args]);
      return { trusted: true, trustStore: '/home/runner/.gemini/antigravity-cli/settings.json', allowance: { 'gemini-weekly': 0.9935 } };
    },
    async agentTerminalCreateImpl(args) {
      calls.push(['terminal-create', args]);
      return { terminal: { handle: 'term_seat' } };
    },
    async terminalWaitImpl(args) {
      calls.push(['terminal-wait', args]);
      return { wait: { satisfied: true } };
    },
    async terminalCloseImpl(args) { calls.push(['terminal-close', args]); return { ok: true }; },
    async removeWorktreeImpl(args) { calls.push(['worktree-rm', args]); return { removed: true }; },
    async workerStartImpl(args) {
      calls.push(['worker-start', args]);
      return { state: 'ready', stage: 'input_accepted', taskId: 'task_1', dispatchId: 'ctx_1', runId: 'run_1', effects: [] };
    },
  };
  return { ...base, ...overrides, calls };
}

function run(extra = {}) {
  const b = boundaries(extra.boundaries ?? {});
  return {
    b,
    promise: startAdoptedWorker({
      seat: 'builder',
      entry: 'gemini',
      launch: launchForChoice(GEMINI),
      spec: SPEC,
      worktreeName: 'jul98-step-6-a1',
      runId: 'run_1',
      from: 'term_controller',
      requestId: 'JUL-98:step-6:builder:a1',
      ...b,
      ...(extra.args ?? {}),
    }),
  };
}

test('the worktree is trusted BEFORE the agent terminal is created, and for that exact path', async () => {
  const { b, promise } = run();
  const started = await promise;

  assert.equal(started.ok, true, started.reason);
  const order = b.calls.map(([name]) => name);
  assert.deepEqual(order, ['worktree-create', 'prepare', 'terminal-create', 'terminal-wait', 'worker-start']);

  const [, prepare] = b.calls.find(([name]) => name === 'prepare');
  assert.equal(prepare.worktreePath, '/home/runner/orca/workspaces/julia-next/jul98-step-6-a1');
  assert.equal(prepare.agent, 'agy', 'the trust list belongs to the agent that is about to be started');
});

test('the real brief is the ONE dispatch: --spec carries it, and nothing is typed in afterwards', async () => {
  const { b, promise } = run();
  await promise;

  const [, start] = b.calls.find(([name]) => name === 'worker-start');
  assert.equal(start.spec, SPEC, 'the brief itself, not a handover placeholder');
  assert.equal(start.terminal, 'term_seat', 'adopted, not launched with --agent');
  assert.equal(start.worktree, 'path:/home/runner/orca/workspaces/julia-next/jul98-step-6-a1');
  assert.equal(start.agent, undefined, '--agent and --terminal cannot both be passed');
  assert.equal(start.model, undefined, '--model cannot combine with --terminal (worker-start --help)');
  assert.equal(start.effort, undefined);
  // The placeholder the probe used must not be anywhere near a real dispatch.
  assert.ok(!JSON.stringify(b.calls).includes('adopted-only'));
  // And the brief is delivered once: no terminal send at all.
  assert.ok(!b.calls.some(([name]) => name === 'terminal-send'));
});

test('the agent is launched on the model and effort the card resolved, so the card still shows what runs', async () => {
  const { b, promise } = run();
  await promise;
  const [, created] = b.calls.find(([name]) => name === 'terminal-create');
  assert.match(created.command, /^agy /);
  assert.match(created.command, /gemini-3\.8-flash/);
  assert.match(created.command, /medium/);
  assert.equal(created.worktreePath, '/home/runner/orca/workspaces/julia-next/jul98-step-6-a1');
});

test('the allowance reading taken before the worker starts travels out, so the cost line can difference it', async () => {
  const { promise } = run();
  const started = await promise;
  assert.deepEqual(started.allowanceBefore, { 'gemini-weekly': 0.9935 });
});

test('a TUI that never goes idle is refused, naming the seat and the real reason, with everything it made taken back', async () => {
  const { b, promise } = run({
    boundaries: { async terminalWaitImpl() { return { wait: { satisfied: false } }; } },
  });
  const started = await promise;

  assert.equal(started.ok, false);
  assert.match(started.reason, /builder/);
  assert.match(started.reason, /gemini/);
  assert.match(started.reason, /start-then-adopt/);
  assert.match(started.reason, /idle|start/i);
  assert.ok(!b.calls.some(([name]) => name === 'worker-start'), 'nothing is adopted into a TUI that never started');
  // Taken back, so `launchRefused` stays honest and the seat can fall back.
  assert.ok(b.calls.some(([name]) => name === 'terminal-close'));
  assert.ok(b.calls.some(([name]) => name === 'worktree-rm'));
  assert.deepEqual(started.residualResources, []);
});

test('a worktree that could not be trusted is refused BEFORE an agent is started', async () => {
  const { b, promise } = run({
    boundaries: {
      async prepareWorktreeImpl() { return { trusted: false, reason: 'the agy settings file could not be written' }; },
    },
  });
  const started = await promise;

  assert.equal(started.ok, false);
  assert.match(started.reason, /trust/i);
  assert.match(started.reason, /agy settings file could not be written/);
  assert.ok(!b.calls.some(([name]) => name === 'terminal-create'), 'an untrusted folder is never started into');
  assert.ok(b.calls.some(([name]) => name === 'worktree-rm'));
});

test('cleanup that itself fails is reported as a residual resource rather than hidden', async () => {
  const { promise } = run({
    boundaries: {
      async terminalWaitImpl() { return { wait: { satisfied: false } }; },
      async removeWorktreeImpl() { throw new Error('worktree rm refused: selector_ambiguous'); },
    },
  });
  const started = await promise;

  assert.equal(started.ok, false);
  assert.match(started.reason, /start-then-adopt/);
  assert.equal(started.residualResources.length, 1);
  assert.match(JSON.stringify(started.residualResources), /selector_ambiguous/);
});

test('a worker-start that Orca itself failed is reported with Orcas own detail, not swallowed', async () => {
  const { promise } = run({
    boundaries: {
      async workerStartImpl() {
        return { state: 'failed', stage: 'agent_readiness', failedStage: 'agent_readiness', lastError: 'timeout', residualResources: [] };
      },
    },
  });
  const started = await promise;
  assert.equal(started.ok, false);
  assert.match(started.reason, /agent_readiness/);
  assert.match(started.reason, /timeout/);
});
