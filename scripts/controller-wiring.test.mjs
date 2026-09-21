// controller-wiring.test.mjs -- JUL-98 step 4, Task D. What the real
// implementations actually SEND, and what they refuse.
//
// WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT. They prove the argv: which
// Orca command each injected boundary becomes, which flags it carries, and how
// its answer is read. They prove NOTHING about the live services -- the tests
// run as `runner`, which cannot read the controller's Linear credentials by
// design, so no Linear call, no Orca call, no GitHub call is made here. That
// the real `orca` accepts these exact flags, and that the real Linear accepts
// the app on these mutations, is only provable when the coordinator runs the
// controller for real. Round 1 of step 2 was rejected for letting green tests
// imply more than they showed; this header is the limit, stated up front.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createOrcaBoundaries,
  createRequestLedger,
  createSeatCostReader,
  createPublisher,
  claudeProjectDirName,
  worktreePathOf,
  REPO_SELECTOR,
} from '../graph/controller/wiring.mjs';
import { proveTurnStarted } from '../graph/controller/turn-start.mjs';
import { loadOrcaFixture } from '../graph/controller/fixture-orca.mjs';

// A recorder standing where the `orca` binary does. It NEVER spawns anything.
function recorder(answers = []) {
  const calls = [];
  let index = 0;
  const impl = async (args) => {
    calls.push(args);
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    return typeof answer === 'function' ? answer(args) : (answer ?? {});
  };
  impl.calls = calls;
  return impl;
}

const flag = (args, name) => {
  const at = args.indexOf(name);
  return at < 0 ? null : args[at + 1];
};

test('run-create is one orca command carrying the environment, the sender terminal and the card as the objective', async () => {
  const orcaCallImpl = recorder([loadOrcaFixture('run-create.ok.json').result]);
  const boundaries = createOrcaBoundaries({ orcaCallImpl });
  await boundaries.runCreateImpl({ from: 'term_a', objective: 'JUL-98', requestId: 'JUL-98:run' });
  const [args] = orcaCallImpl.calls;
  assert.deepEqual(args.slice(0, 2), ['orchestration', 'run-create']);
  assert.equal(flag(args, '--environment'), 'orchestrator-local');
  assert.equal(flag(args, '--from'), 'term_a');
  assert.equal(flag(args, '--objective'), 'JUL-98');
  assert.ok(args.includes('--json'));
  // Nothing to retry yet: Orca issues the request id, so the first call cannot
  // name one.
  assert.equal(args.includes('--retry-request'), false);
});

test('a repeated action replays through Orca: the SECOND call carries --retry-request with the id Orca itself issued', async () => {
  // This is the whole width-1 guarantee. graph/fixtures/orca-1.4.205's own
  // README records the recipe: run-create, then the same command with
  // `--retry-request <id from the first answer>` -> replayed: true, no second
  // run.
  const ok = loadOrcaFixture('run-create.ok.json').result;
  const replayed = loadOrcaFixture('run-create.replayed.json').result;
  const orcaCallImpl = recorder([ok, replayed]);
  const boundaries = createOrcaBoundaries({ orcaCallImpl });

  await boundaries.runCreateImpl({ from: 'term_a', objective: 'JUL-98', requestId: 'JUL-98:run' });
  const second = await boundaries.runCreateImpl({ from: 'term_a', objective: 'JUL-98', requestId: 'JUL-98:run' });

  assert.equal(flag(orcaCallImpl.calls[1], '--retry-request'), ok.mutation.requestId);
  assert.equal(second.mutation.replayed, true);
  assert.equal(second.run.id, ok.run.id, 'the same run, not a second one');
});

test('the ledger survives a restart as plain JSON, so a controller killed mid-action replays rather than starting a second worker', () => {
  const first = createRequestLedger();
  first.record('JUL-98:run', { mutation: { requestId: 'req-1' } });
  const carried = JSON.parse(JSON.stringify(first.entries()));
  const afterRestart = createRequestLedger(carried);
  assert.deepEqual(afterRestart.flagsFor('JUL-98:run'), ['--retry-request', 'req-1']);
  assert.deepEqual(afterRestart.flagsFor('JUL-98:other'), []);
});

test('worker-start asks Orca for a FRESH worktree and never adopts a terminal', async () => {
  const orcaCallImpl = recorder([loadOrcaFixture('worker-start.claude-model-effort.json').result]);
  const boundaries = createOrcaBoundaries({ orcaCallImpl });
  await boundaries.workerStartImpl({
    run: 'run_1', from: 'term_a', spec: 'the brief', worktree: 'new-top-level',
    name: 'jul-98-work', agent: 'claude', model: 'claude-opus-5', effort: 'high', requestId: 'k',
  });
  const [args] = orcaCallImpl.calls;
  assert.deepEqual(args.slice(0, 2), ['orchestration', 'worker-start']);
  assert.equal(flag(args, '--worktree'), 'new-top-level');
  assert.equal(args.includes('--terminal'), false, 'adopting a terminal is exactly what a fresh worker must not do');
  assert.equal(flag(args, '--repo'), REPO_SELECTOR);
  assert.equal(flag(args, '--agent'), 'claude');
  assert.equal(flag(args, '--model'), 'claude-opus-5');
  assert.equal(flag(args, '--effort'), 'high');
  assert.equal(flag(args, '--setup'), 'skip');
});

test('--effort is never sent without --model, which worker-start --help refuses', async () => {
  const orcaCallImpl = recorder([{}]);
  const boundaries = createOrcaBoundaries({ orcaCallImpl });
  await boundaries.workerStartImpl({ run: 'r', from: 't', spec: 's', worktree: 'new-top-level', name: 'n', agent: 'codex', effort: 'high' });
  const [args] = orcaCallImpl.calls;
  assert.equal(args.includes('--model'), false);
  assert.equal(args.includes('--effort'), false);
});

// The recorded worktree row (agents[].state === "working"), in the envelope
// `orca worktree ps --json` really answers -- shape confirmed live 2026-09-21:
// { worktrees: [...], hostScope, totalCount, truncated }, each row keyed
// `worktreeId`.
const workingRow = loadOrcaFixture('worktree-ps.agent-working.json').worktree;
const psAnswer = (rows, extra = {}) => ({ worktrees: rows, totalCount: rows.length, truncated: false, ...extra });

test('turn-start proof comes from worktree ps, matched on worktreeId, and a worktree Orca does not list proves nothing', async () => {
  const orcaCallImpl = recorder([psAnswer([workingRow])]);
  const boundaries = createOrcaBoundaries({ orcaCallImpl });
  const observed = await boundaries.observeStartImpl({ dispatch: { worktree: workingRow.worktreeId } });
  assert.deepEqual(orcaCallImpl.calls[0].slice(0, 2), ['worktree', 'ps']);
  assert.equal(proveTurnStarted(observed).started, true, 'the recorded working agent must prove a turn began');

  const missing = createOrcaBoundaries({ orcaCallImpl: recorder([psAnswer([workingRow])]) });
  const nothing = await missing.observeStartImpl({ dispatch: { worktree: 'repo-9::/nowhere' } });
  assert.equal(proveTurnStarted(nothing).started, false, 'a worktree Orca never listed is never an assumed start');
});

test('an absent row on a TRUNCATED page is an error, not "no turn started" -- a healthy worker must never be released as never-started because the page was full', async () => {
  const boundaries = createOrcaBoundaries({
    orcaCallImpl: recorder([psAnswer([workingRow], { truncated: true, totalCount: 500 })]),
  });
  await assert.rejects(
    () => boundaries.observeStartImpl({ dispatch: { worktree: 'repo-9::/elsewhere' } }),
    /truncated page/,
  );
});

test('the mailbox wait is Orca blocking, with the types, the timeout and the previous batch acknowledged', async () => {
  const orcaCallImpl = recorder([{ messages: [], timedOut: true, deliveryId: null }]);
  const boundaries = createOrcaBoundaries({ orcaCallImpl });
  await boundaries.checkWaitImpl({ terminal: 'term_a', runId: 'run_1', timeoutMs: 90000, ack: 'del_1' });
  const [args] = orcaCallImpl.calls;
  assert.deepEqual(args.slice(0, 2), ['orchestration', 'check']);
  assert.ok(args.includes('--wait'), 'the controller sleeps in Orca, it never polls');
  assert.equal(flag(args, '--timeout-ms'), '90000');
  assert.equal(flag(args, '--types'), 'status,heartbeat,escalation,worker_done');
  assert.equal(flag(args, '--ack'), 'del_1');
  assert.equal(flag(args, '--run'), 'run_1');
});

test('release and worktree removal are the two Orca cleanup verbs, by dispatch and by worktree id', async () => {
  const orcaCallImpl = recorder([{}]);
  const boundaries = createOrcaBoundaries({ orcaCallImpl });
  await boundaries.releaseImpl({ dispatchId: 'disp_1' });
  await boundaries.removeWorktreeImpl({ worktree: 'repo-1::/home/runner/w' });
  assert.deepEqual(orcaCallImpl.calls[0].slice(0, 3), ['orchestration', 'worker-release', '--dispatch']);
  assert.equal(flag(orcaCallImpl.calls[0], '--dispatch'), 'disp_1');
  assert.deepEqual(orcaCallImpl.calls[1].slice(0, 2), ['worktree', 'rm']);
  assert.equal(flag(orcaCallImpl.calls[1], '--worktree'), 'id:repo-1::/home/runner/w');
});

test('a dispatch with no worktree removes nothing rather than sending a selector of "id:undefined"', async () => {
  const orcaCallImpl = recorder([{}]);
  const boundaries = createOrcaBoundaries({ orcaCallImpl });
  const result = await boundaries.removeWorktreeImpl({ worktree: null });
  assert.equal(result.removed, false);
  assert.equal(orcaCallImpl.calls.length, 0);
});

test('width 1 is Orca run-list, and the controller is told WHICH card is in flight', async () => {
  const boundaries = createOrcaBoundaries({
    orcaCallImpl: recorder([{}]),
    findActiveRunImpl: async ({ environment }) => ({ id: 'run_9', objective: 'JUL-42', environment }),
  });
  const active = await boundaries.activeRunImpl();
  assert.equal(active.objective, 'JUL-42');
  assert.equal(active.environment, 'orchestrator-local');
});

// ---------------------------------------------------------------------------
// The cost read
// ---------------------------------------------------------------------------

test("a Claude seat's cost is read from the transcript of its OWN worktree, newest session file", async () => {
  const home = mkdtempSync(join(tmpdir(), 'controller-cost-'));
  try {
    const worktree = 'repo-1::/home/runner/w/jul-98';
    const dir = join(home, '.claude', 'projects', claudeProjectDirName('/home/runner/w/jul-98'));
    mkdirSync(dir, { recursive: true });
    const line = (id, output, ts) => JSON.stringify({
      type: 'assistant', timestamp: ts,
      message: { id, model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } },
    });
    writeFileSync(join(dir, 'old.jsonl'), `${line('m1', 5, '2026-09-21T10:00:00.000Z')}\n`);
    writeFileSync(join(dir, 'new.jsonl'), [
      line('m2', 50, '2026-09-21T14:00:00.000Z'),
      line('m3', 60, '2026-09-21T14:05:00.000Z'),
    ].join('\n'));
    // Make "new" unambiguously newer than "old".
    const { utimesSync } = await import('node:fs');
    utimesSync(join(dir, 'old.jsonl'), new Date('2026-09-21T10:00:00Z'), new Date('2026-09-21T10:00:00Z'));

    const read = createSeatCostReader({ homedir: home });
    const cost = await read({ seat: 'builder', worktree, agent: 'claude' });
    assert.equal(cost.seat, 'builder');
    assert.equal(cost.model, 'claude-opus-5');
    assert.equal(cost.totalTokens, 2 * (100 + 10) + 110, 'both messages of the newest transcript, each counted once');
    assert.ok(cost.minutes > 0, 'the transcript timestamps give the duration');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a seat whose session file is missing REFUSES rather than returning a blank cost line', async () => {
  const home = mkdtempSync(join(tmpdir(), 'controller-cost-'));
  try {
    const read = createSeatCostReader({ homedir: home });
    await assert.rejects(
      () => read({ seat: 'builder', worktree: 'repo-1::/home/runner/w/gone', agent: 'claude' }),
      /no Claude transcript/,
    );
    await assert.rejects(
      () => read({ seat: 'reviewer', worktree: 'repo-1::/home/runner/w/gone', agent: 'codex' }),
      /no Codex rollout/,
    );
    // A vendor with no known source is refused too: a guessed figure is worse
    // than a refusal, and release.mjs leaves the worktree in place for it.
    await assert.rejects(
      () => read({ seat: 'reviewer', worktree: 'x', agent: 'pi' }),
      /refusing to guess a figure/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an Orca worktree id is split on "::" so the cost reader looks in the PATH, not the repo id', () => {
  assert.equal(worktreePathOf('repo-1::/home/runner/w'), '/home/runner/w');
  assert.equal(worktreePathOf('/home/runner/w'), '/home/runner/w');
  assert.equal(claudeProjectDirName('/home/runner/w/jul-98'), '-home-runner-w-jul-98');
});

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

test('publishing refuses up front when the App key never loaded, and starts nothing', async () => {
  const calls = [];
  const publisher = createPublisher({
    env: {},
    pushBranchImpl: async () => calls.push('push'),
    openPullRequestImpl: async () => calls.push('pr'),
    mergePullRequestImpl: async () => calls.push('merge'),
  });
  assert.deepEqual(publisher.missingCredentials(), ['JULIA_PUBLISHER_APP_ID', 'JULIA_PUBLISHER_APP_PRIVATE_KEY']);
  const result = await publisher.publishAndMerge({ branch: 'b', worktreePath: '/w', title: 't', body: 'b' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /JULIA_PUBLISHER_APP_ID/);
  assert.deepEqual(calls, [], 'nothing was pushed with no credential to push with');
});

test('publishing pushes, opens the PR, then merges pinned to the sha that was reviewed', async () => {
  const seen = {};
  const publisher = createPublisher({
    env: { JULIA_PUBLISHER_APP_ID: '1', JULIA_PUBLISHER_APP_PRIVATE_KEY: 'k' },
    pushBranchImpl: async (options) => { seen.push = options; },
    openPullRequestImpl: async (options) => { seen.pr = options; return { number: 77, url: 'https://github.com/x/y/pull/77' }; },
    mergePullRequestImpl: async (options) => { seen.merge = options; return { merged: true, sha: options.expectedHeadSha }; },
    headShaImpl: async () => 'a'.repeat(40),
  });
  const result = await publisher.publishAndMerge({ branch: 'jul-98-work', worktreePath: '/w', title: 'T', body: 'B' });
  assert.equal(result.ok, true);
  assert.equal(seen.push.owner, 'toddwyder');
  assert.equal(seen.push.repo, 'julia-next');
  assert.equal(seen.pr.base, 'main');
  assert.equal(seen.pr.head, 'jul-98-work');
  assert.equal(seen.merge.number, 77);
  assert.equal(seen.merge.expectedHeadSha, 'a'.repeat(40), 'the merge is pinned to the reviewed head commit');
});

test('a merge GitHub did not perform is reported as a failure, never smoothed into a success', async () => {
  const publisher = createPublisher({
    env: { JULIA_PUBLISHER_APP_ID: '1', JULIA_PUBLISHER_APP_PRIVATE_KEY: 'k' },
    pushBranchImpl: async () => {},
    openPullRequestImpl: async () => ({ number: 1, url: 'u' }),
    mergePullRequestImpl: async () => ({ merged: false, message: 'Head branch was modified' }),
    headShaImpl: async () => 'b'.repeat(40),
  });
  const result = await publisher.publishAndMerge({ branch: 'b', worktreePath: '/w', title: 't', body: 'b' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Head branch was modified');
});
