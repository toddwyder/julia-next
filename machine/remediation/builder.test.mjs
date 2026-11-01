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

function userTurn(text) {
  return JSON.stringify({ format: 2, parts: [{ type: 'text', text }] });
}

function assistantTurn(text) {
  return JSON.stringify({ format: 2, parts: [{ type: 'text', text }] });
}

// The store as the runner sees it: two tables, rows of strings, and a record of
// every query so a test can say what was read and what was left alone.
function fakeStore({ threads, messages }) {
  const asked = [];
  return {
    asked,
    client: {
      execute: async query => {
        const sql = typeof query === 'string' ? query : query.sql;
        const args = typeof query === 'string' ? [] : (query.args ?? []);
        asked.push({ sql, args });
        if (/from mastra_threads/.test(sql)) {
          const [project] = args;
          const wanted = Buffer.from(project).toString('utf8');
          const mine = threads.filter(thread => thread.metadata.includes(wanted));
          return { rows: [...mine].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) };
        }
        if (/from mastra_messages/.test(sql)) {
          const [threadId, like] = args;
          const needle = String(like).replaceAll('%', '').toLowerCase();
          const rows = (messages[threadId] ?? [])
            .filter(message => message.type === 'user')
            .filter(message => message.content.toLowerCase().includes(needle));
          return { rows };
        }
        return { rows: [] };
      },
    },
  };
}

// The store keeps this column encoded; for these tests it is enough that the
// project's name is in it and that a thread from another project is not.
function threadRow(id, title, updatedAt, projectPath = ROOT) {
  return { id, title, updatedAt, metadata: JSON.stringify(projectPath === null ? {} : { projectPath }) };
}

test('the builder thread is the newest one in this project whose user turn names the card', async () => {
  const store = fakeStore({
    threads: [
      threadRow('old-jul-307', 'JUL-307 build', '2026-10-31T10:00:00.000Z'),
      threadRow('new-jul-307', '', '2026-11-01T06:50:00.000Z'),
      threadRow('another-card', '', '2026-11-01T07:00:00.000Z'),
      threadRow('other-project', 'JUL-307 elsewhere', '2026-11-01T08:00:00.000Z', '/tmp/spike/work'),
      threadRow('no-metadata', 'JUL-307 without a project', '2026-11-01T09:00:00.000Z', null),
    ],
    messages: {
      'new-jul-307': [{ type: 'user', content: userTurn('Read the poteto-mode skill and build JUL-307.') }],
      'other-project': [{ type: 'user', content: userTurn('Do JUL-307 in the spike.') }],
    },
  });

  const found = await findBuilderThread({ client: store.client, repoRoot: ROOT, card: 'JUL-307' });
  assert.deepEqual(found, { threadId: 'new-jul-307', title: '', updatedAt: '2026-11-01T06:50:00.000Z' });

  const read = store.asked.filter(query => /from mastra_messages/.test(query.sql)).map(query => query.args[0]);
  assert.ok(!read.includes('other-project'), 'a thread from another project is never looked at');
  assert.ok(!read.includes('no-metadata'), 'a thread with no project is never looked at');
  assert.ok(!read.includes('old-jul-307'), 'a thread whose title names the card is not read');
});

test('a card number inside a branch name still finds the thread, and a longer number does not', async () => {
  const store = fakeStore({
    threads: [
      threadRow('longer', '', '2026-11-01T00:00:00.000Z'),
      threadRow('branch', '', '2026-11-01T00:00:00.000Z'),
    ],
    messages: {
      longer: [{ type: 'user', content: userTurn('JUL-3070 is a different card') }],
      branch: [{ type: 'user', content: userTurn('carry on, we are on jul-307/remediation-loop') }],
    },
  });

  const found = await findBuilderThread({ client: store.client, repoRoot: ROOT, card: 'JUL-307' });
  assert.equal(found.threadId, 'branch');
});

test('an agent talking about the card does not make its thread the builder', async () => {
  const store = fakeStore({
    threads: [threadRow('reviewer', '', '2026-11-01T00:00:00.000Z')],
    messages: {
      reviewer: [{ type: 'assistant', content: assistantTurn('I reviewed JUL-307 and it fails.') }],
    },
  });
  assert.equal(await findBuilderThread({ client: store.client, repoRoot: ROOT, card: 'JUL-307' }), null);
});

test('a title that names the card is enough, without reading the thread at all', async () => {
  const store = fakeStore({
    threads: [threadRow('titled', 'Ship JUL-307', '2026-11-01T00:00:00.000Z')],
    messages: {},
  });
  const found = await findBuilderThread({ client: store.client, repoRoot: ROOT, card: 'JUL-307' });
  assert.equal(found.threadId, 'titled');
  assert.deepEqual(store.asked.filter(query => /from mastra_messages/.test(query.sql)), []);
});

test('no thread naming the card means no builder to go back to', async () => {
  const store = fakeStore({
    threads: [threadRow('other', '', '2026-11-01T00:00:00.000Z')],
    messages: { other: [{ type: 'user', content: userTurn('Something else entirely.') }] },
  });
  assert.equal(await findBuilderThread({ client: store.client, repoRoot: ROOT, card: 'JUL-307' }), null);
});

test('threads are read newest first, because the newest is the one a boot would take', async () => {
  const store = fakeStore({ threads: [threadRow('any', '', '2026-11-01T00:00:00.000Z')], messages: {} });
  const found = await findBuilderThread({ client: store.client, repoRoot: ROOT, card: 'JUL-999' });
  assert.equal(found, null);
  assert.match(store.asked[0].sql, /order by updatedAt desc/);
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
    checkout: '/tmp/practice/checkout',
    determination: 'VERDICT: FAIL',
    playbookText: 'Bug fix text.',
    criteria: ['the loading state appears', 'the error is written down'],
  });

  assert.match(order, /fresh builder/i);
  assert.match(order, /# JUL-307|# Remediation: a FAIL goes back to the builder/);
  assert.match(order, /1\. the loading state appears/);
  assert.match(order, /2\. the error is written down/);
  assert.match(order, /VERDICT: FAIL/);
  // The fresh builder changes the pull request checkout, not the repository the
  // other sessions are working in.
  assert.match(order, /checked out at \/tmp\/practice\/checkout/);
  assert.match(order, /git push origin HEAD:refs\/heads\/<branch>/);
  assert.doesNotMatch(order, /gh pr checkout/);
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
