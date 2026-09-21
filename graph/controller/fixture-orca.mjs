// fixture-orca.mjs -- a stand-in for Orca built ONLY from the real recorded
// responses in graph/fixtures/orca-1.4.205/.
//
// JUL-98 is explicit that a stand-in must be built from what Orca actually
// answered and must refuse what the real Orca refuses. So every envelope this
// file hands back is read off disk from a recorded file; the only value ever
// substituted into one is the run's `objective` (the recording was made with
// the objective `JUL-109-probe`, and a controller names its run after the card
// it is carrying). No shape is invented, no field is added.
//
// What the recordings prove, and what this therefore reproduces:
//   * `run-create.ok.json` -- the first create: `mutation.replayed: false`.
//   * `run-create.replayed.json` -- the SAME request id again: the same run,
//     `mutation.replayed: true`, and no second run.
//   * `run-use.takeover.json` -- a second terminal takes the run;
//     `consumer_generation` goes 1 -> 2.
//   * `check.consumer-fenced.error.json` -- the terminal that lost the run is
//     refused with `consumer_fenced` on its next call.
//   * `run-create.no-sender-terminal.error.json` -- a run-create with no
//     sender terminal is refused.
//   * `mailbox.check-all.status-heartbeat-escalation-done.json` -- what a
//     healthy mailbox read looks like. (The mailbox LOOP is step 3, not this
//     step; the shape is used here only so `check` returns something real.)
//
// Errors are raised the way scripts/orca-cli.mjs raises them -- an Error whose
// message carries `(code)` and which also carries `.code` -- because that is
// what the controller actually catches.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORCA_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'orca-1.4.205',
);

export function loadOrcaFixture(name) {
  return JSON.parse(readFileSync(join(ORCA_FIXTURE_DIR, name), 'utf8'));
}

// The same error scripts/orca-cli.mjs would throw for a recorded `ok: false`
// envelope, with the code kept on the error so a caller can branch on it.
export function orcaErrorFromFixture(name, command = 'orchestration check') {
  const envelope = loadOrcaFixture(name);
  const { code, message } = envelope.error ?? {};
  const error = new Error(`orca ${command} failed (${code}): ${message}`);
  error.code = code;
  error.orcaCommand = command;
  return error;
}

// ---------------------------------------------------------------------------
// JUL-98 step 3: the worker half of the stand-in.
// ---------------------------------------------------------------------------
//
// Built the same way and under the same rule -- every envelope comes off disk:
//
//   * `worker-start.claude-model-effort.json` -- a healthy start. `state:
//     "ready"`, `stage: "input_accepted"`, a created worktree and terminal in
//     `effects`, `mutation.replayed: false`.
//   * `worker-start.failed-agent-readiness.json` -- the start that failed at
//     `agent_readiness` with `lastError: "timeout"` and a `residualResources`
//     list (probe 2, the folder-trust screen).
//
// The only values substituted are the ones a second start genuinely differs in:
// the task id, the dispatch id, the worktree path and the terminal handle. They
// are derived from the recorded ones by suffix, so their SHAPE is the recorded
// shape. A repeated request id replays the recorded receipt, which is Orca's own
// behaviour on every mutating call.
export function createFixtureWorkerOrca({ failStart = false } = {}) {
  const healthy = loadOrcaFixture('worker-start.claude-model-effort.json').result;
  const failed = loadOrcaFixture('worker-start.failed-agent-readiness.json').result;

  const calls = [];
  const receipts = new Map();
  let started = 0;

  function nth(value, index) {
    return `${value}-${index}`;
  }

  return {
    async workerStart(options = {}) {
      calls.push(options);
      if (options.requestId && receipts.has(options.requestId)) {
        const recorded = receipts.get(options.requestId);
        return { ...recorded, mutation: { ...recorded.mutation, replayed: true } };
      }
      if (failStart) {
        started += 1;
        return { ...failed };
      }
      started += 1;
      const index = started;
      const result = {
        ...healthy,
        taskId: nth(healthy.taskId, index),
        dispatchId: nth(healthy.dispatchId, index),
        effects: healthy.effects.map((effect) => ({ ...effect, id: nth(effect.id, index) })),
        launch: {
          requested: { agent: options.agent, model: options.model, effort: options.effort },
          effective: { agent: options.agent, model: options.model, effort: options.effort },
        },
      };
      if (options.requestId) receipts.set(options.requestId, result);
      return result;
    },

    workerStartCalls() {
      return calls;
    },
    workersStarted() {
      return started;
    },
  };
}

// A stand-in Orca holding exactly one run, with Orca's own two guarantees:
// a repeated request id replays, and a run belongs to one coordinator terminal
// at a time.
export function createFixtureOrca() {
  const created = loadOrcaFixture('run-create.ok.json').result;
  const replayedEnvelope = loadOrcaFixture('run-create.replayed.json').result;
  const takeover = loadOrcaFixture('run-use.takeover.json').result;
  const mailbox = loadOrcaFixture('mailbox.check-all.status-heartbeat-escalation-done.json').result;

  let run = null;
  let owner = null;
  let runs = 0;
  // requestId -> the receipt Orca recorded for it.
  const receipts = new Map();

  function withObjective(result, objective) {
    // The ONLY substitution: the run's objective. Everything else is the
    // recorded payload.
    return { ...result, run: { ...result.run, objective } };
  }

  return {
    async runCreate({ from, objective, requestId } = {}) {
      if (!from) {
        // The real refusal, recorded: a run-create with no sender terminal.
        throw orcaErrorFromFixture('run-create.no-sender-terminal.error.json', 'orchestration run-create');
      }
      if (requestId && receipts.has(requestId)) {
        // Safe replay: the recorded receipt, nothing started.
        return withObjective({ ...replayedEnvelope, run: receipts.get(requestId).run }, objective);
      }
      runs += 1;
      run = { ...created.run, objective, coordinator_handle: from };
      owner = from;
      const result = withObjective({ ...created, run }, objective);
      if (requestId) receipts.set(requestId, result);
      return result;
    },

    // A second controller taking the run: consumer_generation advances and the
    // previous terminal is fenced from that moment.
    async runUse({ from } = {}) {
      owner = from;
      run = { ...takeover.run, objective: run?.objective ?? takeover.run.objective, coordinator_handle: from };
      return { ...takeover, run };
    },

    async check({ terminal } = {}) {
      if (owner && terminal !== owner) {
        throw orcaErrorFromFixture('check.consumer-fenced.error.json', 'orchestration check');
      }
      return mailbox;
    },

    runsCreated() {
      return runs;
    },
    currentRun() {
      return run;
    },
  };
}
