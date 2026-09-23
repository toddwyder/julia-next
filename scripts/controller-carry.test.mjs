// controller-carry.test.mjs -- JUL-98 step 8: carrying one card on the
// single-command route (graph/controller/main.mjs `carryCard`). The working
// copy belongs to the carry and is removed LAST, after publishing -- the fix
// for the send-back crash of JUL-92 attempt 10 (23 Sep 04:15Z), which removed
// it first and then tried to publish from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { carryCard, BASE_BRANCH, progressCommentBody } from '../graph/controller/main.mjs';
import { checkEvidence, EVIDENCE_MARKER } from './acceptance-check.mjs';

const DESCRIPTION = 'Fix the docs.\n\n**Acceptance criteria:**\n\n- [ ] No reference to the old runbook name remains (test).\n\n## UAT plan\n\n1. **The rename:** the new name.\n';
const card = { id: 'uuid-92', identifier: 'JUL-92', title: 'Docs match', description: DESCRIPTION, labels: [] };
const builderAnswer = {
  outcome: 'done', summary: 'renamed',
  acceptance: [{ id: 'AC1', criterion: 'No reference to the old runbook name remains (test).', evidence: 'git grep: 0 hits' }],
  uat: [{ id: 'UAT1', text: 'It is now server-runbook.md.' }],
};
const reviewerAnswer = { verdict: 'approve', summary: 'ok', criteria: [{ id: 'AC1', criterion: 'No reference to the old runbook name remains (test).', verdict: 'met', how: 'ran git grep myself' }] };
const evidence = { builder: builderAnswer, reviewer: reviewerAnswer, check: checkEvidence({ description: DESCRIPTION, builder: builderAnswer, reviewer: reviewerAnswer }) };

function fixture({ outcome, publishOk = true, removeFails = false, progress = [], liveCard = null } = {}) {
  const order = [];
  const comments = [];
  // The card as Linear holds it: the guard reads it back before the UAT move.
  const live = liveCard ?? { description: DESCRIPTION };
  const edits = [];
  const boundaries = {
    async worktreeCreateImpl(args) { order.push(['worktree-create', args]); return { worktree: { id: 'repo::/w/jul-92-work-a3', path: '/w/jul-92-work-a3' } }; },
    async removeWorktreeImpl(args) { order.push(['worktree-rm', args]); if (removeFails) throw new Error('Failed to delete worktree'); },
  };
  const board = {
    async comment({ body }) { comments.push(body); return { id: `c${comments.length}` }; },
    async updateComment(args) { edits.push(args); return { id: args.commentId }; },
    async moveCard({ to }) { order.push(['move', to]); },
    async readCard() { order.push(['read-card']); return { description: live.description, comments: comments.map((body) => ({ body })) }; },
    async setDescription({ description }) { order.push(['tick']); if (!live.frozen) live.description = description; },
  };
  const publisher = {
    async publishAndMerge(args) {
      order.push(['publish', args]);
      return publishOk
        ? { ok: true, pr: { url: 'https://github.com/x/pull/1' }, merged: { sha: 'abc123' } }
        : { ok: false, reason: 'GitHub refused' };
    },
  };
  const postOnce = async ({ body }) => { comments.push(body); return { posted: true }; };
  const runBuildAndReviewImpl = async (args) => {
    order.push(['build-and-review', { worktreePath: args.worktreePath, branch: args.branch, baseCommit: args.baseCommit, launches: args.launches }]);
    for (const p of progress) await args.onProgress(p);
    return outcome;
  };
  return {
    order, comments, edits, live,
    run: (extra = {}) => carryCard({
      card, attempt: 3, boundaries, board, publisher, comments: { postOnce },
      runBuildAndReviewImpl,
      currentBranchImpl: async (path) => { order.push(['branch', path]); return 'jul-92-work-a3'; },
      readWorktreeStateImpl: async () => ({ known: true, commit: 'base1234567', shortCommit: 'base123', clean: true }),
      now: () => '2026-09-23T06:00:00Z',
      ...extra,
    }),
  };
}

const passed = { ok: true, reason: null, rounds: [{ round: 1, candidate: 'cand1234567', testRun: { pass: 10, fail: 0 }, verdict: 'approve' }], costText: ['- **Builder** -- x', '- **Reviewer** -- y'], testRun: null, evidence };

test('a card that asks for a seat this route does not run is refused BEFORE any working copy is made, and told why', async () => {
  const f = fixture({ outcome: passed });
  const result = await f.run({ card: { ...card, labels: ['adversary-claude-opus'] } });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'seat');
  assert.deepEqual(f.order, [], 'nothing was created');
  assert.match(f.comments[0], /JUL-92: not started\.\*\* the reviewer seat runs only on pi-deepseek/);
});

test('a passing step: working copy from origin/main, build-and-review, PUBLISH FROM THE WORKING COPY, the columns, and only THEN the removal', async () => {
  const f = fixture({ outcome: passed });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.column, 'UAT');
  const names = f.order.map(([name]) => name);
  assert.deepEqual(names.slice(0, 5), ['worktree-create', 'branch', 'build-and-review', 'read-card', 'publish'], 'the live card is re-checked right before publishing');
  assert.equal(names.at(-1), 'worktree-rm', 'the working copy is removed last');
  assert.ok(names.indexOf('publish') < names.indexOf('worktree-rm'), 'publishing always sees the working copy');
  assert.deepEqual(f.order[0][1], { name: 'jul-92-work-a3', baseBranch: BASE_BRANCH });
  assert.equal(BASE_BRANCH, 'origin/main');
  const [, publish] = f.order.find(([name]) => name === 'publish');
  assert.deepEqual({ branch: publish.branch, worktreePath: publish.worktreePath }, { branch: 'jul-92-work-a3', worktreePath: '/w/jul-92-work-a3' });
  const [, built] = f.order.find(([name]) => name === 'build-and-review');
  assert.equal(built.baseCommit, 'base1234567');
  assert.deepEqual({ builder: built.launches.builder.agent, reviewer: built.launches.reviewer.agent }, { builder: 'agy', reviewer: 'pi' }, 'a card with no labels runs the default Gemini builder and DeepSeek reviewer');
  assert.ok(f.comments.some((body) => /Merged as abc123/.test(body) && /round 1: -- built `cand123` -- tests 10 pass \/ 0 fail -- review APPROVE/.test(body)));
});

test('a step that did not pass is never published, says why with its rounds and cost, names the branch, and still removes the working copy', async () => {
  const f = fixture({ outcome: { ok: false, reason: 'the builder (round 1) was stopped as stuck', rounds: [{ round: 1 }], costText: ['- **Builder** -- x'], testRun: null } });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'build-and-review');
  const names = f.order.map(([name]) => name);
  assert.ok(!names.includes('publish'));
  assert.ok(!names.includes('move'));
  assert.equal(names.at(-1), 'worktree-rm');
  const body = f.comments.at(-1);
  assert.match(body, /did not pass\.\*\* the builder \(round 1\) was stopped as stuck/);
  assert.match(body, /\*\*Cost, per worker:\*\*/);
  assert.match(body, /on branch `jul-92-work-a3`/);
});

test('a step parked by the two-round limit says so in its headline, and publishes nothing', async () => {
  const f = fixture({ outcome: { ok: false, parked: true, reason: 'two review rounds used', rounds: [{ round: 1, verdict: 'changes_needed' }, { round: 2, verdict: 'changes_needed' }], costText: [], testRun: null } });
  await f.run();
  assert.match(f.comments.at(-1), /parked after two review rounds/);
  assert.match(f.comments.at(-1), /review CHANGES NEEDED/);
  assert.ok(!f.order.some(([name]) => name === 'publish'));
});

test('the worker\'s progress goes on the card as ONE comment, created once and then edited in place', async () => {
  const f = fixture({
    outcome: passed,
    progress: [
      { seat: 'builder', round: 1, status: { subject: 'writing the test', phase: 'red' }, count: 1 },
      { seat: 'builder', round: 1, status: { subject: 'making it pass', phase: 'green' }, count: 3 },
    ],
  });
  await f.run();
  assert.match(f.comments[0], /now working -- the builder, round 1: writing the test \(red\)/);
  assert.equal(f.edits.length, 2, 'one edit for the second step, one for the finish');
  assert.deepEqual(f.edits.map((edit) => edit.commentId), ['c1', 'c1']);
  assert.match(f.edits[0].body, /making it pass \(green\)/);
  assert.match(f.edits[1].body, /finished working -- the step passed review and tests/);
  assert.match(progressCommentBody({ card, seat: 'reviewer', round: 2, status: { subject: 's', phase: null }, count: 1, at: 'T' }), /1 report so far/);
});

test('a working copy that cannot be removed is said out loud, and does not turn a carried card into a failure', async () => {
  const logs = [];
  const f = fixture({ outcome: passed, removeFails: true });
  const result = await f.run({ log: (line) => logs.push(line) });
  assert.equal(result.ok, true);
  assert.ok(logs.some((line) => /could not remove the working copy \/w\/jul-92-work-a3: Failed to delete worktree/.test(line)));
});

test('the progress comment ends on "finished", never left saying "now working" about a step that has ended', async () => {
  const f = fixture({ outcome: { ok: false, parked: true, reason: 'two rounds', rounds: [], costText: [], testRun: null }, progress: [{ seat: 'builder', round: 1, status: { subject: 'building', phase: null }, count: 1 }] });
  await f.run();
  assert.equal(f.edits.length, 1);
  assert.match(f.edits[0].body, /JUL-92: finished working -- the step parked after two review rounds/);
});

test('the controller\'s OWN fault mid-step still ends in a comment on the card, and the working copy is still removed', async () => {
  const f = fixture({ outcome: passed });
  const result = await f.run({ runBuildAndReviewImpl: async () => { throw new Error('boom'); } });
  assert.equal(result.ok, false);
  assert.match(f.comments.at(-1), /did not pass\.\*\* the controller itself failed mid-step: boom/);
  assert.equal(f.order.at(-1)[0], 'worktree-rm');
  assert.ok(!f.order.some(([name]) => name === 'publish'));
});

test('a base branch that is not a plain ref name is refused before anything is created', async () => {
  for (const bad of ['--upload-pack=x', '-b', 'main..evil', '', 'a b']) {
    const f = fixture({ outcome: passed });
    await assert.rejects(() => f.run({ baseBranch: bad }), /refusing base branch/);
    assert.deepEqual(f.order, []);
  }
  const ok = fixture({ outcome: passed });
  await ok.run({ baseBranch: 'jul98-step-8b' });
  assert.equal(ok.order[0][1].baseBranch, 'jul98-step-8b');
});

// ---------------------------------------------------------------------------
// The acceptance check on the card (Todd, 23 Sep: JUL-92 reached UAT with none
// of the evidence its UAT plan promised)
// ---------------------------------------------------------------------------

test('before UAT: the evidence is posted item by item, the criteria boxes are ticked, and the LIVE card is read back before the move', async () => {
  const f = fixture({ outcome: passed });
  const result = await f.run();
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.column, 'UAT');
  const posted = f.comments.find((body) => body.includes(EVIDENCE_MARKER));
  assert.ok(posted, 'the evidence comment is on the card');
  assert.match(posted, /\*\*UAT1\. The rename\*\*\n\nIt is now server-runbook\.md\./);
  assert.match(posted, /AC1: No reference to the old runbook name remains \(test\)\.\*\*\n  - Evidence \(builder\): git grep: 0 hits\n  - Checked \(reviewer\): met -- ran git grep myself/);
  assert.match(f.live.description, /- \[x\] No reference to the old runbook name remains/);
  const names = f.order.map(([name]) => name);
  assert.ok(names.indexOf('tick') < names.lastIndexOf('read-card'), 'ticked, then read back');
  assert.ok(names.lastIndexOf('read-card') < names.lastIndexOf('move'), 'read back before the last move');
});

test('THE GUARD: a live card with a box still open is NOT moved to UAT, and the card says why', async () => {
  const f = fixture({ outcome: passed, liveCard: { description: DESCRIPTION, frozen: true } });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'acceptance-guard');
  assert.notEqual(result.column, 'UAT');
  assert.ok(!f.order.some(([name, to]) => name === 'move' && to === 'UAT'), 'never moved to UAT');
  assert.ok(f.comments.some((body) => /not moved to UAT: the acceptance check on the card refused it -- AC1 \("No reference to the old runbook name remains \(test\)\."\) is not ticked/.test(body)));
});

test('THE GUARD: a passed step that carries no evidence is NOT moved to UAT', async () => {
  const f = fixture({ outcome: { ...passed, evidence: undefined } });
  const result = await f.run();
  assert.equal(result.stage, 'acceptance-guard');
  assert.match(result.reason, /passed without the acceptance check's evidence/);
  assert.ok(!f.order.some(([name, to]) => name === 'move' && to === 'UAT'));
});


test('finding 6: a criterion added to the card during the carry stops the MERGE, not only the UAT move', async () => {
  const f = fixture({ outcome: passed, liveCard: { description: DESCRIPTION.replace('- [ ] No reference', '- [ ] A new criterion added mid-carry.\n- [ ] No reference') } });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'acceptance');
  assert.ok(!f.order.some(([name]) => name === 'publish'), 'nothing was published');
  assert.ok(f.comments.some((body) => /not merged: the acceptance check on the card as it is now refused it/.test(body)));
});
