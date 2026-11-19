import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NTFY_MAX_BYTES,
  assertReportHasAllFiveParts,
  formatNtfyMessage,
  formatReportMarkdown,
  generateUpdateReport,
  hasExistingReport,
  isMajorUpdate,
  isOpenReportPr,
  isSecurityUpdate,
  isUpdatePr,
  parsePackageUpdatesFromDiff,
  processPullRequest,
  readState,
  reportLinkTarget,
  reportMarker,
  sendNtfyNotification,
  shouldNotify,
  truncateUtf8Bytes,
  validateReport,
  writeStateAtomic,
} from './update-report.mjs';

test('reportLinkTarget prefers the PR comment URL and falls back to the PR URL', () => {
  assert.equal(
    reportLinkTarget({ prUrl: 'https://github.com/toddwyder/julia-next/pull/564', commentUrl: 'https://github.com/toddwyder/julia-next/pull/564#issuecomment-1' }),
    'https://github.com/toddwyder/julia-next/pull/564#issuecomment-1',
  );
  assert.equal(
    reportLinkTarget({ prUrl: 'https://github.com/toddwyder/julia-next/pull/564', commentUrl: null }),
    'https://github.com/toddwyder/julia-next/pull/564',
  );
});

test('shouldNotify returns true only for new features, failures, or Todd decisions', () => {
  assert.equal(shouldNotify({ hasNewFeatures: false, failed: false, needsToddDecision: false }), false);
  assert.equal(shouldNotify({ hasNewFeatures: true, failed: false, needsToddDecision: false }), true);
  assert.equal(shouldNotify({ hasNewFeatures: false, failed: true, needsToddDecision: false }), true);
  assert.equal(shouldNotify({ hasNewFeatures: false, failed: false, needsToddDecision: true }), true);
});

test('hasExistingReport detects the exact PR and commit marker', () => {
  const marker = reportMarker({ prNumber: 564, commitSha: 'abc1234' });
  assert.equal(hasExistingReport([{ body: `hello\n${marker}` }], { prNumber: 564, commitSha: 'abc1234' }), true);
  assert.equal(hasExistingReport([{ body: `hello\n${marker}` }], { prNumber: 564, commitSha: 'def5678' }), false);
  assert.equal(hasExistingReport([{ body: 'other comment' }], { prNumber: 564, commitSha: 'abc1234' }), false);
});

test('validateReport enforces boundary shape and overrides failed when CI failed', () => {
  const clean = validateReport({
    updated: [{ name: 'firebase-tools', from: '15.36.0', to: '15.37.0' }],
    newFeatures: [{ title: 'Node 26 preview', plainEnglish: 'Adds Node 26 Cloud Functions support.', machineUse: 'Could test Node 26 functions.' }],
    fixes: [{ title: 'Dry-run fix', plainEnglish: 'Stops dry-run from creating a database.' }],
    outcome: 'Merged to main after CI passed.',
    toddAction: 'Nothing.',
    needsToddDecision: false,
    hasNewFeatures: false,
    failed: false,
  }, { prFailed: true });

  assert.equal(clean.hasNewFeatures, true);
  assert.equal(clean.failed, true);
  assert.throws(() => validateReport({ updated: [] }), /outcome/i);
});

test('formatReportMarkdown includes all required sections and idempotency marker', () => {
  const report = validateReport({
    updated: [{ name: 'firebase', from: '13.3.0', to: '13.4.0' }],
    newFeatures: [],
    fixes: [{ title: 'Auth fix', plainEnglish: 'Fixes token refresh.' }],
    outcome: 'Merged to main.',
    toddAction: 'Nothing.',
    needsToddDecision: false,
    hasNewFeatures: false,
    failed: false,
  });
  const md = formatReportMarkdown({
    report,
    prNumber: 557,
    commitSha: '3072acf6',
    modelId: 'commandcode/stealth/glyph-cluster:free',
    releaseUrls: ['https://github.com/firebase/firebase-js-sdk/releases/tag/firebase@13.4.0'],
  });
  assert.match(md, /\*\*What was updated\*\*/);
  assert.match(md, /\*\*New features\*\*/);
  assert.match(md, /\*\*Fixes\*\*/);
  assert.match(md, /\*\*What happened\*\*:/);
  assert.match(md, /\*\*What Todd needs to do\*\*:/);
  assert.ok(md.includes(reportMarker({ prNumber: 557, commitSha: '3072acf6' })));
});

test('formatNtfyMessage stays within 4,096 UTF-8 bytes even for large reports', () => {
  const huge = 'é'.repeat(3000);
  assert.ok(Buffer.byteLength(truncateUtf8Bytes(huge, NTFY_MAX_BYTES), 'utf8') <= NTFY_MAX_BYTES);
  const { message } = formatNtfyMessage({
    prNumber: 564,
    prTitle: 'chore(deps): update dependency firebase-tools to v15.37.0',
    report: {
      updated: [{ name: 'firebase-tools', from: '15.36.0', to: '15.37.0' }],
      newFeatures: [{ title: 'Big feature', plainEnglish: huge }],
      outcome: 'Merged.',
      toddAction: 'Nothing.',
      hasNewFeatures: true,
      failed: false,
      needsToddDecision: false,
    },
  });
  assert.ok(Buffer.byteLength(message, 'utf8') <= NTFY_MAX_BYTES);
});

test('parsePackageUpdatesFromDiff extracts package.json and .nvmrc changes', () => {
  const updates = parsePackageUpdatesFromDiff([
    {
      filename: 'package.json',
      patch: '@@ -49,3 +49,3 @@\n-    "firebase-tools": "15.36.0",\n+    "firebase-tools": "15.37.0",',
    },
    {
      filename: '.nvmrc',
      patch: '@@ -1 +1 @@\n-24.22.3\n+26.13.1',
    },
  ]);
  assert.deepEqual(updates, [
    { name: 'firebase-tools', from: '15.36.0', to: '15.37.0' },
    { name: 'node', from: '24.22.3', to: '26.13.1' },
  ]);
});

test('isUpdatePr identifies Renovate and chore dependency/skill PRs', () => {
  assert.equal(isUpdatePr({ user: { login: 'renovate[bot]' }, head: { ref: 'renovate/minor' }, title: 'fix(deps): update' }), true);
  assert.equal(isUpdatePr({ user: { login: 'toddwyder' }, head: { ref: 'chore/skills-pstack' }, title: 'chore(skills): update pstack' }), true);
  assert.equal(isUpdatePr({ user: { login: 'toddwyder' }, head: { ref: 'feat/recipes' }, title: 'feat: add recipes' }), false);
});

test('writeStateAtomic and readState round-trip state cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'update-report-state-'));
  try {
    const file = join(dir, 'update-reports.json');
    writeStateAtomic({ reports: { 'pr=564 commit=abc': { commentedAt: '2026-11-19T00:00:00Z' } } }, file);
    const loaded = readState(file);
    assert.equal(loaded.reports['pr=564 commit=abc'].commentedAt, '2026-11-19T00:00:00Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every candidate model failing sends one high-priority ntfy notification across repeated runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'update-report-fail-'));
  try {
    const statePath = join(dir, 'update-reports.json');
    const configDir = join(dir, 'config');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'ntfy.json'), JSON.stringify({ server: 'https://ntfy.example', topic: 'julia-test' }));

    const pr = {
      number: 570,
      title: 'chore(deps): update dependency eslint to v10.16.0',
      html_url: 'https://github.com/toddwyder/julia-next/pull/570',
      state: 'closed',
      merged_at: '2026-11-19T06:00:00Z',
      merge_commit_sha: 'deadbeef1234',
      head: { sha: 'head1234', ref: 'renovate/eslint' },
      user: { login: 'renovate[bot]' },
      body: 'Updates eslint.',
    };

    const ntfyPosts = [];
    const fetchImpl = async (url, init = {}) => {
      const target = String(url);
      if (target.startsWith('https://ntfy.example/')) {
        ntfyPosts.push({ url: target, headers: init.headers, body: init.body });
        return { ok: true, status: 200, text: async () => 'ok' };
      }
      if (target.includes('/issues/570/comments')) {
        return { ok: true, status: 200, text: async () => '[]' };
      }
      if (target.includes('/check-runs')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ check_runs: [] }) };
      }
      if (target.includes('/pulls/570/files')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{
            filename: 'package.json',
            patch: '@@ -1,3 +1,3 @@\n-    "eslint": "10.15.0",\n+    "eslint": "10.16.0",',
          }]),
        };
      }
      if (target.includes('registry.npmjs.org')) {
        return { ok: false, status: 404 };
      }
      throw new Error(`Unexpected fetch URL in test: ${target}`);
    };

    const failingGenerate = input => generateUpdateReport({
      ...input,
      modelCandidates: ['commandcode/model-a', 'commandcode/model-b'],
      modelCaller: async ({ modelId }) => {
        throw new Error(`CommandCode ${modelId} failed (429): Rate limit exceeded`);
      },
    });

    const first = await processPullRequest(pr, {
      token: 'test-token',
      state: readState(statePath),
      statePath,
      configDir,
      fetchImpl,
      generateImpl: failingGenerate,
      notifyImpl: opts => sendNtfyNotification({ ...opts, fetchImpl }),
    });

    const second = await processPullRequest(pr, {
      token: 'test-token',
      state: readState(statePath),
      statePath,
      configDir,
      fetchImpl,
      generateImpl: failingGenerate,
      notifyImpl: opts => sendNtfyNotification({ ...opts, fetchImpl }),
    });

    assert.equal(first.reportGenerationFailed, true);
    assert.equal(first.notified, true);
    assert.equal(second.reportGenerationFailed, true);
    assert.equal(second.notified, false);
    assert.equal(ntfyPosts.length, 1);
    assert.equal(ntfyPosts[0].headers.Priority, 'high');
    assert.equal(ntfyPosts[0].headers.Click, pr.html_url);
    assert.match(ntfyPosts[0].body, /eslint 10\.15\.0->10\.16\.0/);
    assert.match(ntfyPosts[0].body, /rate limit/i);
    assert.match(ntfyPosts[0].body, /https:\/\/github\.com\/toddwyder\/julia-next\/pull\/570/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assertReportHasAllFiveParts fails when any of the five report parts is missing', () => {
  const report = validateReport({
    updated: [{ name: '@sentry/node', from: '10.75.0', to: '11.0.0' }],
    newFeatures: [{ title: 'v11 tracing', plainEnglish: 'New tracing API.', machineUse: 'Better error traces.' }],
    fixes: [],
    machineSummary: 'Could improve dashboard error tracing.',
    outcome: 'Open and awaiting Todd decision.',
    toddAction: 'Decide whether to merge @sentry/node v11.',
    needsToddDecision: true,
  }, { isMajor: true });
  const md = formatReportMarkdown({
    report,
    prNumber: 575,
    commitSha: 'abc1234',
    modelId: 'commandcode/test',
  });
  assert.equal(assertReportHasAllFiveParts(md), true);

  for (const heading of [
    '**What was updated**',
    '**New features**',
    '**How the machine could use this**:',
    '**What happened**:',
    '**What Todd needs to do**:',
  ]) {
    if (heading === '**New features**') {
      const withoutBrought = md.replace('**New features**', '**Other**').replace('**Fixes**', '**Other2**');
      assert.throws(() => assertReportHasAllFiveParts(withoutBrought), /what it brought/);
    } else {
      assert.throws(() => assertReportHasAllFiveParts(md.replace(heading, '**Removed**')), /missing required part/i);
    }
  }
});

test('major updates and security advisories are recognized and major updates force needsToddDecision', async () => {
  const majorPr = {
    number: 575,
    title: 'fix(deps): update dependency @sentry/node to v11',
    head: { ref: 'renovate/major-sentry-javascript-monorepo' },
    user: { login: 'renovate[bot]' },
    state: 'open',
  };
  assert.equal(isMajorUpdate(majorPr, [{ name: '@sentry/node', from: '10.75.0', to: '11.0.0' }]), true);
  assert.equal(isOpenReportPr(majorPr), true);

  const { report } = await generateUpdateReport({
    pr: majorPr,
    updates: [{ name: '@sentry/node', from: '10.75.0', to: '11.0.0' }],
    releaseNotes: [],
    ciSummary: { failed: false, pending: false },
    modelCandidates: ['commandcode/test'],
    modelCaller: async () => JSON.stringify({
      updated: [{ name: '@sentry/node', from: '10.75.0', to: '11.0.0' }],
      newFeatures: [{ title: 'v11 SDK', plainEnglish: 'Major SDK upgrade.', machineUse: 'Cleaner tracing.' }],
      fixes: [],
      machineSummary: 'Cleaner tracing for dashboard errors.',
      outcome: 'Waiting for Todd decision.',
      toddAction: 'Approve merge of @sentry/node v11.',
      needsToddDecision: false,
    }),
  });
  assert.equal(report.needsToddDecision, true);

  const secPr = {
    number: 576,
    title: 'fix(security): bump basic-ftp to 6.2.4 (GHSA-xxxx)',
    head: { ref: 'fix/security-basic-ftp' },
    user: { login: 'toddwyder' },
    body: 'Fixes Dependabot security advisory.',
  };
  assert.equal(isSecurityUpdate(secPr), true);
  assert.equal(isUpdatePr(secPr), true);
  assert.equal(isOpenReportPr(secPr), true);
});
