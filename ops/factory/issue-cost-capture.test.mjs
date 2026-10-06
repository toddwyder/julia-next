import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCaptureArguments, runIssueCostCapture } from './issue-cost-capture.mjs';

test('the capture command saves a finished Factory card and prints its stored record', async () => {
  const output = [];
  const calls = [];
  const saved = await runIssueCostCapture({
    argv: ['--factory-card', '211'],
    env: { ISSUE_COST_CAPTURE_FACTORY_URL: 'https://factory.example', ISSUE_COST_CAPTURE_PROJECT_ID: 'project', ISSUE_COST_CAPTURE_DATABASE: 'factory' },
    readIssue: async (number) => ({ number, title: 'Stored cost record', state: 'closed', closed_at: '2026-10-06T12:00:00Z' }),
    readCards: async () => [{ number: 211, enteredAt: '2026-10-06T10:00:00Z', sessions: {} }],
    readSpans: async () => [],
    normalizeTraces: () => [],
    readMessages: async () => [],
    readFallbackReasons: () => [],
    readPullRequest: async () => ({ number: 237, commits: [] }),
    saveRecord: async (record) => { calls.push(record); return record; },
    now: () => '2026-10-06T13:00:00Z',
    write: (line) => output.push(line),
    log: () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(saved.identity.issueNumber, 211);
  assert.equal(saved.identity.kind, 'factory');
  assert.deepEqual(output, [JSON.stringify(saved)]);
});

test('the capture command resolves a laptop pull request to its one linked issue', async () => {
  const reads = [];
  const saved = await runIssueCostCapture({
    argv: ['--laptop-pr', '238'],
    env: { ISSUE_COST_CAPTURE_FACTORY_URL: 'https://factory.example', ISSUE_COST_CAPTURE_PROJECT_ID: 'project' },
    readPullRequest: async ({ pullRequestNumber }) => ({ number: pullRequestNumber, commits: [], closingIssues: [{ number: 211, title: 'Stored cost record', state: 'CLOSED', closedAt: '2026-10-06T12:00:00Z' }] }),
    saveRecord: async (record) => { reads.push(record); return record; },
    write: () => {}, log: () => {},
  });

  assert.equal(reads.length, 1);
  assert.equal(saved.identity.kind, 'laptop');
  assert.equal(saved.identity.issueNumber, 211);
  assert.equal(saved.source.pullRequestNumber, 238);
});

test('the production GitHub boundary uses the linked issue from the pull request timeline', async () => {
  const requests = [];
  const saved = await runIssueCostCapture({
    argv: ['--laptop-pr', '238'], env: {}, write: () => {}, log: () => {}, saveRecord: async (record) => record,
    fetchImpl: async (url) => {
      requests.push(url);
      const body = url.endsWith('/pulls/238') ? { number: 238, commits: [] } : [{ event: 'cross-referenced', source: { issue: { number: 211, title: 'Cost record', state: 'closed', closed_at: '2026-10-06T12:00:00Z' } } }];
      return { ok: true, json: async () => body };
    },
  });
  assert.equal(saved.identity.issueNumber, 211);
  assert.equal(requests.length, 2);
});

test('the capture command rejects ambiguous input and a laptop pull request without exactly one linked issue', async () => {
  assert.throws(() => parseCaptureArguments(['--factory-card', '211', '--laptop-pr', '238']), /usage:/);
  await assert.rejects(
    () => runIssueCostCapture({
      argv: ['--laptop-pr', '238'], env: {},
      readPullRequest: async () => ({ number: 238, closingIssues: [] }), saveRecord: async () => ({}), write: () => {}, log: () => {},
    }),
    /exactly one linked issue/,
  );
});
