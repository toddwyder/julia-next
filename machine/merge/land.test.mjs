import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  alreadyCompleted,
  assertLandable,
  checkRollup,
  publishDocs,
  completeCard,
  completionComment,
  deleteRemoteBranch,
  gh,
  mainRunsFor,
  mergePullRequest,
  waitForMainCi,
  waitForMerged,
  waitForPullChecks,
} from './land.mjs';

const noSleep = async () => {};

const PULL = {
  number: 420,
  title: 'Merge and cleanup',
  state: 'OPEN',
  draft: false,
  base: 'main',
  head: 'feat/jul-310-merge',
  headSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  mergeCommit: null,
  url: 'https://github.com/julia/next/pull/420',
  createdAt: '2026-11-01T08:00:00Z',
};

const PASS = { pass: true, verdict: 'PASS', head: PULL.headSha, rounds: 1, verdicts: ['PASS'], commentUrl: 'https://github.com/julia/next/pull/420#issuecomment-1' };

test('the answer gh prints is read even when a terminal colours it', () => {
  const printed = '\u001b[1m{"state":"MERGED"}\u001b[0m\n';
  const seen = [];
  const answer = gh(['pr', 'view', '42', '--json', 'state'], {
    execImpl: (file, args, options) => { seen.push([file, args, options.env]); return printed; },
    env: { FORCE_COLOR: '1' },
  });
  assert.deepEqual(JSON.parse(answer), { state: 'MERGED' });
  assert.equal(seen[0][2].FORCE_COLOR, '0', 'the child is asked for no colour');
  assert.equal(seen[0][2].NO_COLOR, '1');
});

test('a change is not merged when the pull request or the verdict says it should not be', () => {
  assert.equal(assertLandable({ pull: PULL, decision: PASS }), true);

  assert.throws(
    () => assertLandable({ pull: { ...PULL, state: 'CLOSED', draft: true, base: 'release' }, decision: { pass: false, reason: 'the newest Shipping verdict is FAIL' } }),
    error => {
      assert.match(error.message, /the pull request is CLOSED/);
      assert.match(error.message, /the pull request is a draft/);
      assert.match(error.message, /based on release, not main/);
      assert.match(error.message, /newest Shipping verdict is FAIL/);
      return true;
    }
  );
});

test('the merge names the commit Shipping judged, so a moved branch is refused by the forge', () => {
  const seen = [];
  mergePullRequest({
    pr: 420,
    head: PULL.headSha,
    execImpl: (file, args) => {
      seen.push([file, ...args]);
      return '';
    },
  });
  assert.deepEqual(seen[0], ['gh', 'pr', 'merge', '420', '--squash', '--match-head-commit', PULL.headSha]);
});

test('the merge is believed only when the pull request reports MERGED with a commit', async () => {
  let reads = 0;
  const merged = await waitForMerged({
    pr: 420,
    sleep: noSleep,
    read: () => {
      reads += 1;
      return reads < 2 ? { state: 'OPEN', mergeCommit: null } : { state: 'MERGED', mergeCommit: 'feedface' };
    },
  });
  assert.equal(merged.mergeCommit, 'feedface');

  await assert.rejects(
    waitForMerged({ pr: 420, tries: 2, sleep: noSleep, read: () => ({ state: 'OPEN', mergeCommit: null }) }),
    /did not report MERGED; its last state was OPEN/
  );
});

test('main CI counts only the runs on main, and any failure conclusion is red', () => {
  const runs = mainRunsFor('feedface', {
    execImpl: () =>
      JSON.stringify([
        { name: 'ci', status: 'completed', conclusion: 'success', headBranch: 'main' },
        { name: 'preview', status: 'completed', conclusion: 'success', headBranch: 'feat/other' },
      ]),
  });
  assert.deepEqual(runs.map(run => run.name), ['ci']);
});

test('the machine waits for every main run, then reads green or red', async () => {
  const green = await waitForMainCi({
    sha: 'feedface',
    sleep: noSleep,
    list: () => [{ name: 'ci', status: 'completed', conclusion: 'success' }],
  });
  assert.equal(green.green, true);
  assert.match(green.reason, /green on feedface/);

  const red = await waitForMainCi({
    sha: 'feedface',
    sleep: noSleep,
    list: () => [
      { name: 'ci', status: 'completed', conclusion: 'success' },
      { name: 'web', status: 'completed', conclusion: 'failure' },
      { name: 'checks', status: 'completed', conclusion: 'cancelled' },
    ],
  });
  assert.equal(red.green, false);
  assert.deepEqual(red.failed.map(run => run.name), ['web', 'checks']);
  assert.match(red.reason, /main CI failed on feedface: web failure, checks cancelled/);

  let calls = 0;
  const late = await waitForMainCi({
    sha: 'feedface',
    tries: 3,
    waitMs: 1000,
    sleep: noSleep,
    list: () => {
      calls += 1;
      return [{ name: 'ci', status: 'in_progress', conclusion: null }];
    },
  });
  assert.equal(calls, 3);
  assert.equal(late.green, false);
  assert.match(late.reason, /did not finish within 0 minutes/);
});

test('the card comment names the change, the verdict and the two numbers', () => {
  const comment = completionComment({
    card: 'JUL-310',
    title: 'Merge and cleanup',
    pr: 420,
    mergeCommit: 'feedface',
    decision: PASS,
    mergeUrl: PULL.url,
    record: {
      card: 'JUL-310',
      mergedAt: '2026-11-02T09:30:00Z',
      startedAt: '2026-11-01T08:00:00Z',
      duration: { minutes: 1530, human: '1d 1h 30m' },
      reviews: { rounds: 2, verdicts: ['FAIL', 'PASS'] },
      landingUrl: 'https://github.com/julia/next/blob/main/docs/scorecards/JUL-310.landing.json',
    },
  });
  assert.match(comment, /^Merged JUL-310: Merge and cleanup/);
  assert.match(comment, /Commit `feedface` is on main/);
  assert.match(comment, /Shipping said PASS on `a1b2c3d/);
  assert.match(comment, /Took \*\*1d 1h 30m\*\*/);
  assert.match(comment, /2 Shipping rounds: FAIL -> PASS/);
  assert.match(comment, /docs\/scorecards\/JUL-310\.landing\.json/);
  assert.match(comment, /The card is Complete because the merge commit is on main/);
  assert.doesNotMatch(comment, /For Todd:/);
});

test('a card that already carries the merge comment is not commented twice', () => {
  assert.equal(alreadyCompleted([{ body: 'Merged JUL-310: Merge and cleanup\n- Commit `feedface`' }], { card: 'JUL-310', mergeCommit: 'feedface' }), true);
  assert.equal(alreadyCompleted([{ body: 'Merged JUL-310: Merge and cleanup\n- Commit `feedface`' }], { card: 'JUL-310', mergeCommit: 'deadbeef' }), false);
  assert.equal(alreadyCompleted([{ body: 'Merged JUL-311: something else\n- Commit `feedface`' }], { card: 'JUL-310', mergeCommit: 'feedface' }), false);
  assert.equal(alreadyCompleted([], { card: 'JUL-310', mergeCommit: 'feedface' }), false);
});

test('the card is Complete only when Linear reads it back that way', async () => {
  const calls = [];
  const result = await completeCard({
    card: 'JUL-310',
    comment: 'Merged JUL-310',
    mayPost: true,
    postComment: async (card, body) => {
      calls.push(['comment', card, body]);
      return { url: 'https://linear.app/comment/1' };
    },
    setIssueState: async (card, state) => calls.push(['state', card, state]),
    getIssue: async card => {
      calls.push(['read', card]);
      return { state: { name: 'Complete', type: 'completed' } };
    },
    keep: () => '/never',
  });
  assert.deepEqual(result, { posted: 'https://linear.app/comment/1', state: 'Complete', keptAt: null });
  assert.deepEqual(calls.map(call => call[0]), ['comment', 'state', 'read']);

  await assert.rejects(
    completeCard({
      card: 'JUL-310',
      comment: 'Merged JUL-310',
      mayPost: true,
      postComment: async () => ({ url: 'x' }),
      setIssueState: async () => {},
      getIssue: async () => ({ state: { name: 'In Progress', type: 'started' } }),
      keep: () => '/never',
    }),
    /was set to Complete but Linear returned state In Progress \(started\)/
  );
});

test('with posting off the note is kept on disk instead of written to the card', async () => {
  const result = await completeCard({
    card: 'JUL-310',
    comment: 'Merged JUL-310',
    mayPost: false,
    keep: body => `/run/card-note.md (${body.length} bytes)`,
    postComment: async () => assert.fail('must not post'),
    setIssueState: async () => assert.fail('must not move the card'),
    getIssue: async () => assert.fail('must not read the card'),
  });
  assert.deepEqual(result, { posted: null, state: null, keptAt: '/run/card-note.md (14 bytes)' });
});

test('the record is published as a pull request the machine watches and merges', async () => {
  const gitCalls = [];
  const forgeCalls = [];
  const pr = {
    number: 501,
    state: 'MERGED',
    base: 'main',
    head: 'docs/jul-310-landing',
    mergeCommit: 'beef1234',
    mergedAt: '2026-11-02T03:00:00Z',
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
  const checkout = path.join(dir, 'main');
  const retro = path.join(checkout, 'docs/retros/jul-310.md');
  fs.mkdirSync(path.dirname(retro), { recursive: true });
  fs.writeFileSync(retro, '# What JUL-310 taught\n');
  const git = (args, options = {}) => {
    gitCalls.push({ args, cwd: options.cwd });
    if (args[0] === 'status') return 'A docs/retros/jul-310.md';
    if (args[0] === 'rev-parse') return 'abc1234';
    return '';
  };
  const published = await publishDocs({
    checkout,
    branch: 'docs/jul-310-landing',
    title: 'Record how JUL-310 went (JUL-310)',
    body: 'No card: the machine recording a merged card.',
    bodyPath: '/repo/.artifacts/merge/pr-417/publish-body.md',
    files: [retro],
    git,
    forge: {
      openPr: () => {
        forgeCalls.push('open');
        return 'https://example.test/pull/501\n';
      },
      listChecks: () => {
        forgeCalls.push('checks');
        return [{ name: 'checks', state: 'SUCCESS', done: true, url: null }];
      },
      mergePr: number => {
        forgeCalls.push(`merge ${number}`);
      },
      readPr: number => {
        forgeCalls.push(`read ${number}`);
        return pr;
      },
      dropBranch: ref => {
        forgeCalls.push(`drop ${ref}`);
      },
    },
  });

  assert.equal(published.url, 'https://example.test/pull/501');
  assert.equal(published.commit, 'beef1234');
  assert.deepEqual(forgeCalls, ['open', 'checks', 'merge 501', 'read 501', 'drop docs/jul-310-landing']);
  assert.deepEqual(gitCalls[0].args, ['fetch', '--no-tags', '--quiet', 'origin', 'main']);
  assert.deepEqual(gitCalls[1].args, ['checkout', '--quiet', '-B', 'docs/jul-310-landing', 'origin/main']);
  assert.deepEqual(gitCalls.find(call => call.args[0] === 'add').args, ['add', '--', 'docs/retros/jul-310.md']);
  assert.deepEqual(gitCalls.find(call => call.args[0] === 'push').args, ['push', '--quiet', '-u', 'origin', 'docs/jul-310-landing']);
  assert.ok(gitCalls.every(call => call.cwd === checkout));
  // The file was held in memory while the branch changed and put back after.
  assert.equal(fs.readFileSync(retro, 'utf8'), '# What JUL-310 taught\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a record main already holds is not published a second time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
  const checkout = path.join(dir, 'main');
  const retro = path.join(checkout, 'docs/retros/jul-310.md');
  fs.mkdirSync(path.dirname(retro), { recursive: true });
  fs.writeFileSync(retro, '# What JUL-310 taught\n');
  const gitCalls = [];
  const git = (args, options = {}) => {
    gitCalls.push({ args, cwd: options.cwd });
    return args[0] === 'status' ? '' : '';
  };
  try {
    const published = await publishDocs({
      checkout,
      branch: 'docs/jul-310-landing',
      title: 's',
      body: 'b',
      bodyPath: path.join(dir, 'body.md'),
      files: [retro],
      git,
      forge: {
        openPr: () => {
          throw new Error('no pull request is opened for a record main already holds');
        },
      },
    });
    assert.deepEqual(published, { url: null, branch: null, commit: null, sha: null, files: [] });
    assert.equal(gitCalls.some(call => call.args[0] === 'push'), false);
    assert.equal(fs.readFileSync(retro, 'utf8'), '# What JUL-310 taught\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a record whose checks come back red is never merged', async () => {
  let merged = false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
  const checkout = path.join(dir, 'main');
  const retro = path.join(checkout, 'docs/retros/jul-310.md');
  fs.mkdirSync(path.dirname(retro), { recursive: true });
  fs.writeFileSync(retro, '# What JUL-310 taught\n');
  await assert.rejects(
    publishDocs({
      checkout,
      branch: 'docs/jul-310-landing',
      title: 's',
      body: 'b',
      bodyPath: '/repo/body.md',
      files: [retro],
      git: args => (args[0] === 'status' ? 'A file' : args[0] === 'rev-parse' ? 'abc1234' : ''),
      forge: {
        openPr: () => 'https://example.test/pull/501',
        listChecks: () => [{ name: 'repository-hygiene', state: 'FAILURE', done: true, url: null }],
        mergePr: () => {
          merged = true;
        },
      },
      tries: 1,
      waitMs: 1,
    }),
    /repository-hygiene FAILURE/
  );
  assert.equal(merged, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a record with nothing in it is a fault, not a push', async () => {
  await assert.rejects(
    publishDocs({
      checkout: '/repo/main',
      branch: 'docs/jul-310-landing',
      title: 's',
      body: 'b',
      bodyPath: '/repo/body.md',
      files: ['/repo/main/docs/retros/jul-310.md'],
      git: args => (args[0] === 'status' ? '' : ''),
    }),
    /nothing was written at docs\/retros\/jul-310\.md/
  );
});

test('the pull request checks are read from the rollup, whichever shape the forge gives them', () => {
  const answer = JSON.stringify({
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'checks', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://example.test/check/1' },
      { __typename: 'CheckRun', name: 'web', status: 'IN_PROGRESS', conclusion: null, detailsUrl: 'https://example.test/check/2' },
      { __typename: 'StatusContext', context: 'Vercel', state: 'PENDING', targetUrl: 'https://example.test/vercel' },
    ],
  });
  const calls = [];
  const checks = checkRollup(420, { execImpl: (command, args) => { calls.push([command, ...args]); return answer; } });
  assert.deepEqual(calls, [['gh', 'pr', 'view', '420', '--json', 'statusCheckRollup']]);
  assert.deepEqual(checks, [
    { name: 'checks', state: 'SUCCESS', done: true, url: 'https://example.test/check/1' },
    { name: 'web', state: 'IN_PROGRESS', done: false, url: 'https://example.test/check/2' },
    { name: 'Vercel', state: 'PENDING', done: false, url: 'https://example.test/vercel' },
  ]);
});

test('the machine waits for the pull request checks and only merges on a green rollup', async () => {
  const rolls = [
    [{ name: 'checks', state: 'IN_PROGRESS', done: false }],
    [{ name: 'checks', state: 'SUCCESS', done: true }, { name: 'Vercel', state: 'SUCCESS', done: true }],
  ];
  const lines = [];
  const green = await waitForPullChecks({
    pr: 420,
    list: () => rolls.shift(),
    sleep: noSleep,
    log: line => lines.push(line),
  });
  assert.equal(green.green, true);
  assert.match(green.reason, /checks on pull request #420 are green/);
  assert.deepEqual(lines, ['Waiting for checks on pull request #420.']);
});

test('a failing pull request check is named, and the machine does not wait for the rest', async () => {
  let reads = 0;
  const red = await waitForPullChecks({
    pr: 420,
    list: () => {
      reads += 1;
      return [
        { name: 'repository-hygiene', state: 'FAILURE', done: true },
        { name: 'web', state: 'IN_PROGRESS', done: false },
      ];
    },
    sleep: noSleep,
  });
  assert.equal(reads, 1);
  assert.equal(red.green, false);
  assert.deepEqual(red.failed.map(check => check.name), ['repository-hygiene']);
  assert.match(red.reason, /pull request #420 has a failing check: repository-hygiene FAILURE/);
});

test('a pull request with no checks is green, and one that never finishes says so', async () => {
  const none = await waitForPullChecks({ pr: 420, list: () => [], sleep: noSleep });
  assert.equal(none.green, true);
  assert.match(none.reason, /pull request #420 has no checks/);

  const stuck = await waitForPullChecks({
    pr: 420,
    list: () => [{ name: 'web', state: 'IN_PROGRESS', done: false }],
    tries: 2,
    waitMs: 30_000,
    sleep: noSleep,
  });
  assert.equal(stuck.green, false);
  assert.match(stuck.reason, /did not finish within 1 minutes/);

  const unclear = await waitForPullChecks({
    pr: 420,
    list: () => [{ name: 'web', state: 'STALE', done: true }],
    sleep: noSleep,
  });
  assert.equal(unclear.green, false);
  assert.match(unclear.reason, /has a check with no verdict: web STALE/);
});

test('a pull request a previous run already merged is not refused', () => {
  const decision = { pass: true, reason: 'PASS' };
  assert.equal(assertLandable({ pull: { ...PULL, state: 'MERGED', mergeCommit: 'f00dfeed' }, decision }), true);
  assert.throws(() => assertLandable({ pull: { ...PULL, state: 'CLOSED' }, decision }), /the pull request is CLOSED/);
});

test('a merged branch is deleted through the forge, and a branch already gone is not an error', () => {
  const calls = [];
  const gone = deleteRemoteBranch('practice/jul-316', { execImpl: (command, args) => { calls.push([command, ...args]); return ''; } });
  assert.equal(gone, true);
  assert.deepEqual(calls, [['gh', 'api', '-X', 'DELETE', 'repos/{owner}/{repo}/git/refs/heads/practice/jul-316']]);

  const missing = deleteRemoteBranch('practice/gone', {
    execImpl: () => { throw new Error('gh: Not Found (HTTP 404)'); },
  });
  assert.equal(missing, false);

  const vanished = deleteRemoteBranch('practice/jul-316', {
    execImpl: () => { throw new Error('gh: Reference does not exist (HTTP 422)'); },
  });
  assert.equal(vanished, false);

  assert.throws(() => deleteRemoteBranch('practice/jul-316', {
    execImpl: () => { throw new Error('gh: Server Error (HTTP 502)'); },
  }), /HTTP 502/);
});
