// The five moves of the machine, driven with fake dependencies so each decision
// can be read without a server, a pull request, or a model.
import assert from 'node:assert/strict';
import test from 'node:test';

import { DASHBOARD_PROOFS, LOCAL_TESTS, SERVER_TESTS, programReason } from './proofs.mjs';
import { MAX_FAILS, checks, gather, preview, proofs, settle } from './steps.mjs';

const CARD = {
  identifier: 'JUL-999',
  title: 'Practice card for the preview machine',
  description: 'The dashboard shows a count.',
  url: null,
};

function fakeDeps(overrides = {}) {
  const calls = { saved: [], built: 0, proofs: [], stopped: 0, posted: [], digests: 0 };
  const deps = {
    runDir: '/tmp/practice/preview-run',
    checkout: '/tmp/practice/checkout',
    liveStateDir: '/var/lib/practice/state',
    getIssue: async identifier => {
      assert.equal(identifier, CARD.identifier);
      return CARD;
    },
    pullFiles: async () => ({ sha: 'commit-under-test', files: ['dashboard/app/page.jsx'] }),
    prepareCheckout: async () => 'commit-under-test',
    digest: () => {
      calls.digests += 1;
      return { files: [], digest: 'same' };
    },
    buildPreview: async ({ sha }) => {
      calls.built += 1;
      return { address: 'http://127.0.0.1:4401', sha, buildSeconds: 33.4, bootSeconds: 5 };
    },
    checkRuns: async () => [{ name: 'web', status: 'completed', conclusion: 'success', head_sha: 'commit-under-test' }],
    workflowJobs: async () => ['web'],
    runProof: async proof => {
      calls.proofs.push(proof.name);
      return { code: 0, seconds: 1.5, output: 'ℹ skipped 0\n' };
    },
    stopPreview: async () => {
      calls.stopped += 1;
      return { stopped: true };
    },
    saveRecord: async record => {
      calls.saved.push(record);
    },
    post: async record => {
      calls.posted.push(record);
      return { url: 'http://example.invalid/1' };
    },
    ...overrides,
  };
  return { deps, calls };
}

const verdictOf = ({ checks: judged, proofs: ran, live }) => {
  const items = [
    { kind: 'check', name: 'web', ok: judged?.ok === true, detail: 'success' },
    ...(ran ?? []).map(proof => ({ kind: 'proof', name: proof.name, ok: proof.ok, detail: proof.detail })),
    { kind: 'live', name: 'live dashboard records', ok: live?.unchanged === true, detail: live?.unchanged ? 'identical' : 'changed' },
  ];
  const failing = items.filter(item => !item.ok).map(item => `${item.name}: ${item.detail}`);
  return { verdict: failing.length ? 'FAIL' : 'PASS', ok: failing.length === 0, items, failing };
};

test('gather pins the commit, reads what the change touched, and writes the record down', async () => {
  const { deps, calls } = fakeDeps();
  const state = await gather(deps, { pr: 412, card: CARD.identifier });

  assert.equal(state.sha, 'commit-under-test');
  assert.equal(state.scope, 'dashboard');
  assert.match(state.scopeReason, /dashboard/);
  assert.deepEqual(state.live, { dir: '/var/lib/practice/state', before: { files: [], digest: 'same' }, after: null, unchanged: false });
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0], state);
});

test('gather refuses a pull request that moved under it, because the checks belong to another commit', async () => {
  const { deps } = fakeDeps({ pullFiles: async () => ({ sha: 'a-newer-commit', files: [] }) });

  await assert.rejects(
    () => gather(deps, { pr: 412, card: CARD.identifier }),
    /the pull request moved while the machine read it: GitHub reports a-newer-commit, the checkout is at commit-under-test/
  );
});

test('gather refuses a card that Linear does not have', async () => {
  const { deps } = fakeDeps({ getIssue: async () => null });

  await assert.rejects(() => gather(deps, { pr: 412, card: 'JUL-999' }), /no card named JUL-999/);
});

test('a change that never meets the dashboard starts no second copy', async () => {
  const { deps, calls } = fakeDeps({ pullFiles: async () => ({ sha: 'commit-under-test', files: ['machine/preview/steps.mjs'] }) });
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });
  const after = await preview(deps, gathered);

  assert.equal(after.scope, 'machine');
  assert.equal(after.preview, null);
  assert.equal(after.previewGap, null);
  assert.equal(calls.built, 0);
});

test('a preview that cannot start leaves the reason, not a missing line', async () => {
  const { deps } = fakeDeps({
    buildPreview: async () => {
      throw new Error('the dashboard did not build: npm exited 1');
    },
  });
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });
  const after = await preview(deps, gathered);

  assert.equal(after.preview, null);
  assert.equal(after.previewGap, 'the dashboard did not build: npm exited 1');
});

test('checks that cannot be read are written down as a failing line', async () => {
  const { deps } = fakeDeps({
    checkRuns: async () => {
      throw new Error('gh exited 1');
    },
  });
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });
  const after = await checks(deps, gathered);

  assert.equal(after.checks.ok, false);
  assert.deepEqual(after.checks.items, []);
  assert.match(after.checks.failed[0], /the pull request's checks could not be read: gh exited 1/);
});

test('proofs are chosen by what the change touches, and a proof that cannot run still appears', async () => {
  const { deps, calls } = fakeDeps();
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });
  const after = await proofs(deps, gathered);

  assert.equal(calls.proofs.includes(SERVER_TESTS), true);
  assert.equal(calls.proofs.includes(DASHBOARD_PROOFS), false);
  const dashboard = after.proofs.find(proof => proof.name === DASHBOARD_PROOFS);
  assert.equal(dashboard.ok, false);
  assert.match(dashboard.detail, /the preview never answered, so there is no address to drive/);
});

test('a proof whose command cannot be started is a failing line, not a crash', async () => {
  const { deps } = fakeDeps({
    pullFiles: async () => ({ sha: 'commit-under-test', files: ['machine/preview/steps.mjs'] }),
    runProof: async () => {
      throw new Error('spawn node ENOENT');
    },
  });
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });
  const after = await proofs(deps, gathered);

  assert.equal(after.proofs.length, 1);
  assert.equal(after.proofs[0].ok, false);
  assert.match(after.proofs[0].detail, /the command could not be started: spawn node ENOENT/);
});

test('the local tests are not run where the installed program is absent, because they would skip', { skip: programReason() ? false : 'this machine has the installed program, so the gap cannot be shown here' }, async () => {
  const { deps, calls } = fakeDeps();
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });
  const withPreview = await preview(deps, gathered);
  const after = await proofs(deps, withPreview);

  assert.equal(calls.proofs.includes(LOCAL_TESTS), false);
  const local = after.proofs.find(proof => proof.name === LOCAL_TESTS);
  assert.equal(local.ok, false);
  assert.match(local.detail, /so the engine-backed tests would skip and a skipped proof is a failure/);
  assert.equal(calls.proofs.includes(SERVER_TESTS), true);
});

test('settle stops the copy, compares the live records afterwards, and posts the verdict', async () => {
  const { deps, calls } = fakeDeps();
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });
  const withPreview = await preview(deps, gathered);
  const withChecks = await checks(deps, withPreview);
  const withProofs = { ...withChecks, proofs: [{ name: SERVER_TESTS, ok: true, detail: 'exited 0' }] };
  const record = await settle(deps, withProofs, { verdictOf });

  assert.equal(calls.stopped, 1);
  assert.equal(calls.posted.length, 1);
  assert.equal(record.verdict, 'PASS');
  assert.equal(record.live.unchanged, true);
  assert.equal(record.failCount, 0);
  assert.equal(record.stopped, false);
  assert.deepEqual(record.posted, { url: 'http://example.invalid/1' });
  assert.equal(calls.saved.at(-1).verdict, 'PASS');
});

test('a FAIL counts up across runs and the second one stops the card', async () => {
  const { deps } = fakeDeps({ checkRuns: async () => [{ name: 'web', status: 'completed', conclusion: 'failure', head_sha: 'commit-under-test' }] });
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });
  const state = { ...gathered, proofs: [] };

  const first = await settle(deps, state, { verdictOf });
  assert.equal(first.verdict, 'FAIL');
  assert.equal(first.failCount, 1);
  assert.equal(first.stopped, false);

  const second = await settle(deps, state, { verdictOf, failedBefore: 1 });
  assert.equal(second.failCount, MAX_FAILS);
  assert.equal(second.stopped, true);
});

test('a run that dies before its verdict does not erase the failure before it', async () => {
  const { deps } = fakeDeps({
    failedBefore: 1,
    checkRuns: async () => [{ name: 'web', status: 'completed', conclusion: 'failure', head_sha: 'commit-under-test' }],
  });
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });

  // The machine stops here the way a crash would, with only the gather record
  // saved. The next run reads that record and must still know about failure one.
  assert.equal(gathered.failCount, 1);
  const next = await gather(deps, { pr: 412, card: CARD.identifier });
  const judged = await settle(deps, { ...next, proofs: [] }, { verdictOf });

  assert.equal(judged.verdict, 'FAIL');
  assert.equal(judged.failCount, MAX_FAILS);
  assert.equal(judged.stopped, true);
});

test('a workflow job that never reported is a failing check, named in the record', async () => {
  const { deps } = fakeDeps({ workflowJobs: async () => ['checks', 'web'] });
  const gathered = await gather(deps, { pr: 412, card: CARD.identifier });
  const after = await checks(deps, gathered);

  assert.equal(after.checks.ok, false);
  assert.deepEqual(after.checks.failed, ['checks']);
  assert.equal(after.checks.items.find(item => item.name === 'checks').absent, true);
});
