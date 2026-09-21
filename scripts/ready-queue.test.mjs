// ready-queue.test.mjs -- JUL-79 step 1. Every external effect (Linear
// query/comment, Orca run/task/terminal, state-file I/O, clock) is injected
// here, so this suite never touches the network, Linear, Orca, or the real
// state path. The fakes below stand in for those boundaries; the assertions
// pin the queue's own decision rules.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readyQueueCheck,
  pickTopCard,
  evaluateEligibility,
  issueFingerprint,
  isBlockerClosed,
  isSlotBusy,
  readState,
  writeState,
  resolveLinearApiKey,
  parseArgs,
  resolveIntervalMinutes,
  defaultValidateModelChoice,
  normalizeIssue,
  ineligibleCommentBody,
  READY_FOR_AGENT_LABEL,
  DECISION_LABEL,
  PARENT_LABEL,
  DEFAULT_INTERVAL_MINUTES,
} from './ready-queue.mjs';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const READY_STATE = { id: 'state-ready', name: 'Ready', type: 'unstarted' };
const IN_PROGRESS_STATE = { id: 'state-in-progress', name: 'Implementation', type: 'started' };

function makeIssue(overrides = {}) {
  const identifier = overrides.identifier ?? 'JUL-63';
  return {
    id: `uuid-${identifier}`,
    identifier,
    title: `${identifier} title`,
    sortOrder: 0,
    state: { ...READY_STATE },
    labels: [READY_FOR_AGENT_LABEL],
    blockers: [],
    ...overrides,
  };
}

function fakeLinear({ state = READY_STATE, inProgress = IN_PROGRESS_STATE, issues = [], teamLabels = [] } = {}) {
  const calls = { comments: [], listedStateId: undefined, stateMoves: [], labelLookups: [], labelAdds: [] };
  return {
    calls,
    linear: {
      findState: async ({ stateName } = {}) => (stateName === 'Implementation' ? inProgress : state),
      listIssuesInState: async (stateId) => {
        calls.listedStateId = stateId;
        return issues;
      },
      comment: async ({ issueId, body }) => {
        calls.comments.push({ issueId, body });
        return { id: `comment-${calls.comments.length}` };
      },
      findLabels: async ({ names = [] } = {}) => {
        calls.labelLookups.push(names);
        const found = {};
        const missing = [];
        for (const name of names) {
          const match = teamLabels.find((label) => label.name === name);
          if (match) found[name] = match.id;
          else missing.push(name);
        }
        return { found, missing };
      },
      addLabels: async ({ issueId, labelIds }) => {
        calls.labelAdds.push({ issueId, labelIds });
        // Mirror Linear: the added labels are on the card the next time it is
        // listed, which is what the lastStarted fingerprint must match.
        const byId = new Map(teamLabels.map((label) => [label.id, label.name]));
        const target = issues.find((candidate) => candidate.id === issueId);
        if (target) {
          const names = labelIds.map((id) => byId.get(id)).filter(Boolean);
          target.labels = [...(target.labels ?? []), ...names];
        }
        return { id: issueId };
      },
      setIssueState: async ({ issueId, stateId }) => {
        calls.stateMoves.push({ issueId, stateId });
        return { id: issueId, state: inProgress };
      },
    },
  };
}

function fakeOrca({ runs = [] } = {}) {
  const calls = { terminalsCreated: [], runListCalls: [] };
  return {
    calls,
    impls: {
      runListImpl: async (opts) => {
        calls.runListCalls.push(opts);
        return { runs };
      },
      taskListImpl: async () => ({ tasks: [] }),
      isRunFinishedImpl: async () => true,
      terminalCreateImpl: async (payload) => {
        calls.terminalsCreated.push(payload);
        return { terminal: { handle: 'term_ready_1' } };
      },
    },
  };
}

function fakeStore(initial = {}) {
  let state = structuredClone({ ready: {}, commented: {}, lastStarted: null, ...initial });
  return {
    readImpl: async () => structuredClone(state),
    writeImpl: async (next) => { state = structuredClone(next); },
    get: () => state,
  };
}

function deps({ linear, store, orca = fakeOrca(), logs, ...rest }) {
  return {
    linear,
    ...orca.impls,
    readStateImpl: store.readImpl,
    writeStateImpl: store.writeImpl,
    now: () => NOW,
    // The real entry logs to stderr; tests that assert on it pass their own
    // collector. The default is silent so a skipped/uncreated label does not
    // clutter the suite's output.
    logErrorImpl: logs ? (message) => logs.push(message) : () => {},
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Board order: top card selection
// ---------------------------------------------------------------------------

test('pickTopCard: the card with the lowest sortOrder wins, regardless of input order', () => {
  const a = makeIssue({ identifier: 'JUL-1', sortOrder: 10 });
  const b = makeIssue({ identifier: 'JUL-2', sortOrder: -28624 });
  assert.equal(pickTopCard([a, b]), b);
  assert.equal(pickTopCard([b, a]), b);
});

test('pickTopCard: empty Ready returns null', () => {
  assert.equal(pickTopCard([]), null);
});

test('pickTopCard: exact sortOrder ties keep board (input) order -- stable', () => {
  const a = makeIssue({ identifier: 'JUL-1', sortOrder: 5 });
  const b = makeIssue({ identifier: 'JUL-2', sortOrder: 5 });
  assert.equal(pickTopCard([a, b]), a);
  assert.equal(pickTopCard([b, a]), b);
});

test('pickTopCard: a missing sortOrder sorts last rather than winning by NaN', () => {
  const missing = makeIssue({ identifier: 'JUL-1', sortOrder: undefined });
  const real = makeIssue({ identifier: 'JUL-2', sortOrder: 3 });
  assert.equal(pickTopCard([missing, real]), real);
});

// ---------------------------------------------------------------------------
// Eligibility helpers
// ---------------------------------------------------------------------------

test('issueFingerprint changes when labels, state, or a blocker state changes', () => {
  const base = makeIssue();
  assert.equal(issueFingerprint(base), issueFingerprint(makeIssue()));
  assert.notEqual(issueFingerprint(base), issueFingerprint(makeIssue({ labels: [] })));
  assert.notEqual(
    issueFingerprint(base),
    issueFingerprint(makeIssue({ state: { id: 'other', name: 'Todo', type: 'unstarted' } })),
  );
  assert.notEqual(
    issueFingerprint(base),
    issueFingerprint(makeIssue({ blockers: [{ identifier: 'JUL-1', state: { name: 'In Progress', type: 'started' } }] })),
  );
});

test('isBlockerClosed: Done/Canceled (by type or name) is closed, anything else is open', () => {
  assert.equal(isBlockerClosed({ state: { name: 'Done', type: 'completed' } }), true);
  assert.equal(isBlockerClosed({ state: { name: 'Canceled', type: 'canceled' } }), true);
  assert.equal(isBlockerClosed({ state: { name: 'Cancelled', type: 'canceled' } }), true);
  assert.equal(isBlockerClosed({ state: { name: 'In Progress', type: 'started' } }), false);
  assert.equal(isBlockerClosed({ state: { name: 'Backlog', type: 'backlog' } }), false);
});

test('evaluateEligibility: a card with no ready-for-agent label is eligible when its model choice validates (JUL-97)', () => {
  const { eligible, reasons } = evaluateEligibility(makeIssue({ labels: [] }));
  assert.equal(eligible, true);
  assert.deepEqual(reasons, []);
});

test('evaluateEligibility: a Decision label is refused, naming the label', () => {
  const { eligible, reasons } = evaluateEligibility(makeIssue({ labels: [DECISION_LABEL] }));
  assert.equal(eligible, false);
  assert.match(reasons.join(' '), /Decision/);
  assert.match(reasons.join(' '), /not agent work/);
});

test('evaluateEligibility: a Parent label is refused, naming the label', () => {
  const { eligible, reasons } = evaluateEligibility(makeIssue({ labels: [PARENT_LABEL] }));
  assert.equal(eligible, false);
  assert.match(reasons.join(' '), /Parent/);
});

test('evaluateEligibility: a card carrying both coordinate labels reports both reasons', () => {
  const { eligible, reasons } = evaluateEligibility(makeIssue({ labels: [DECISION_LABEL, PARENT_LABEL] }));
  assert.equal(eligible, false);
  assert.equal(reasons.length, 2);
});

test('evaluateEligibility: an open blocker is ineligible and names the blocker', () => {
  const { eligible, reasons } = evaluateEligibility(makeIssue({
    blockers: [{ identifier: 'JUL-1', state: { name: 'In Progress', type: 'started' } }],
  }));
  assert.equal(eligible, false);
  assert.match(reasons.join(' '), /JUL-1/);
});

test('evaluateEligibility: a closed blocker is eligible', () => {
  const { eligible, reasons } = evaluateEligibility(makeIssue({
    blockers: [{ identifier: 'JUL-1', state: { name: 'Done', type: 'completed' } }],
  }));
  assert.equal(eligible, true);
  assert.deepEqual(reasons, []);
});

test('evaluateEligibility: a model-choice validator refusal is ineligible with the validator reason', () => {
  const { eligible, reasons } = evaluateEligibility(makeIssue(), {
    validateModelChoiceImpl: () => ({ ok: false, reason: 'no model group for this label set' }),
  });
  assert.equal(eligible, false);
  assert.match(reasons.join(' '), /no model group/);
});

test('evaluateEligibility: the default validator applies the real seat-table rule (defaults differ in family, so it passes)', () => {
  assert.deepEqual(defaultValidateModelChoice(makeIssue()), { ok: true });
  assert.equal(evaluateEligibility(makeIssue()).eligible, true);
});

test('ineligibleCommentBody names the card and each reason', () => {
  const body = ineligibleCommentBody(makeIssue({ identifier: 'JUL-63' }), ['the card carries the Decision label; Decision cards are not agent work']);
  assert.match(body, /JUL-63/);
  assert.match(body, /Decision/);
});

// ---------------------------------------------------------------------------
// Width-1 slot check
// ---------------------------------------------------------------------------

test('isSlotBusy: true while any run is active, false once every run is finished', async () => {
  const runs = [{ id: 'r1' }, { id: 'r2' }];
  const busy = await isSlotBusy({
    runListImpl: async () => ({ runs }),
    isRunFinishedImpl: async (run) => run.id !== 'r1',
    taskListImpl: async () => ({ tasks: [] }),
    now: () => NOW,
  });
  assert.equal(busy, true);

  const free = await isSlotBusy({
    runListImpl: async () => ({ runs }),
    isRunFinishedImpl: async () => true,
    taskListImpl: async () => ({ tasks: [] }),
    now: () => NOW,
  });
  assert.equal(free, false);
});

// ---------------------------------------------------------------------------
// Check cycle
// ---------------------------------------------------------------------------

test('Ready state absent -> no-op, quiet exit (no list, no comment, no start)', async () => {
  const { linear, calls } = fakeLinear({ state: null });
  const store = fakeStore();
  const orca = fakeOrca();
  const result = await readyQueueCheck(deps({ linear, store, orca }));
  assert.equal(result.status, 'no-ready-state');
  assert.equal(orca.calls.terminalsCreated.length, 0);
  assert.equal(calls.comments.length, 0);
  assert.equal(orca.calls.runListCalls.length, 0);
});

test('slot busy -> no-op: never lists Ready, never comments, never starts', async () => {
  const { linear, calls } = fakeLinear({ issues: [makeIssue()] });
  const store = fakeStore();
  const orca = fakeOrca({ runs: [{ id: 'r1', objective: 'JUL-1' }] });
  orca.impls.isRunFinishedImpl = async () => false;
  const result = await readyQueueCheck(deps({ linear, store, orca }));
  assert.equal(result.status, 'slot-busy');
  assert.equal(calls.listedStateId, undefined);
  assert.equal(calls.comments.length, 0);
  assert.equal(orca.calls.terminalsCreated.length, 0);
});

test('empty Ready -> no-op, no start, no comment', async () => {
  const { linear, calls } = fakeLinear({ issues: [] });
  const store = fakeStore();
  const orca = fakeOrca();
  const result = await readyQueueCheck(deps({ linear, store, orca }));
  assert.equal(result.status, 'empty-ready');
  assert.equal(calls.comments.length, 0);
  assert.equal(orca.calls.terminalsCreated.length, 0);
});

test('one-full-check: the first sighting never starts; the second consecutive check does', async () => {
  const issue = makeIssue();
  const { linear } = fakeLinear({ issues: [issue] });
  const store = fakeStore();
  const orca = fakeOrca();
  const d = deps({ linear, store, orca });

  const first = await readyQueueCheck(d);
  assert.equal(first.status, 'first-sighting');
  assert.equal(orca.calls.terminalsCreated.length, 0);
  assert.ok(issue.id in store.get().ready);

  const second = await readyQueueCheck(d);
  assert.equal(second.status, 'started');
  assert.equal(orca.calls.terminalsCreated.length, 1);
});

test('a card that left Ready between checks never starts', async () => {
  const issue = makeIssue();
  const store = fakeStore();
  const orca = fakeOrca();
  let issues = [issue];
  const { linear } = fakeLinear();
  linear.listIssuesInState = async () => issues;
  const d = deps({ linear, store, orca });

  await readyQueueCheck(d); // first sighting
  issues = []; // leaves Ready between checks
  assert.equal((await readyQueueCheck(d)).status, 'empty-ready');
  issues = [issue]; // returns -- still a first sighting, not a start
  assert.equal((await readyQueueCheck(d)).status, 'first-sighting');
  assert.equal(orca.calls.terminalsCreated.length, 0);
});

test('starting a card creates exactly the rule-6 terminal payload', async () => {
  const issue = makeIssue({ identifier: 'JUL-63' });
  const { linear } = fakeLinear({ issues: [issue] });
  const store = fakeStore({ ready: { [issue.id]: issueFingerprint(issue) } });
  const orca = fakeOrca();
  const result = await readyQueueCheck(deps({ linear, store, orca }));
  assert.equal(result.status, 'started');
  assert.deepEqual(orca.calls.terminalsCreated, [{
    environment: 'orchestrator-local',
    worktree: 'path:/srv/orchestrator-svc/julia-next',
    command: 'node /srv/orchestrator-svc/julia-next/scripts/julia-run.mjs JUL-63',
    title: 'ready-queue-JUL-63',
  }]);
});

test('an ineligible top card is commented once, stays quiet while the fingerprint is unchanged, and re-comments after a change', async () => {
  const ineligible = makeIssue({ labels: [DECISION_LABEL] });
  const { linear, calls } = fakeLinear({ issues: [ineligible] });
  const store = fakeStore();
  const orca = fakeOrca();
  const d = deps({ linear, store, orca });

  await readyQueueCheck(d); // first sighting
  const second = await readyQueueCheck(d);
  assert.equal(second.status, 'ineligible');
  assert.equal(second.commented, true);
  assert.equal(calls.comments.length, 1);

  const third = await readyQueueCheck(d);
  assert.equal(third.status, 'ineligible');
  assert.equal(third.commented, false);
  assert.equal(calls.comments.length, 1);
  assert.equal(orca.calls.terminalsCreated.length, 0);

  // The card changed (its coordinate label changed) -> a new fingerprint, so
  // the queue comments again.
  linear.listIssuesInState = async () => [makeIssue({ labels: [PARENT_LABEL] })];
  const fourth = await readyQueueCheck(d);
  assert.equal(fourth.status, 'ineligible');
  assert.equal(fourth.commented, true);
  assert.equal(calls.comments.length, 2);
});

test('ready-queue: a guard-refused comment is skipped and logged; the cycle still completes and the fingerprint is recorded', async () => {
  const ineligible = makeIssue({ labels: [DECISION_LABEL] });
  const { linear, calls } = fakeLinear({ issues: [ineligible] });
  const store = fakeStore();
  const orca = fakeOrca();
  const logs = [];
  const d = deps({
    linear,
    store,
    orca,
    checkForToddGuardImpl: () => ({ ok: false, rule: 'git-vocabulary', reason: 'test refusal' }),
    logErrorImpl: (message) => logs.push(message),
  });

  await readyQueueCheck(d); // first sighting
  const second = await readyQueueCheck(d);
  assert.equal(second.status, 'ineligible');
  assert.equal(second.refused, true);
  assert.equal(second.commented, false);
  assert.equal(calls.comments.length, 0, 'a refused comment must never reach Linear');
  assert.equal(logs.length, 1, 'the refusal is logged once');
  assert.match(logs[0], /git-vocabulary/);
  assert.match(logs[0], /test refusal/);
  // The fingerprint is still recorded, so the queue stays quiet instead of
  // retrying the same refused comment every check.
  assert.equal(store.get().commented[ineligible.id], issueFingerprint(ineligible));
  assert.equal(orca.calls.terminalsCreated.length, 0);

  const third = await readyQueueCheck(d);
  assert.equal(third.status, 'ineligible');
  assert.equal(third.refused, false);
  assert.equal(calls.comments.length, 0);
  assert.equal(logs.length, 1);
});

test('only the top card is ever a candidate; a lower ineligible card cannot block it', async () => {
  const top = makeIssue({ identifier: 'JUL-1', sortOrder: 1 });
  const lower = makeIssue({ identifier: 'JUL-2', sortOrder: 2, labels: [DECISION_LABEL] });
  const { linear } = fakeLinear({ issues: [lower, top] });
  const store = fakeStore({ ready: { [top.id]: issueFingerprint(top), [lower.id]: issueFingerprint(lower) } });
  const orca = fakeOrca();
  const result = await readyQueueCheck(deps({ linear, store, orca }));
  assert.equal(result.status, 'started');
  assert.equal(result.issue, 'JUL-1');
});

// ---------------------------------------------------------------------------
// Real model-choice validation (D2)
// ---------------------------------------------------------------------------

test('a card still carrying the retired GLM label is ineligible, gets one comment saying so, and never starts (JUL-93)', async () => {
  const issue = makeIssue({
    labels: [READY_FOR_AGENT_LABEL, 'builder-glm-5.3', 'reviewer-codex'],
  });
  const { linear } = fakeLinear({ issues: [issue] });
  const store = fakeStore({ ready: { [issue.id]: issueFingerprint(issue) } });
  const orca = fakeOrca();
  const result = await readyQueueCheck(deps({ linear, store, orca }));
  assert.equal(result.status, 'ineligible');
  assert.equal(result.commented, true);
  assert.match(result.reasons.join(' '), /builder carries the retired label builder-glm-5\.3/);
  assert.equal(orca.calls.terminalsCreated.length, 0);
});

test('a same-family builder/reviewer label pair is ineligible, gets one comment with the reason, and never starts', async () => {
  const issue = makeIssue({
    labels: [READY_FOR_AGENT_LABEL, 'builder-claude-opus', 'reviewer-claude-sonnet'],
  });
  const { linear, calls } = fakeLinear({ issues: [issue] });
  const store = fakeStore({ ready: { [issue.id]: issueFingerprint(issue) } });
  const orca = fakeOrca();
  const result = await readyQueueCheck(deps({ linear, store, orca }));
  assert.equal(result.status, 'ineligible');
  assert.equal(result.commented, true);
  assert.match(result.reasons.join(' '), /builder-claude-opus/);
  assert.match(result.reasons.join(' '), /reviewer-claude-sonnet/);
  assert.match(result.reasons.join(' '), /different families/);
  assert.equal(calls.comments.length, 1);
  assert.equal(orca.calls.terminalsCreated.length, 0);
});

test('a differing-family explicit pair is eligible and starts', async () => {
  const issue = makeIssue({
    labels: [READY_FOR_AGENT_LABEL, 'builder-deepseek-flash', 'reviewer-codex'],
  });
  const { linear } = fakeLinear({ issues: [issue] });
  const store = fakeStore({ ready: { [issue.id]: issueFingerprint(issue) } });
  const orca = fakeOrca();
  const result = await readyQueueCheck(deps({ linear, store, orca }));
  assert.equal(result.status, 'started');
  assert.equal(orca.calls.terminalsCreated.length, 1);
});

// ---------------------------------------------------------------------------
// Filling missing labels before start (D3)
// ---------------------------------------------------------------------------

const DEFAULT_TEAM_LABELS = [
  { id: 'l-orch-model', name: 'orch-claude-opus' },
  { id: 'l-orch-effort', name: 'orch-effort-medium' },
  { id: 'l-builder-model', name: 'builder-claude-opus' },
  { id: 'l-builder-effort', name: 'builder-effort-medium' },
  { id: 'l-reviewer-model', name: 'reviewer-codex' },
  { id: 'l-reviewer-effort', name: 'reviewer-effort-medium' },
];

test('missing default model/effort labels are looked up and added before the card starts', async () => {
  const issue = makeIssue({ labels: [READY_FOR_AGENT_LABEL] });
  const { linear, calls } = fakeLinear({ issues: [issue], teamLabels: DEFAULT_TEAM_LABELS });
  const store = fakeStore({ ready: { [issue.id]: issueFingerprint(issue) } });
  const orca = fakeOrca();
  const result = await readyQueueCheck(deps({ linear, store, orca }));
  assert.equal(result.status, 'started');
  assert.deepEqual(calls.labelLookups[0], [
    'orch-claude-opus',
    'orch-effort-medium',
    'builder-claude-opus',
    'builder-effort-medium',
    'reviewer-codex',
    'reviewer-effort-medium',
  ]);
  assert.equal(calls.labelAdds.length, 1);
  assert.equal(calls.labelAdds[0].issueId, issue.id);
  assert.deepEqual([...calls.labelAdds[0].labelIds].sort(), DEFAULT_TEAM_LABELS.map((label) => label.id).sort());
  // The labels were added before the terminal was created.
  assert.equal(orca.calls.terminalsCreated.length, 1);
});

test('a default label that is not on the team yet is skipped and logged, never an error, and the card still starts', async () => {
  const issue = makeIssue({ labels: [READY_FOR_AGENT_LABEL] });
  const { linear, calls } = fakeLinear({
    issues: [issue],
    teamLabels: [{ id: 'l-orch-model', name: 'orch-claude-opus' }],
  });
  const store = fakeStore({ ready: { [issue.id]: issueFingerprint(issue) } });
  const orca = fakeOrca();
  const logs = [];
  const result = await readyQueueCheck(deps({ linear, store, orca, logs }));
  assert.equal(result.status, 'started');
  assert.deepEqual(calls.labelAdds, [{ issueId: issue.id, labelIds: ['l-orch-model'] }]);
  assert.ok(logs.some((line) => /not on team/.test(line)), 'the skipped labels are logged');
  assert.equal(orca.calls.terminalsCreated.length, 1);
});

test('a card that already carries every model/effort label is not looked up again', async () => {
  const issue = makeIssue({
    labels: [
      READY_FOR_AGENT_LABEL,
      'orch-claude-opus', 'orch-effort-medium',
      'builder-claude-opus', 'builder-effort-medium',
      'reviewer-codex', 'reviewer-effort-medium',
    ],
  });
  const { linear, calls } = fakeLinear({ issues: [issue], teamLabels: DEFAULT_TEAM_LABELS });
  const store = fakeStore({ ready: { [issue.id]: issueFingerprint(issue) } });
  const result = await readyQueueCheck(deps({ linear, store, orca: fakeOrca() }));
  assert.equal(result.status, 'started');
  assert.equal(calls.labelLookups.length, 0);
  assert.equal(calls.labelAdds.length, 0);
});

// ---------------------------------------------------------------------------
// Moving the card out of Ready and the restart-after-finish guard (D4)
// ---------------------------------------------------------------------------

test('starting a card moves it out of Ready to the team Implementation state (D4 belt 1)', async () => {
  const issue = makeIssue();
  const { linear, calls } = fakeLinear({ issues: [issue], teamLabels: DEFAULT_TEAM_LABELS });
  const store = fakeStore({ ready: { [issue.id]: issueFingerprint(issue) } });
  const result = await readyQueueCheck(deps({ linear, store, orca: fakeOrca() }));
  assert.equal(result.status, 'started');
  assert.equal(result.stateMoved, true);
  assert.deepEqual(calls.stateMoves, [{ issueId: issue.id, stateId: IN_PROGRESS_STATE.id }]);
});

test('a finished run whose card is still in Ready is never started twice, even when the state move failed (D4 belt 2)', async () => {
  const issue = makeIssue({ identifier: 'JUL-99' });
  const { linear } = fakeLinear({ issues: [issue], teamLabels: DEFAULT_TEAM_LABELS });
  // Reproduce the live failure mode exactly: Linear refuses the state move,
  // so the card stays in Ready while the run finishes.
  linear.setIssueState = async () => { throw new Error('Linear refused the state move'); };
  const store = fakeStore();
  const orca = fakeOrca(); // isRunFinishedImpl is true: the later run has finished
  const logs = [];
  const d = deps({ linear, store, orca, logs });

  assert.equal((await readyQueueCheck(d)).status, 'first-sighting');
  assert.equal((await readyQueueCheck(d)).status, 'started');
  assert.equal(orca.calls.terminalsCreated.length, 1);
  assert.ok(logs.some((line) => /could not move JUL-99 out of Ready/.test(line)));

  // The run is finished and JUL-99 is still in Ready. Every later check must
  // refuse to start it again -- the exact gap this step closes.
  assert.equal((await readyQueueCheck(d)).status, 'cooldown');
  assert.equal((await readyQueueCheck(d)).status, 'cooldown');
  assert.equal(orca.calls.terminalsCreated.length, 1, 'JUL-99 must never start a second time');
});

test('a card that changed after it was started is allowed through the cooldown', async () => {
  let issue = makeIssue({ identifier: 'JUL-99', labels: [READY_FOR_AGENT_LABEL] });
  const { linear } = fakeLinear({ teamLabels: DEFAULT_TEAM_LABELS });
  linear.listIssuesInState = async () => [issue];
  linear.setIssueState = async () => { throw new Error('state move failed on purpose'); };
  const store = fakeStore();
  const orca = fakeOrca();
  const d = deps({ linear, store, orca });

  await readyQueueCheck(d); // first sighting
  assert.equal((await readyQueueCheck(d)).status, 'started');
  assert.equal(orca.calls.terminalsCreated.length, 1);

  // The card changed (a valid differing-family pair was chosen): a new
  // fingerprint, so it is a fresh request -- first sighting, then a start.
  issue = makeIssue({
    identifier: 'JUL-99',
    labels: [READY_FOR_AGENT_LABEL, 'builder-deepseek-flash', 'reviewer-codex'],
  });
  assert.equal((await readyQueueCheck(d)).status, 'first-sighting');
  assert.equal((await readyQueueCheck(d)).status, 'started');
  assert.equal(orca.calls.terminalsCreated.length, 2);
});

test('a card whose state move succeeded and that is deliberately re-queued is admitted and started again', async () => {
  const issue = makeIssue({ identifier: 'JUL-99' });
  const { linear } = fakeLinear({ issues: [issue], teamLabels: DEFAULT_TEAM_LABELS });
  // Belt 1 succeeds, so the card really leaves Ready. `listIssuesInState` keeps
  // returning it, which is exactly a deliberate re-queue: the card was put back
  // in Ready carrying the labels it was started with (the label filler's
  // additions included), unchanged.
  const store = fakeStore();
  const orca = fakeOrca(); // isRunFinishedImpl is true: the run has finished
  const d = deps({ linear, store, orca });

  assert.equal((await readyQueueCheck(d)).status, 'first-sighting');
  assert.equal((await readyQueueCheck(d)).status, 'started');
  assert.equal(orca.calls.terminalsCreated.length, 1);
  assert.equal(store.get().lastStarted.stateMoved, true);

  // The run is finished and someone deliberately moved the card back to Ready.
  // Belt 1 succeeded, so belt 2 must stand down: the re-queue is a fresh
  // request -- first sighting, then a second start.
  assert.equal((await readyQueueCheck(d)).status, 'first-sighting');
  assert.equal((await readyQueueCheck(d)).status, 'started');
  assert.equal(orca.calls.terminalsCreated.length, 2, 'a deliberate re-queue must start the card again');
});

test('lastStarted records whether the state move succeeded', async () => {
  // Failure: the card stayed in Ready, so belt 2 must hold.
  const failedIssue = makeIssue({ identifier: 'JUL-41' });
  const failed = fakeLinear({ issues: [failedIssue], teamLabels: DEFAULT_TEAM_LABELS });
  failed.linear.setIssueState = async () => { throw new Error('Linear refused the state move'); };
  const failedStore = fakeStore();
  const failedDeps = deps({ linear: failed.linear, store: failedStore, orca: fakeOrca() });
  await readyQueueCheck(failedDeps);
  assert.equal((await readyQueueCheck(failedDeps)).status, 'started');
  assert.equal(failedStore.get().lastStarted.stateMoved, false);

  // Success: the card left Ready, so belt 2 must stand down.
  const movedIssue = makeIssue({ identifier: 'JUL-42' });
  const moved = fakeLinear({ issues: [movedIssue], teamLabels: DEFAULT_TEAM_LABELS });
  const movedStore = fakeStore();
  const movedDeps = deps({ linear: moved.linear, store: movedStore, orca: fakeOrca() });
  await readyQueueCheck(movedDeps);
  assert.equal((await readyQueueCheck(movedDeps)).status, 'started');
  assert.equal(movedStore.get().lastStarted.stateMoved, true);
});

// ---------------------------------------------------------------------------
// State file I/O
// ---------------------------------------------------------------------------

test('readState returns an empty state when the file does not exist yet', () => {
  const missing = new Error('no file');
  missing.code = 'ENOENT';
  const state = readState({ statePath: '/state/ready-queue.json', readFileImpl: () => { throw missing; } });
  assert.deepEqual(state, { ready: {}, commented: {}, lastStarted: null });
});

test('readState parses a written state and fills in missing fields', () => {
  const state = readState({
    statePath: '/state/ready-queue.json',
    readFileImpl: () => JSON.stringify({ ready: { a: 'fp' } }),
  });
  assert.deepEqual(state.ready, { a: 'fp' });
  assert.deepEqual(state.commented, {});
  assert.equal(state.lastStarted, null);
});

test('writeState creates the parent directory and writes JSON', () => {
  const calls = [];
  writeState({ ready: {} }, {
    statePath: '/state/julia-next/ready-queue.json',
    mkdirImpl: (dir, opts) => calls.push(['mkdir', dir, opts]),
    writeFileImpl: (path, contents, encoding) => calls.push(['write', path, contents, encoding]),
  });
  assert.deepEqual(calls[0], ['mkdir', '/state/julia-next', { recursive: true }]);
  assert.equal(calls[1][0], 'write');
  assert.equal(calls[1][1], '/state/julia-next/ready-queue.json');
  assert.equal(calls[1][3], 'utf8');
  assert.match(calls[1][2], /"ready": \{\}/);
});

// ---------------------------------------------------------------------------
// Linear access + normalization
// ---------------------------------------------------------------------------

test('resolveLinearApiKey prefers LINEAR_API_KEY from the environment', () => {
  const key = resolveLinearApiKey({
    env: { LINEAR_API_KEY: 'env-key' },
    readSecretImpl: () => { throw new Error('must not read the secret file when the env var is set'); },
  });
  assert.equal(key, 'env-key');
});

test('resolveLinearApiKey falls back to the in-process drop-box reader', () => {
  const key = resolveLinearApiKey({
    env: {},
    readSecretImpl: (field) => {
      assert.equal(field, 'linear');
      return 'dropbox-key';
    },
  });
  assert.equal(key, 'dropbox-key');
});

test('normalizeIssue (live JUL-78 shape): blockers are the `issue` of inverse `blocks` relations, never this card or the cards it blocks', () => {
  // Verified live 2026-09-18: JUL-78 blocks JUL-58, and JUL-54/56/55/57 block
  // JUL-78. There is no `blocked_by` relation type. On JUL-78's own
  // `inverseRelations` each blocking relation is typed `blocks` with the
  // BLOCKER in `issue` and JUL-78 itself in `relatedIssue`.
  const ref = (identifier, name, type) => ({ id: `uuid-${identifier}`, identifier, state: { name, type } });
  const issue = normalizeIssue({
    id: 'uuid-JUL-78',
    identifier: 'JUL-78',
    title: 't',
    sortOrder: 1,
    state: { id: 's', name: 'Ready', type: 'unstarted' },
    labels: { nodes: [{ name: 'ready-for-agent' }] },
    relations: {
      nodes: [
        { type: 'blocks', issue: ref('JUL-78', 'Ready', 'unstarted'), relatedIssue: ref('JUL-58', 'Todo', 'unstarted') },
      ],
    },
    inverseRelations: {
      nodes: [
        { type: 'blocks', issue: ref('JUL-54', 'Done', 'completed'), relatedIssue: ref('JUL-78', 'Ready', 'unstarted') },
        { type: 'blocks', issue: ref('JUL-56', 'In Progress', 'started'), relatedIssue: ref('JUL-78', 'Ready', 'unstarted') },
        { type: 'blocks', issue: ref('JUL-55', 'Done', 'completed'), relatedIssue: ref('JUL-78', 'Ready', 'unstarted') },
        { type: 'blocks', issue: ref('JUL-57', 'Backlog', 'backlog'), relatedIssue: ref('JUL-78', 'Ready', 'unstarted') },
      ],
    },
  });
  assert.deepEqual(issue.blockers.map((b) => b.identifier), ['JUL-54', 'JUL-56', 'JUL-55', 'JUL-57']);
  assert.ok(!issue.blockers.some((b) => b.identifier === 'JUL-78'), 'the card must not count itself as its own blocker');
  assert.ok(!issue.blockers.some((b) => b.identifier === 'JUL-58'), 'a card this card blocks must not count as its blocker');
});

test('normalizeIssue: relations-side `blocks` and non-blocks inverse relations are not blockers', () => {
  const issue = normalizeIssue({
    id: 'i',
    identifier: 'JUL-9',
    title: 't',
    sortOrder: 1,
    state: { id: 's', name: 'Ready', type: 'unstarted' },
    labels: { nodes: [{ name: 'ready-for-agent' }] },
    relations: {
      nodes: [
        { type: 'blocks', issue: { id: 'x', identifier: 'JUL-1' }, relatedIssue: { id: 'b', identifier: 'JUL-8', state: { name: 'Done', type: 'completed' } } },
      ],
    },
    inverseRelations: {
      nodes: [
        { type: 'blocks', issue: { id: 'c', identifier: 'JUL-2', state: { name: 'In Progress', type: 'started' } }, relatedIssue: { id: 'i', identifier: 'JUL-9' } },
        { type: 'related', issue: { id: 'd', identifier: 'JUL-3', state: { name: 'Todo', type: 'unstarted' } }, relatedIssue: { id: 'i', identifier: 'JUL-9' } },
      ],
    },
  });
  assert.deepEqual(issue.labels, ['ready-for-agent']);
  assert.deepEqual(issue.blockers.map((b) => b.identifier), ['JUL-2']);
});

// ---------------------------------------------------------------------------
// CLI argument handling
// ---------------------------------------------------------------------------

test('parseArgs understands --check, --interval-minutes, --state-path and rejects junk', () => {
  assert.deepEqual(parseArgs(['--check']), { check: true, help: false });
  assert.deepEqual(parseArgs(['--check', '--interval-minutes', '7', '--state-path', '/tmp/x.json']), {
    check: true,
    help: false,
    intervalMinutesFlag: '7',
    statePath: '/tmp/x.json',
  });
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
});

test('resolveIntervalMinutes defaults to 5 and honors flag/env, rejecting junk', () => {
  assert.equal(DEFAULT_INTERVAL_MINUTES, 5);
  assert.equal(resolveIntervalMinutes({ env: {} }), 5);
  assert.equal(resolveIntervalMinutes({ flag: '7', env: {} }), 7);
  assert.equal(resolveIntervalMinutes({ env: { READY_QUEUE_INTERVAL_MINUTES: '3' } }), 3);
  assert.throws(() => resolveIntervalMinutes({ flag: 'zero', env: {} }), /positive/);
});
