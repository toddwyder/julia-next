// The machine wired into a real Mastra, driven with fake dependencies: one run
// that passes, one that sends the change back, and one that stops the card.
// No server, no pull request, no model.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { missingProgram } from '../shipping/harness.mjs';
import { MAX_FAILS, WORKFLOW_ID, runPreview } from './workflow.mjs';

const CARD = {
  identifier: 'JUL-999',
  title: 'Practice card for the preview machine',
  description: 'The dashboard shows a count.',
  url: null,
};

function fakeDeps(overrides = {}) {
  const calls = { saved: [], posted: [], stopped: 0 };
  const deps = {
    runDir: '/tmp/practice/preview-run',
    checkout: '/tmp/practice/checkout',
    liveStateDir: '/var/lib/practice/state',
    getIssue: async () => CARD,
    pullFiles: async () => ({ sha: 'commit-under-test', files: ['dashboard/app/page.jsx'] }),
    prepareCheckout: async () => 'commit-under-test',
    digest: () => ({ files: [], digest: 'same' }),
    buildPreview: async ({ sha }) => ({ address: 'http://127.0.0.1:4401', sha, buildSeconds: 33.4, bootSeconds: 5 }),
    checkRuns: async () => [{ name: 'web', status: 'completed', conclusion: 'success', head_sha: 'commit-under-test' }],
    runProof: async () => ({ code: 0, seconds: 1.5, output: 'ℹ skipped 0\n' }),
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

async function run(t, deps, failedBefore = 0) {
  const runDir = mkdtempSync(path.join(tmpdir(), 'preview-run-'));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  const logs = [];
  const result = await runPreview({ pr: 412, card: CARD.identifier, deps, runDir, failedBefore, log: line => logs.push(line) });
  return { ...result, logs };
}

const whenTheProgramIsThere = missingProgram()
  ? { skip: `${missingProgram()}, so the machine cannot run here; it runs on the server` }
  : {};

test('a clean run of a dashboard change passes and keeps one record per step', whenTheProgramIsThere, async t => {
  const { deps, calls } = fakeDeps();
  const result = await run(t, deps);

  assert.equal(result.status, 'success', result.error);
  assert.equal(result.output.pr, 412);
  assert.equal(result.output.scope, 'dashboard');
  assert.equal(result.output.preview.address, 'http://127.0.0.1:4401');
  assert.equal(result.output.verdict, 'PASS');
  assert.deepEqual(result.output.failing, []);
  assert.equal(result.output.live.unchanged, true);
  assert.equal(result.output.stopped, false);
  assert.equal(calls.stopped, 1);
  assert.equal(calls.posted.length, 1);
  assert.equal(calls.saved.length >= 5, true);
  assert.match(result.logs.join('\n'), new RegExp(`${WORKFLOW_ID}|Mastra workflow run`));
  assert.match(result.logs.join('\n'), /PASS for #412: passed the change\./);
});

test('a failing check sends the change back to the build without stopping it', whenTheProgramIsThere, async t => {
  const { deps, calls } = fakeDeps({
    checkRuns: async () => [{ name: 'web', status: 'completed', conclusion: 'failure', head_sha: 'commit-under-test' }],
  });
  const result = await run(t, deps);

  assert.equal(result.status, 'success', result.error);
  assert.equal(result.output.verdict, 'FAIL');
  assert.deepEqual(result.output.failing, ['web: failure']);
  assert.equal(result.output.failCount, 1);
  assert.equal(result.output.stopped, false);
  assert.match(result.logs.join('\n'), /FAIL for #412: sent the change back to the build\./);
  assert.equal(calls.posted.length, 1);
});

test('the second FAIL on a pull request stops the card instead of sending it back again', whenTheProgramIsThere, async t => {
  const { deps } = fakeDeps({
    checkRuns: async () => [{ name: 'web', status: 'completed', conclusion: 'failure', head_sha: 'commit-under-test' }],
  });
  const result = await run(t, deps, 1);

  assert.equal(result.output.failCount, MAX_FAILS);
  assert.equal(result.output.stopped, true);
  assert.match(result.logs.join('\n'), /FAIL for #412: stopped the card\./);
});
