// The loop's behaviour, driven with fake agents: what a PASS does, what one
// FAIL does, and what two FAILs do. No model, no network, no pull request.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadMastra } from '../shipping/harness.mjs';
import { MAX_REVIEWS, createRemediationWorkflow, shouldInvestigate, shouldRemediate, shouldReview } from './workflow.mjs';

const CARD = {
  identifier: 'JUL-999',
  title: 'Practice card for the remediation loop',
  url: 'https://linear.app/julia-next/issue/JUL-999',
  description: [
    '# Practice card for the remediation loop',
    '',
    '## Acceptance criteria',
    '',
    '- the dashboard shows the loading state while it waits',
    '- an error is written down where Todd can read it',
  ].join('\n'),
};

const FAIL_ANSWER = [
  'VERDICT: FAIL',
  'CRITERION 1: FAIL — the loading state never appeared when I opened the page',
  'CRITERION 2: PASS — the error text was in the console',
  'NOTES: one criterion is missing from the change.',
].join('\n');

const PASS_ANSWER = [
  'VERDICT: PASS',
  'CRITERION 1: PASS — the loading state appeared for 400ms',
  'CRITERION 2: PASS — the error text was in the console',
  'NOTES: both criteria seen on screen.',
].join('\n');

function verdictOf(answer) {
  const verdict = /VERDICT:\s*(\S+)/.exec(answer)[1];
  const criteria = [...answer.matchAll(/CRITERION (\d+): (PASS|FAIL) — (.+)/g)].map(match => ({
    number: Number(match[1]),
    verdict: match[2],
    reason: match[3],
  }));
  return { verdict, criteria, notes: '', raw: answer };
}

function fakeDeps({ answers }) {
  const calls = { rounds: [], handed: [], fresh: [], investigations: [], posts: [], pings: [], saved: [] };
  let checkouts = 0;
  const deps = {
    root: '/tmp/practice/repo',
    runDir: '/tmp/practice/run',
    mayPost: true,
    builderModel: 'fake-builder-model',
    getIssue: async identifier => ({ ...CARD, identifier }),
    readPlaybook: relative => `the text of ${relative}`,
    reviewRound: async ({ record, round }) => {
      const answer = answers[round - 1] ?? FAIL_ANSWER;
      const verdict = verdictOf(answer);
      calls.rounds.push({ round, sha: record.head, builderAlreadyRan: calls.handed.length });
      return {
        modelId: 'fake-review-model',
        verdict: verdict.verdict,
        answer,
        failed:
          verdict.verdict === 'FAIL'
            ? verdict.criteria
                .filter(item => item.verdict === 'FAIL')
                .map(item => ({ number: item.number, criterion: record.criteria[item.number - 1] ?? null, reason: item.reason }))
            : [],
        determination: `/tmp/practice/run/determination-${round}.md`,
        postedUrl: `https://example.test/pull/1#comment-${round}`,
        traceFile: null,
      };
    },
    handToBuilder: async material => {
      calls.handed.push(material);
      return { threadId: 'thread-of-the-builder', resumed: true };
    },
    startFreshBuilder: async material => {
      calls.fresh.push(material);
      return { threadId: 'thread-of-a-fresh-builder', resumed: false };
    },
    investigate: async material => {
      calls.investigations.push(material);
      return {
        threadId: 'thread-of-the-investigation',
        answer: 'Cause in the work: the page never mounted.\nCause in the process: nothing ran the page.\nROOT CAUSE: Shipping is the first thing that opens the page.',
      };
    },
    prepareCheckout: async () => {
      checkouts += 1;
      return 'commit-after-the-fix';
    },
    postCardComment: async note => {
      calls.posts.push(note);
      return 'https://linear.app/julia-next/issue/JUL-999#comment';
    },
    ping: async ({ message, record }) => {
      calls.pings.push({ message, stop: record.stop });
      return { posted: true, comment: 'https://linear.app/julia-next/issue/JUL-999#stop' };
    },
    saveRecord: async record => {
      calls.saved.push(record);
    },
  };
  return { deps, calls };
}

async function runLoop(answers, deps = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-loop-'));
  const { Mastra, LibSQLStore } = await loadMastra();
  const mastra = new Mastra({
    storage: new LibSQLStore({ id: `remediation-test-${path.basename(dir)}`, url: `file:${path.join(dir, 'state.db')}` }),
    logger: false,
  });
  const fakes = deps ?? fakeDeps({ answers });
  const { workflow } = await createRemediationWorkflow({ mastra, deps: fakes.deps, log: () => {} });
  const run = await workflow.createRun();
  const started = await run.start({
    inputData: {
      pr: 42,
      card: 'JUL-999',
      sha: 'commit-shipping-judged',
      checkout: '/tmp/practice/checkout',
      reviews: [],
      builder: null,
    },
  });
  return { started, calls: fakes.calls };
}

test('a first review that passes ends the loop without waking the builder', async () => {
  const { started, calls } = await runLoop([PASS_ANSWER]);
  assert.equal(started.status, 'success', started.error);
  const record = started.result;
  assert.equal(record.reviews.length, 1);
  assert.equal(record.reviews[0].verdict, 'PASS');
  assert.equal(record.builder, null);
  assert.equal(record.stop, null);
  assert.equal(calls.handed.length, 0);
  assert.equal(calls.investigations.length, 0);
  assert.equal(calls.pings.length, 0);
  assert.equal(calls.rounds.length, 1);
});

test('one FAIL hands that determination to the builder and a fresh review passes the fix', async () => {
  const { started, calls } = await runLoop([FAIL_ANSWER, PASS_ANSWER]);
  assert.equal(started.status, 'success', started.error);
  const record = started.result;

  assert.deepEqual(
    calls.rounds.map(round => round.round),
    [1, 2]
  );
  assert.equal(calls.handed.length, 1, 'the builder is woken exactly once');
  assert.equal(calls.rounds[1].builderAlreadyRan, 1, 'the second review starts after the builder ran');

  const order = calls.handed[0];
  assert.equal(order.sha, 'commit-shipping-judged', 'the builder is told which commit Shipping judged');
  assert.match(order.determination, /the loading state never appeared when I opened the page/);
  assert.match(order.playbookText, /bug-fix\.md/);
  assert.equal(order.card.identifier, 'JUL-999');

  assert.equal(record.reviews.length, 2);
  assert.deepEqual(
    record.reviews.map(review => review.verdict),
    ['FAIL', 'PASS']
  );
  assert.equal(record.reviews[0].postedUrl, 'https://example.test/pull/1#comment-1');
  assert.equal(record.reviews[1].postedUrl, 'https://example.test/pull/1#comment-2');
  assert.equal(record.head, 'commit-after-the-fix', 'the fixed head is what the second review judged');
  assert.equal(record.builder.resumed, true);
  assert.equal(record.stop, null);
  assert.equal(calls.investigations.length, 0);
  assert.equal(calls.pings.length, 0);
  assert.equal(calls.posts.length, 0, 'a found session needs no note on the card');
});

test('two FAILs in a row run the investigation once and stop with a ping that names the pull request and the root cause', async () => {
  const { started, calls } = await runLoop([FAIL_ANSWER, FAIL_ANSWER]);
  assert.equal(started.status, 'success', started.error);
  const record = started.result;

  assert.deepEqual(
    calls.rounds.map(round => round.round),
    [1, 2]
  );
  assert.equal(calls.investigations.length, 1, 'the investigation runs once');
  const investigation = calls.investigations[0];
  assert.equal(investigation.mayPost, true);
  assert.equal(investigation.determinations.length, 2);
  assert.match(investigation.determinations[1].answer, /VERDICT: FAIL/);
  assert.match(investigation.playbookText, /investigation\.md/);

  assert.ok(record.stop, 'the loop records a stop');
  assert.match(record.stop.reason, /JUL-999/);
  assert.match(record.stop.reason, /criterion 1: the loading state never appeared/);
  assert.equal(record.stop.rootCause, 'Shipping is the first thing that opens the page.');
  assert.equal(record.stop.threadId, 'thread-of-the-investigation');

  assert.equal(calls.pings.length, 1, 'Todd is pinged once');
  const ping = calls.pings[0];
  assert.match(ping.message, /https:\/\/github\.com\/toddwyder\/julia-next\/pull\/42/);
  assert.match(ping.message, /Root cause: Shipping is the first thing that opens the page\./);
  assert.match(ping.message, /Review 1 on commit-shipping-judged: FAIL/);
  assert.equal(record.stop.ping.posted, true);
});

test('a FAIL when the builder session is gone starts a fresh builder and says so on the card', async () => {
  const fakes = fakeDeps({ answers: [FAIL_ANSWER, PASS_ANSWER] });
  fakes.deps.handToBuilder = async () => null;
  const { started, calls } = await runLoop(null, fakes);
  assert.equal(started.status, 'success', started.error);
  const record = started.result;

  assert.equal(calls.handed.length, 0);
  assert.equal(calls.fresh.length, 1);
  assert.equal(record.builder.resumed, false);
  assert.equal(record.builder.threadId, 'thread-of-a-fresh-builder');
  assert.equal(calls.posts.length, 1, 'the card is told a fresh builder was started');
  assert.equal(calls.posts[0].card, 'JUL-999');
  assert.match(calls.posts[0].body, /could not be taken/);
  assert.match(calls.posts[0].body, /thread-of-a-fresh-builder/);
  assert.equal(record.reviews.length, 2);
});

test('a review that comes back with no verdict stops the loop instead of failing the card', async () => {
  const fakes = fakeDeps({ answers: [FAIL_ANSWER, PASS_ANSWER] });
  // The free reviewer answers with a provider error now and then: it has not
  // judged anything, so the builder must not be handed the error to fix.
  fakes.deps.reviewRound = async ({ round }) => {
    fakes.calls.rounds.push({ round });
    return {
      modelId: 'fake-review-model',
      verdict: null,
      answer: `Subagent "Execute" failed: {"error":{"message":"Missing required parameter: 'messages[48].reasoning_content'"}}`,
      failed: [],
      determination: '/tmp/practice/run/determination-1.md',
      postedUrl: 'https://example.test/pull/1#comment-1',
      traceFile: null,
    };
  };

  const { started, calls } = await runLoop(null, fakes);
  assert.equal(started.status, 'success', started.error);
  const record = started.result;

  assert.equal(record.reviews.length, 1, 'the loop does not go on to a second review');
  assert.equal(record.reviews[0].verdict, null);
  assert.equal(calls.handed.length, 0, 'the builder is not woken with an error');
  assert.equal(calls.fresh.length, 0);
  assert.equal(calls.investigations.length, 0, 'a missing verdict is not two failed reviews');

  assert.ok(record.stop, 'the loop records a stop');
  assert.match(record.stop.reason, /could not answer/);
  assert.match(record.stop.reason, /JUL-999/);
  assert.match(record.stop.rootCause, /reasoning_content/);
  assert.equal(calls.pings.length, 1, 'Todd is told the machine could not get an answer');
  assert.match(calls.pings[0].message, /could not answer/);
});

test('the review limit lives in one constant and the chain asks for at most that many reviews', async () => {
  assert.equal(MAX_REVIEWS, 2);
  const empty = { reviews: [] };
  assert.equal(shouldReview(empty, 1), true);
  assert.equal(shouldReview(empty, 2), false, 'the second review waits for the first');
  assert.equal(shouldReview({ reviews: [{ verdict: 'FAIL' }] }, 2), true);
  assert.equal(shouldReview({ reviews: [{ verdict: 'PASS' }] }, 2), false, 'a pass ends the loop');
  assert.equal(shouldReview({ reviews: [{ verdict: 'PASS+NOTES' }] }, 2), false);
  assert.equal(shouldReview({ reviews: [{ verdict: 'FAIL' }, { verdict: 'FAIL' }] }, 3), false);
  assert.equal(shouldRemediate({ reviews: [{ verdict: 'FAIL' }] }), true);
  assert.equal(shouldRemediate({ reviews: [{ verdict: 'PASS' }] }), false);
  assert.equal(shouldRemediate({ reviews: [{ verdict: 'FAIL' }, { verdict: 'FAIL' }] }), false, 'no third round');
  assert.equal(shouldInvestigate({ reviews: [{ verdict: 'FAIL' }, { verdict: 'FAIL' }] }), true);
  assert.equal(shouldInvestigate({ reviews: [{ verdict: 'FAIL' }, { verdict: 'PASS' }] }), false);
  assert.equal(shouldInvestigate({ reviews: [{ verdict: 'FAIL' }] }), false);
});

test('the record is saved as each step finishes, so a crash keeps the rounds that already posted', async () => {
  const { calls } = await runLoop([FAIL_ANSWER, PASS_ANSWER]);
  assert.ok(calls.saved.length >= 3, `expected a save per step, saw ${calls.saved.length}`);
  const last = calls.saved[calls.saved.length - 1];
  assert.deepEqual(
    last.reviews.map(review => review.verdict),
    ['FAIL', 'PASS']
  );
});
