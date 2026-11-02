// The merge machine's steps, driven with a fake forge, a fake tracker and a fake
// retro. No model, no network, no pull request. The real point of these rounds
// is the order: nothing lands without a fresh PASS, the card is only completed
// after main CI is green on the merge commit, and a rerun continues instead of
// merging twice.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadMastra, missingProgram } from '../shipping/harness.mjs';
import { createMergeWorkflow } from './workflow.mjs';

const programGap = missingProgram();
const withoutProgram = programGap ? { skip: `${programGap}, so the merge machine runs on the server instead` } : {};

const HEAD = 'a1b2c3d4e5f6a7b8c9d0';
const MERGE = 'f00dfeed1234567890ab';
const CARD = {
  identifier: 'JUL-999',
  title: 'Practice card for the merge machine',
  description: '# Practice\n\n## Acceptance criteria\n\n- the dashboard shows a count',
  url: 'https://linear.app/julia-next/issue/JUL-999',
};

function determination({ verdict = 'PASS', sha = HEAD, round = 1, of = 2, url = 'https://example.test/pull/42#comment-1' } = {}) {
  return {
    body: [
      `Shipping agent: ${verdict} (review ${round} of ${of})`,
      '',
      `**Card** ${CARD.identifier} · **Pull request** #42 · **Commit** \`${sha}\``,
      '',
      '| what | value |',
      '| --- | --- |',
      '| model | fake-model |',
      '',
      '### Criterion 1',
      'PASS — the count appeared.',
      '',
      `<!-- written by the shipping workflow run ${round} -->`,
    ].join('\n'),
    url,
    createdAt: '2026-11-01T10:00:00Z',
  };
}

function openPull() {
  return {
    number: 42,
    title: CARD.title,
    state: 'OPEN',
    draft: false,
    base: 'main',
    head: 'feat/jul-999-practice',
    headSha: HEAD,
    mergeCommit: null,
    mergedAt: null,
    url: 'https://example.test/pull/42',
    createdAt: '2026-11-01T09:00:00Z',
    author: 'julia',
  };
}

function mergedPull() {
  return { ...openPull(), state: 'MERGED', mergeCommit: MERGE, mergedAt: '2026-11-01T11:00:00Z' };
}

function fakeDeps({ comments = [determination()] } = {}) {
  const order = [];
  const gitCalls = [];
  const deps = {
    runId: 'run-1',
    modelId: 'fake-model',
    getIssue: async () => {
      order.push('getIssue');
      return CARD;
    },
    readPull: () => {
      order.push('readPull');
      return openPull();
    },
    readComments: () => {
      order.push('readComments');
      return comments;
    },
    changedFiles: () => {
      order.push('changedFiles');
      return ['app/practice/page.jsx', 'machine/merge/gate.test.mjs'];
    },
    firstCommitAt: () => {
      order.push('firstCommitAt');
      return { at: '2026-11-01T09:30:00Z', from: 'the pull request’s first commit' };
    },
    merge: ({ pr, head }) => {
      order.push(`merge #${pr} at ${head}`);
      return MERGE;
    },
    deleteBranch: ({ ref }) => {
      order.push(`deleteBranch ${ref}`);
      return true;
    },
    waitMerged: async () => {
      order.push('waitMerged');
      return mergedPull();
    },
    prepareMain: ({ sha }) => {
      order.push(`prepareMain ${sha}`);
      return deps.checkout;
    },
    waitChecks: async ({ pr }) => {
      order.push(`waitChecks #${pr}`);
      return { green: true, checks: [{ name: 'checks', state: 'SUCCESS' }], failed: [], reason: `the checks on pull request #${pr} are green` };
    },
    waitCi: async ({ sha }) => {
      order.push(`waitCi ${sha}`);
      return { green: true, reason: `main CI is green on ${sha}.`, runs: [{ name: 'checks', conclusion: 'success' }] };
    },
    git: (args, options = {}) => {
      gitCalls.push({ args, cwd: options.cwd ?? null });
      if (args[0] === 'status') return 'A  docs/scorecards/JUL-999.landing.json';
      if (args[0] === 'rev-parse') return '0123456789abcdef';
      return '';
    },
    saveRecord: async record => {
      order.push('saveRecord');
      deps.saved = record;
    },
    retro: async material => {
      order.push('retro');
      const file = path.join(material.checkout, material.retroPath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `# ${material.card}\n\n## Findings\n\n1. Nothing went wrong.\n`);
      return { ok: true, reason: 'written', file, answer: `RETRO: written ${material.retroPath}` };
    },
    sweep: async () => {
      order.push('sweep');
      return { summary: '1 leftover to remove, 0 kept, 0 for the noticed list.', removed: [], errors: [], noticed: [] };
    },
    cardComments: async () => {
      order.push('cardComments');
      return [];
    },
    alreadyCompleted: () => false,
    completeCard: async ({ card, comment }) => {
      order.push(`completeCard ${card}`);
      deps.comment = comment;
      return { posted: 'https://linear.app/julia-next/issue/JUL-999#comment', state: 'completed', url: 'https://linear.app/julia-next/issue/JUL-999#comment' };
    },
  };
  return { deps, order, gitCalls };
}

async function runMerge(deps, { resume = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-machine-'));
  const checkout = path.join(dir, 'main');
  fs.mkdirSync(checkout, { recursive: true });
  deps.checkout = checkout;
  const { Mastra, LibSQLStore } = await loadMastra();
  const mastra = new Mastra({
    storage: new LibSQLStore({ id: `merge-test-${path.basename(dir)}`, url: `file:${path.join(dir, 'state.db')}` }),
    logger: false,
  });
  const { workflow } = await createMergeWorkflow({ mastra, deps, log: () => {} });
  const run = await workflow.createRun();
  const started = await run.start({ inputData: { pr: 42, card: CARD.identifier, resume } });
  return { started, checkout, dir };
}

test('a passing change lands, is recorded, retros, sweeps and completes the card, in that order', withoutProgram, async () => {
  const { deps, order, gitCalls } = fakeDeps();
  const { started, checkout, dir } = await runMerge(deps);
  try {
    assert.equal(started.status, 'success', started.error);
    const record = started.result;
    assert.equal(record.merge.commit, MERGE);
    assert.equal(record.pull.base, 'main');
    assert.equal(record.ci.green, true);
    assert.equal(record.metrics.reviews.rounds, 1);
    assert.deepEqual(record.metrics.reviews.verdicts, ['PASS']);
    assert.equal(record.metrics.duration.human, '1h 30m');
    assert.equal(record.retro.ok, true);
    assert.equal(record.retro.file, 'docs/retros/jul-999.md');
    assert.equal(record.sweep.summary, '1 leftover to remove, 0 kept, 0 for the noticed list.');
    assert.equal(record.completion.state, 'completed');
    assert.equal(record.stop, null);

    const landing = path.join(checkout, 'docs/scorecards/JUL-999.landing.json');
    assert.equal(fs.existsSync(landing), true);
    const written = JSON.parse(fs.readFileSync(landing, 'utf8'));
    assert.equal(written.mergeCommit, MERGE);
    assert.equal(written.startedFrom, 'the pull request’s first commit');
    assert.equal(fs.existsSync(path.join(checkout, 'docs/retros/jul-999.md')), true);

    assert.match(deps.comment, /Merged JUL-999: Practice card for the merge machine/);
    assert.match(deps.comment, /Took \*\*1h 30m\*\*/);
    assert.match(deps.comment, /1 Shipping round: PASS/);
    assert.doesNotMatch(deps.comment, /For Todd:/);

    assert.deepEqual(order.filter(step => step !== 'saveRecord'), [
      'getIssue',
      'readPull',
      'readComments',
      'changedFiles',
      'waitChecks #42',
      'merge #42 at a1b2c3d4e5f6a7b8c9d0',
      'waitMerged',
      'deleteBranch feat/jul-999-practice',
      `prepareMain ${MERGE}`,
      `waitCi ${MERGE}`,
      'firstCommitAt',
      'readComments',
      'retro',
      'sweep',
      'cardComments',
      'completeCard JUL-999',
    ]);

    const pushes = gitCalls.filter(call => call.args[0] === 'push');
    assert.equal(pushes.length, 2, 'the landing record and the retro each go to main');
    assert.deepEqual(pushes.map(call => call.args.at(-1)), ['HEAD:main', 'HEAD:main']);
    assert.ok(gitCalls.every(call => call.cwd === checkout || call.cwd === null));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a change whose newest verdict is a FAIL is never merged', withoutProgram, async () => {
  const { deps, order } = fakeDeps({ comments: [determination({ verdict: 'FAIL', round: 2, of: 2 })] });
  const { started, dir } = await runMerge(deps);
  try {
    assert.equal(started.status, 'failed');
    assert.match(started.error.message, /not merging, because the newest determination on pull request #42 says FAIL/);
    assert.equal(order.some(step => step.startsWith('merge')), false);
    assert.equal(order.includes('waitCi'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a PASS that judged an older commit does not let a moved branch land', withoutProgram, async () => {
  const { deps, order } = fakeDeps({ comments: [determination({ sha: 'bbbbbbb' })] });
  const { started, dir } = await runMerge(deps);
  try {
    assert.equal(started.status, 'failed');
    assert.match(started.error.message, /the newest determination judged bbbbbbb, but the pull request head is a1b2c3d4e5f6a7b8c9d0/);
    assert.equal(order.some(step => step.startsWith('merge')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a rerun continues from the saved record instead of merging a second time', withoutProgram, async () => {
  const saved = {
    pr: 42,
    card: { identifier: CARD.identifier, title: CARD.title, description: CARD.description, url: CARD.url },
    merge: { commit: MERGE, mergedAt: '2026-11-01T11:00:00Z', url: 'https://example.test/pull/42', checkout: '/tmp/practice/main' },
    ci: { green: true, reason: `main CI is green on ${MERGE}.`, runs: [] },
    metrics: { duration: { human: '1h 30m' }, reviews: { rounds: 1, verdicts: ['PASS'] } },
    retro: { ok: true, reason: 'written', file: 'docs/retros/jul-999.md' },
    sweep: { summary: 'nothing left to sweep.' },
    completion: { state: 'completed' },
  };
  const { deps, order } = fakeDeps();
  const { started, dir } = await runMerge(deps, { resume: saved });
  try {
    assert.equal(started.status, 'success', started.error);
    assert.equal(started.result.merge.commit, MERGE);
    assert.equal(started.result.retro.ok, true);
    assert.deepEqual(order.filter(step => step !== 'saveRecord'), [
      'getIssue',
      'readPull',
      'readComments',
      'changedFiles',
      'deleteBranch feat/jul-999-practice',
      `prepareMain ${MERGE}`,
    ]);
    assert.equal(order.some(step => step.startsWith('merge ')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('red main CI leaves the card in progress and asks the retro for a reflection', withoutProgram, async () => {
  const { deps, order } = fakeDeps();
  deps.waitCi = async ({ sha }) => {
    order.push(`waitCi ${sha}`);
    return { green: false, reason: 'main CI failed on feedface: web failure', runs: [] };
  };
  const { started, dir } = await runMerge(deps);
  try {
    assert.equal(started.status, 'success', started.error);
    const record = started.result;
    assert.equal(record.stop.reason, 'main CI failed on feedface: web failure');
    assert.equal(record.failed, 'main CI failed on feedface: web failure');
    assert.equal(record.retro.ok, true);
    assert.equal(record.completion, null);
    assert.equal(order.some(step => step === 'completeCard JUL-999'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing check on the pull request stops the machine before it merges', withoutProgram, async () => {
  const { deps, order } = fakeDeps();
  deps.waitChecks = async ({ pr }) => {
    order.push(`waitChecks #${pr}`);
    return {
      green: false,
      checks: [{ name: 'repository-hygiene', state: 'FAILURE' }],
      failed: [{ name: 'repository-hygiene', state: 'FAILURE' }],
      reason: 'pull request #42 has a failing check: repository-hygiene FAILURE',
    };
  };
  const { started, dir } = await runMerge(deps);
  try {
    assert.equal(started.status, 'success', started.error);
    const record = started.result;
    assert.equal(record.merge, null);
    assert.equal(record.stop.reason, 'pull request #42 has a failing check: repository-hygiene FAILURE');
    assert.deepEqual(record.checks.failed, ['repository-hygiene FAILURE']);
    assert.equal(order.some(step => step.startsWith('merge ')), false);
    assert.equal(order.some(step => step === 'completeCard JUL-999'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
