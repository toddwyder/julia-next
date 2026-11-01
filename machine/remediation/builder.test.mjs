// Finding the thread that built a card, and the words that go into it.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findBuilderThread,
  freshBuilderOrder,
  investigationOrder,
  remediationOrder,
  rootCauseFrom,
} from './builder.mjs';

const ROOT = '/home/ubuntu/julia-builder';
const CARD = { identifier: 'JUL-307', title: 'Remediation: a FAIL goes back to the builder', description: 'The outcome.' };

function textMessage(text, { type = 'user', role = 'signal' } = {}) {
  return { role, type, content: { format: 2, parts: [{ type: 'text', text }] } };
}

function fakeSession({ threads, messages }) {
  const asked = [];
  return {
    asked,
    thread: {
      list: async () => threads,
      listMessages: async ({ threadId, limit }) => {
        asked.push({ threadId, limit });
        return messages[threadId] ?? [];
      },
    },
  };
}

test('the builder thread is the newest one in this project whose user turn names the card', async () => {
  const session = fakeSession({
    threads: [
      { id: 'old-jul-307', title: 'JUL-307 build', updatedAt: '2026-10-31T10:00:00.000Z', metadata: { projectPath: ROOT } },
      { id: 'new-jul-307', title: 'JUL-307 remediation loop', updatedAt: '2026-11-01T06:50:00.000Z', metadata: { projectPath: ROOT } },
      { id: 'another-card', title: 'JUL-300 closeout', updatedAt: '2026-11-01T07:00:00.000Z', metadata: { projectPath: ROOT } },
      { id: 'other-project', title: 'JUL-307 elsewhere', updatedAt: '2026-11-01T08:00:00.000Z', metadata: { projectPath: '/tmp/spike/work' } },
      { id: 'no-metadata', title: 'JUL-307 without a project', updatedAt: '2026-11-01T09:00:00.000Z' },
    ],
    messages: {
      'old-jul-307': [textMessage('Build JUL-307 as a task.')],
      'new-jul-307': [textMessage('Read the poteto-mode skill and build JUL-307.')],
      'another-card': [textMessage('Close out JUL-300 slice 1.')],
      'other-project': [textMessage('Do JUL-307 in the spike.')],
    },
  });

  const found = await findBuilderThread({ session, repoRoot: ROOT, card: 'JUL-307' });
  assert.deepEqual(found, { threadId: 'new-jul-307', title: 'JUL-307 remediation loop', updatedAt: '2026-11-01T06:50:00.000Z' });
  assert.deepEqual(session.asked, [{ threadId: 'another-card', limit: 500 }], 'only a thread whose title says nothing is read, and only in this project');
});

test('a card number inside a branch name still finds the thread, and a longer number does not', async () => {
  const session = fakeSession({
    threads: [
      { id: 'branch', title: '', updatedAt: '2026-11-01T00:00:00.000Z', metadata: { projectPath: ROOT } },
      { id: 'longer', title: '', updatedAt: '2026-11-02T00:00:00.000Z', metadata: { projectPath: ROOT } },
    ],
    messages: {
      branch: [textMessage('carry on, we are on jul-307/remediation-loop')],
      longer: [textMessage('JUL-3070 is a different card')],
    },
  });

  const found = await findBuilderThread({ session, repoRoot: ROOT, card: 'JUL-307' });
  assert.equal(found.threadId, 'branch');
});

test('an agent talking about the card does not make its thread the builder', async () => {
  const session = fakeSession({
    threads: [{ id: 'reviewer', title: '', updatedAt: '2026-11-01T00:00:00.000Z', metadata: { projectPath: ROOT } }],
    messages: {
      reviewer: [{ role: 'assistant', type: 'assistant', content: { format: 2, parts: [{ type: 'text', text: 'I reviewed JUL-307 and it fails.' }] } }],
    },
  });
  assert.equal(await findBuilderThread({ session, repoRoot: ROOT, card: 'JUL-307' }), null);
});

test('a title that names the card is enough, without reading the thread at all', async () => {
  const session = fakeSession({
    threads: [{ id: 'titled', title: 'Ship JUL-307', updatedAt: '2026-11-01T00:00:00.000Z', metadata: { projectPath: ROOT } }],
    messages: {},
  });
  const found = await findBuilderThread({ session, repoRoot: ROOT, card: 'JUL-307' });
  assert.equal(found.threadId, 'titled');
  assert.deepEqual(session.asked, []);
});

test('no thread naming the card means no builder to go back to', async () => {
  const session = fakeSession({
    threads: [{ id: 'other', title: '', updatedAt: '2026-11-01T00:00:00.000Z', metadata: { projectPath: ROOT } }],
    messages: { other: [textMessage('Something else entirely.')] },
  });
  assert.equal(await findBuilderThread({ session, repoRoot: ROOT, card: 'JUL-307' }), null);
});

test('the remediation order quotes the FAIL, names the playbook, and stops before the review', () => {
  const order = remediationOrder({
    card: CARD,
    pr: 42,
    sha: 'abc123',
    determination: 'VERDICT: FAIL\nCRITERION 1: FAIL — the loading state never appeared',
    playbookText: 'Bug fix: reproduce, then fix.',
    playbook: '.agents/skills/poteto-mode/playbooks/bug-fix.md',
  });

  assert.match(order, /https:\/\/github\.com\/toddwyder\/julia-next\/pull\/42/);
  assert.match(order, /JUL-307 Remediation: a FAIL goes back to the builder/);
  assert.match(order, /abc123/);
  assert.match(order, /CRITERION 1: FAIL — the loading state never appeared/);
  assert.match(order, /\.agents\/skills\/poteto-mode\/playbooks\/bug-fix\.md/);
  assert.match(order, /Bug fix: reproduce, then fix\./);
  assert.match(order, /Push the fix to the branch/);
  assert.match(order, /do not start the Shipping agent/i);
});

test('a fresh builder is given the card, its criteria and the same determination', () => {
  const order = freshBuilderOrder({
    card: CARD,
    pr: 42,
    sha: 'abc123',
    determination: 'VERDICT: FAIL',
    playbookText: 'Bug fix text.',
    criteria: ['the loading state appears', 'the error is written down'],
  });

  assert.match(order, /fresh builder/i);
  assert.match(order, /# JUL-307|# Remediation: a FAIL goes back to the builder/);
  assert.match(order, /1\. the loading state appears/);
  assert.match(order, /2\. the error is written down/);
  assert.match(order, /VERDICT: FAIL/);
});

test('the investigation is told both determinations, both causes, and what not to touch', () => {
  const order = investigationOrder({
    card: CARD,
    pr: 42,
    determinations: [
      { round: 1, sha: 'aaa', answer: 'VERDICT: FAIL first time' },
      { round: 2, sha: 'bbb', answer: 'VERDICT: FAIL second time' },
    ],
    playbookText: 'Investigation: read-only.',
  });

  assert.match(order, /Review 1 on commit aaa/);
  assert.match(order, /VERDICT: FAIL second time/);
  assert.match(order, /Investigation: read-only\./);
  assert.match(order, /cause in the work/);
  assert.match(order, /cause in the process/);
  assert.match(order, /node scripts\/linear-cli\.mjs comment JUL-307 --file/);
  assert.match(order, /ROOT CAUSE: /);
  assert.match(order, /Do not fix anything/);
});

test('an investigation asked not to post says so plainly', () => {
  const order = investigationOrder({
    card: CARD,
    pr: 42,
    determinations: [{ round: 1, sha: 'aaa', answer: 'VERDICT: FAIL' }],
    playbookText: 'Investigation text.',
    mayPost: false,
  });
  assert.match(order, /Post nothing/);
  assert.doesNotMatch(order, /linear-cli\.mjs comment/);
});

test('the root cause is the marked line when the session marked one', () => {
  const answer = 'Overview of what happened.\n\nRoot cause: nobody opened the page before shipping.\n';
  assert.equal(rootCauseFrom(answer), 'nobody opened the page before shipping.');
  assert.equal(rootCauseFrom('only one paragraph, no marker'), 'only one paragraph, no marker');
  assert.equal(rootCauseFrom(''), '');
  assert.equal(rootCauseFrom(null), '');
});
