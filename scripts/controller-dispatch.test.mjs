// controller-dispatch.test.mjs -- JUL-98 step 3, items 1 and 3: every step goes
// to a FRESH worker, and only Orca's own proof that a turn started counts as
// started.
//
// The payload shapes here are not invented. Every Orca answer used below is
// read off the recorded files in graph/fixtures/orca-1.4.205/ through
// graph/controller/fixture-orca.mjs:
//
//   worker-start.claude-model-effort.json      a healthy start: state ready,
//                                              stage input_accepted
//   worker-start.codex-model-effort.json       the same for the Codex seat
//   worker-start.failed-agent-readiness.json   the start itself failed
//                                              (failedStage agent_readiness,
//                                              lastError timeout) -- the trust
//                                              screen, probe 2
//   terminal-send.wait-submit.turn-started.json    stages input_accepted,
//                                                  turn_started
//   terminal-send.wait-submit.no-turn-started.json stages input_accepted ONLY,
//                                                  plus Orca's own warning
//   worktree-ps.agent-working.json             agents[].state "working"
//
// The 19-20 September incident this pins: a builder sat at a trust prompt for
// about eight hours because "input accepted" was read as "started". Orca never
// said started -- nothing asked it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKER_SKILLS,
  LAUNCH_MODEL_IDS,
  launchForChoice,
  buildStepBrief,
  dispatchWorker,
} from '../graph/controller/dispatch.mjs';
import {
  TURN_STARTED,
  INPUT_ACCEPTED,
  turnStartedFromSend,
  turnStartedFromWorktreePs,
  proveTurnStarted,
} from '../graph/controller/turn-start.mjs';
import { loadOrcaFixture, createFixtureWorkerOrca } from '../graph/controller/fixture-orca.mjs';
import { RATE_TABLE } from '../graph/rate-table.mjs';

const CARD = {
  identifier: 'JUL-92',
  title: 'Docs and settings match how things run now',
  url: 'https://linear.app/julia-next/issue/JUL-92',
};

const PLAN = [
  { key: 'step-1', title: 'fix the stale runbook lines', brief: 'Rewrite the three stale runbook paragraphs.', criteria: ['the runbook names the real paths'] },
  { key: 'step-2', title: 'fix the wrong settings', brief: 'Correct the two settings that no longer match.', criteria: ['settings match what runs'] },
  { key: 'step-3', title: 'review', brief: 'Review the two commits above.', criteria: ['every claim names its source'] },
];

const CHOICES = {
  builder: { entry: 'claude', modelLabel: 'builder-claude-opus', effort: 'medium' },
  reviewer: { entry: 'codex', modelLabel: 'adversary-codex', effort: 'medium' },
};

// ---------------------------------------------------------------------------
// Item 1: a fresh worker per step, carrying only that step
// ---------------------------------------------------------------------------

test('the brief carries the card, this step and its skill -- and nothing of any other step', () => {
  const brief = buildStepBrief({
    seat: 'builder',
    card: CARD,
    step: PLAN[1],
    files: ['docs/agents/jul43-coordinator-runbook.md'],
  });

  assert.match(brief, /JUL-92/);
  assert.match(brief, /Docs and settings match how things run now/);
  assert.match(brief, /Correct the two settings that no longer match\./);
  assert.match(brief, /settings match what runs/);
  assert.match(brief, /docs\/agents\/jul43-coordinator-runbook\.md/);
  assert.ok(brief.includes(WORKER_SKILLS.builder), 'the builder is pointed at the builder skill');
  assert.ok(!brief.includes(WORKER_SKILLS.reviewer), 'and not at the reviewer skill');

  // The whole point of a fresh worker: no other step's words reach it.
  assert.ok(!brief.includes('Rewrite the three stale runbook paragraphs'), 'step 1 must not be in step 2\'s brief');
  assert.ok(!brief.includes('Review the two commits above'), 'step 3 must not be in step 2\'s brief');
  assert.ok(!brief.includes('the runbook names the real paths'), 'step 1\'s criteria must not travel either');
});

test('a review step gets the reviewer skill, not the builder one', () => {
  const brief = buildStepBrief({ seat: 'reviewer', card: CARD, step: PLAN[2] });
  assert.ok(brief.includes(WORKER_SKILLS.reviewer));
  assert.ok(!brief.includes(WORKER_SKILLS.builder));
});

test('a seat choice becomes the launch Orca actually records: agent, a real model id, effort', () => {
  assert.deepEqual(launchForChoice(CHOICES.builder), { route: 'agent', agent: 'claude', model: LAUNCH_MODEL_IDS.opus, effort: 'medium' });
  assert.deepEqual(launchForChoice(CHOICES.reviewer), { route: 'agent', agent: 'codex', model: LAUNCH_MODEL_IDS.codex, effort: 'medium' });

  // Every model id dispatched is one the cost table can price -- otherwise the
  // cost line for that seat could only ever be blank, which fails the step.
  for (const id of Object.values(LAUNCH_MODEL_IDS)) {
    assert.ok(RATE_TABLE.models[id], `graph/rate-table.mjs has no price for the dispatched model id ${id}`);
  }
});

// JUL-98 step 6. Until now this seat was REFUSED outright, and the refusal's
// own wording said what had to be built instead: "an interactive session
// started first and adopted with worker-start --terminal once it has fully
// started". That route now exists, so the DeepSeek seat takes it -- the same
// route the Gemini seat takes, because it is the same problem.
test('a seat whose agent Orca cannot launch takes the start-then-adopt route, not a refusal', () => {
  const pi = launchForChoice({ entry: 'pi-deepseek', modelLabel: 'adversary-deepseek-pro', effort: 'medium' });
  assert.equal(pi.route, 'adopt', 'the route, not an --agent name, is what keeps it away from worker-start --agent');
  assert.equal(pi.agent, 'pi', 'the agent that actually runs, which is what the cost read has to know');
  assert.equal(pi.model, LAUNCH_MODEL_IDS['deepseek-v4-pro'], 'the model is still resolved, so the cost line can be accounted for');

  const gemini = launchForChoice({ entry: 'gemini', modelLabel: 'builder-gemini-flash', effort: 'high' });
  assert.equal(gemini.route, 'adopt');
  assert.equal(gemini.agent, 'agy');
  assert.equal(gemini.model, LAUNCH_MODEL_IDS['gemini-3.8-flash']);
  assert.equal(gemini.effort, 'high');
  assert.match(gemini.command, /^agy .*gemini-3\.8-flash/);

  // ONE route, not two: both seats come back in the same shape.
  assert.deepEqual(Object.keys(pi).sort(), Object.keys(gemini).sort());
});

test('an entry with no Orca agent and no adopt route is still refused by name', () => {
  const refusal = launchForChoice({ entry: 'potato', modelLabel: 'builder-claude-opus', effort: 'medium' });
  assert.equal(refusal.ok, false);
  assert.match(refusal.reason, /potato/);
});

test('each step is a separate worker-start: a new task, a new dispatch, a new worktree, and no terminal reuse', async () => {
  const orca = createFixtureWorkerOrca();

  const first = await dispatchWorker({
    workerStartImpl: orca.workerStart,
    environment: 'ovh-local',
    runId: 'run_1bf570ce5660',
    from: 'term_controller',
    repo: 'path:/home/runner/julia-next',
    seat: 'builder',
    card: CARD,
    step: PLAN[0],
    choice: CHOICES.builder,
    worktreeName: 'jul92-step-1',
    requestId: 'JUL-92:step-1:builder',
  });
  const second = await dispatchWorker({
    workerStartImpl: orca.workerStart,
    environment: 'ovh-local',
    runId: 'run_1bf570ce5660',
    from: 'term_controller',
    repo: 'path:/home/runner/julia-next',
    seat: 'builder',
    card: CARD,
    step: PLAN[1],
    choice: CHOICES.builder,
    worktreeName: 'jul92-step-2',
    requestId: 'JUL-92:step-2:builder',
  });

  assert.notEqual(first.dispatchId, second.dispatchId, 'a fresh dispatch per step');
  assert.notEqual(first.taskId, second.taskId, 'a fresh task per step');
  assert.equal(second.replayed, false);

  const calls = orca.workerStartCalls();
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.worktree, 'new-top-level', 'a fresh worktree, never a reused one');
    assert.equal(call.terminal, undefined, 'never an adopted terminal: that would carry another step\'s session');
  }
  assert.ok(calls[1].spec.includes('Correct the two settings'), 'step 2\'s worker got step 2\'s brief');
  assert.ok(!calls[1].spec.includes('Rewrite the three stale runbook paragraphs'), 'and nothing of step 1');
});

test('a repeated dispatch with the same request id replays: no second worker for the same step', async () => {
  const orca = createFixtureWorkerOrca();
  const args = {
    workerStartImpl: orca.workerStart,
    environment: 'ovh-local',
    runId: 'run_1bf570ce5660',
    from: 'term_controller',
    repo: 'path:/home/runner/julia-next',
    seat: 'builder',
    card: CARD,
    step: PLAN[0],
    choice: CHOICES.builder,
    worktreeName: 'jul92-step-1',
    requestId: 'JUL-92:step-1:builder',
  };
  const first = await dispatchWorker(args);
  const again = await dispatchWorker(args);
  assert.equal(again.dispatchId, first.dispatchId);
  assert.equal(again.replayed, true);
  assert.equal(orca.workerStartCalls().length, 2, 'the call was made again');
  assert.equal(orca.workersStarted(), 1, 'but Orca started only one worker');
});

test('a start that failed at agent readiness is reported as not started, with Orca\'s own reason', async () => {
  const orca = createFixtureWorkerOrca({ failStart: true });
  const result = await dispatchWorker({
    workerStartImpl: orca.workerStart,
    environment: 'ovh-local',
    runId: 'run_1bf570ce5660',
    from: 'term_controller',
    repo: 'path:/home/runner/julia-next',
    seat: 'builder',
    card: CARD,
    step: PLAN[0],
    choice: CHOICES.builder,
    worktreeName: 'jul92-step-1',
    requestId: 'r',
  });
  assert.equal(result.ok, false);
  assert.equal(result.failedStage, 'agent_readiness');
  assert.equal(result.lastError, 'timeout');
  assert.ok(result.residualResources.length > 0, 'the worktree and terminal it left behind are named, so cleanup can find them');
});

// ---------------------------------------------------------------------------
// Item 3: only turn_started proves the agent began
// ---------------------------------------------------------------------------

test('input_accepted alone is NOT treated as started -- the eight-hour trust-screen bug', () => {
  const send = loadOrcaFixture('terminal-send.wait-submit.no-turn-started.json').result;
  assert.deepEqual(send.send.prompt.stages, [INPUT_ACCEPTED], 'fixture check: the recording really has only input_accepted');

  assert.equal(turnStartedFromSend(send), false);

  const verdict = proveTurnStarted({ send });
  assert.equal(verdict.started, false);
  assert.match(verdict.reason, /input.accepted/i);
  assert.equal(verdict.retryRequestId, send.send.prompt.requestId, 'Orca names the request id to replay with; it is carried through');
  assert.ok(verdict.warnings.length > 0, 'Orca\'s own warning is kept, not swallowed');
});

test('stages including turn_started is proof, and it is the only send-side proof', () => {
  const send = loadOrcaFixture('terminal-send.wait-submit.turn-started.json').result;
  assert.ok(send.send.prompt.stages.includes(TURN_STARTED), 'fixture check');
  assert.equal(turnStartedFromSend(send), true);

  const verdict = proveTurnStarted({ send });
  assert.equal(verdict.started, true);
  assert.equal(verdict.source, 'terminal-send');
});

test('a worker-start answer is never proof on its own: its stage is input_accepted even on a healthy start', () => {
  const healthy = loadOrcaFixture('worker-start.claude-model-effort.json').result;
  assert.equal(healthy.state, 'ready');
  assert.equal(healthy.stage, INPUT_ACCEPTED, 'fixture check: a start that went on to succeed still only says input_accepted');

  const verdict = proveTurnStarted({ start: healthy });
  assert.equal(verdict.started, false, 'the start alone proves nothing began');
  assert.match(verdict.reason, /worker-start/);
});

test('the lost-payload recording is read as not started: a real in-flight worker whose task text never arrived', () => {
  const show = loadOrcaFixture('worker-show.in-flight-input-accepted.json').result;
  const verdict = proveTurnStarted({ show });
  assert.equal(verdict.started, false);
  assert.match(verdict.reason, /input.accepted/i);
});

test('worktree ps is the second recorded proof: an agent in state working really began', () => {
  const ps = loadOrcaFixture('worktree-ps.agent-working.json').worktree;
  assert.equal(turnStartedFromWorktreePs(ps), true);

  const verdict = proveTurnStarted({ worktree: ps });
  assert.equal(verdict.started, true);
  assert.equal(verdict.source, 'worktree-ps');
});

test('a worktree with no agent, or an idle one, is not proof', () => {
  assert.equal(turnStartedFromWorktreePs({ agents: [] }), false);
  assert.equal(turnStartedFromWorktreePs({ agents: [{ state: 'idle', agentType: 'claude' }] }), false);
  assert.equal(turnStartedFromWorktreePs(null), false);
});

// --- The stand-in invents nothing --------------------------------------------
//
// The review finding this pins (JUL-98 step 3, attempt 1): the worker stand-in
// suffixed `effect.id` on EVERY effect of a recorded worker-start. Three of the
// four recorded effects carry an `id`; the `kind: "setup"` effect does not
// (worker-start.claude-model-effort.json: it has kind, action, requested,
// effective, source, hookFound, startupPolicy, state -- and no id). Suffixing a
// field that is not there produced `id: "undefined-1"`: a payload shape that
// appears in no recording. Invented payload shapes are what got an earlier card
// cancelled, so the stand-in must key off what the recording actually holds.

test('the stand-in gives every effect exactly the keys its recorded effect has -- no field is invented', async () => {
  const recorded = loadOrcaFixture('worker-start.claude-model-effort.json').result.effects;
  const orca = createFixtureWorkerOrca();
  const started = await orca.workerStart({ agent: 'claude', model: 'claude-opus-5', effort: 'medium' });

  assert.equal(started.effects.length, recorded.length);
  started.effects.forEach((effect, index) => {
    assert.deepEqual(
      Object.keys(effect).sort(),
      Object.keys(recorded[index]).sort(),
      `effect ${index} (${effect.kind}) must carry the recorded keys and no others`,
    );
  });

  const setup = started.effects.find((effect) => effect.kind === 'setup');
  assert.ok(setup, 'the recording has a setup effect');
  assert.equal('id' in setup, false, 'no recording gives a setup effect an id, so the stand-in must not produce one');

  // The effects that DO have a recorded id still get a per-start one, because
  // a second start genuinely has a different worktree and terminal.
  const worktree = started.effects.find((effect) => effect.kind === 'worktree');
  assert.ok(worktree.id.startsWith(recorded.find((e) => e.kind === 'worktree').id), 'the shape stays the recorded shape');
  assert.ok(!worktree.id.includes('undefined'));
});

// ---------------------------------------------------------------------------
// JUL-98 step 6: dispatchWorker sends an adopt-route seat down the adopt route,
// and a route that cannot be completed comes back as the SAME refusal a seat
// with no agent at all comes back as -- so step-runner.mjs's existing seat
// fallback catches it with no new machinery.
// ---------------------------------------------------------------------------

const GEMINI_CHOICE = { entry: 'gemini', modelLabel: 'builder-gemini-flash', effort: 'medium' };

test('a Gemini seat is dispatched through the start-then-adopt route, carrying its own brief', async () => {
  let adopted = null;
  const result = await dispatchWorker({
    workerStartImpl: async () => { throw new Error('the adopt route must not use worker-start --agent'); },
    startAdoptedWorkerImpl: async (args) => {
      adopted = args;
      return { ok: true, result: { state: 'ready', stage: 'input_accepted', taskId: 'task_g', dispatchId: 'ctx_g', runId: 'run_1', effects: [] }, worktree: 'repo-1::/w/jul98-6', terminal: 'term_seat', allowanceBefore: { 'gemini-weekly': 0.99 } };
    },
    environment: 'ovh-local',
    runId: 'run_1',
    from: 'term_controller',
    repo: 'path:/home/runner/julia-next',
    seat: 'builder',
    card: CARD,
    step: PLAN[0],
    choice: GEMINI_CHOICE,
    worktreeName: 'jul98-6',
    requestId: 'JUL-98:step-6:builder',
  });

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.terminal, 'term_seat');
  assert.equal(result.worktree, 'repo-1::/w/jul98-6');
  assert.deepEqual(result.allowanceBefore, { 'gemini-weekly': 0.99 });
  assert.equal(adopted.spec, result.spec, 'the one dispatch carries this step\'s own brief');
  assert.match(adopted.spec, /fix the stale runbook lines/);
  assert.equal(adopted.launch.route, 'adopt');
});

test('a start-then-adopt route that could not be completed is the refusal the seat fallback already knows', async () => {
  const result = await dispatchWorker({
    workerStartImpl: async () => { throw new Error('not reached'); },
    startAdoptedWorkerImpl: async () => ({
      ok: false,
      reason: "the builder seat's gemini start-then-adopt route could not be completed: agy never reached an idle prompt",
      residualResources: [],
    }),
    environment: 'ovh-local',
    runId: 'run_1',
    from: 'term_controller',
    repo: 'path:/home/runner/julia-next',
    seat: 'builder',
    card: CARD,
    step: PLAN[0],
    choice: GEMINI_CHOICE,
    worktreeName: 'jul98-6',
    requestId: 'JUL-98:step-6:builder',
  });

  assert.equal(result.ok, false);
  assert.equal(result.launchRefused, true, 'the route took back everything it made, so nothing was left behind');
  assert.equal(result.entry, 'gemini');
  assert.match(result.reason, /builder/);
  assert.match(result.reason, /agy never reached an idle prompt/);
  assert.deepEqual(result.residualResources, []);
});

// ---------------------------------------------------------------------------
// JUL-98 step 6: PROOF THAT AN ADOPTED WORKER'S TURN STARTED.
//
// Measured live on this host on 2026-09-22, adopting a real agy terminal:
//
//   worker-start --terminal ... ->
//     prompt: { stages: ["input_accepted"], provider: "unsupported",
//               observation: "unsupported" }
//   worktree ps                 ->  agents: []
//   terminal wait --for tui-idle --timeout-ms 4000  ->  timeout
//   terminal show               ->  agentIdentity: "antigravity", and the
//                                   preview holds the brief
//
// So Orca says in as many words that it CANNOT observe a turn for this
// provider, and it tracks no agent for it either. The one thing it can still
// answer is whether the terminal is idle -- and the transition is the proof:
// the route waited for idle BEFORE delivering the brief (that is how it knew
// the agent had started), and the terminal is busy immediately after. A TUI
// sitting on a trust or login screen stays idle through both.
// ---------------------------------------------------------------------------

test('an adopted worker carries its own turn-start observation, because Orca can observe nothing else for it', async () => {
  const result = await dispatchWorker({
    workerStartImpl: async () => { throw new Error('not reached'); },
    startAdoptedWorkerImpl: async () => ({
      ok: true,
      result: { state: 'ready', stage: 'input_accepted', taskId: 't', dispatchId: 'c', runId: 'r', effects: [] },
      worktree: 'repo-1::/w/jul98-6',
      terminal: 'term_seat',
      allowanceBefore: { 'gemini-weekly': 0.99 },
      observed: { busy: { terminal: 'term_seat', satisfied: false, timedOut: true } },
    }),
    environment: 'ovh-local',
    runId: 'run_1',
    from: 'term_controller',
    repo: 'path:/home/runner/julia-next',
    seat: 'builder',
    card: CARD,
    step: PLAN[0],
    choice: GEMINI_CHOICE,
    worktreeName: 'jul98-6',
    requestId: 'JUL-98:step-6:builder',
  });

  assert.deepEqual(result.observed, { busy: { terminal: 'term_seat', satisfied: false, timedOut: true } });
});

test('a terminal still busy after the brief was delivered is proof; one that went idle is not', () => {
  const busy = proveTurnStarted({ busy: { satisfied: false, timedOut: true } });
  assert.equal(busy.started, true);
  assert.equal(busy.source, 'terminal-busy');

  const idle = proveTurnStarted({ busy: { satisfied: true } });
  assert.equal(idle.started, false);
  assert.match(idle.reason, /idle/);
  assert.match(idle.reason, /trust|login/i, 'and it names what an idle terminal looks like');
});

test('an adopt entry whose launch command cannot be built is REFUSED, never interpolated as undefined', () => {
  // The Pi route picks its seat launcher from the model, and `run-pi-seat.mjs`
  // knows three seats. A model outside that map used to interpolate `undefined`
  // into a shell command that would then have run.
  const refusal = launchForChoice({ entry: 'pi-deepseek', modelLabel: 'builder-deepseek-turbo', effort: 'medium' });
  assert.equal(refusal.ok, false);
  assert.match(refusal.reason, /deepseek-turbo/);
  // And the two real ones still build.
  assert.match(launchForChoice({ entry: 'pi-deepseek', modelLabel: 'adversary-deepseek-pro', effort: 'medium' }).command, /reviewer-backup/);
  assert.match(launchForChoice({ entry: 'pi-deepseek', modelLabel: 'builder-deepseek-flash', effort: 'medium' }).command, /builder-backup/);
});
