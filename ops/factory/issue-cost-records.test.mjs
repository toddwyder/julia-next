import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIssueCostRecord, buildUnmatchedReviewCostRecord, captureIssueCostRecord, saveIssueCostRecord } from './issue-cost-records.mjs';

const factoryIssue = { number: 211, title: 'Store structured cost records', outcome: 'done', completedAt: '2026-10-05T12:00:00.000Z' };
const factoryCard = {
  stageHistory: [
    { stage: 'planning', enteredAt: '2026-10-05T10:00:00.000Z', exitedAt: '2026-10-05T10:10:00.000Z', exitedBy: 'agent:planner' },
    { stage: 'execute', enteredAt: '2026-10-05T10:10:00.000Z', exitedAt: '2026-10-05T11:00:00.000Z', exitedBy: 'agent:builder' },
  ],
};
const tracedBuild = {
  id: 'trace-1', phase: 'build', actor: 'Factory', startedAt: '2026-10-05T10:10:00.000Z', endedAt: '2026-10-05T11:00:00.000Z',
  provider: 'deepseek', model: 'deepseek-v4-flash', costUsd: 0.42, costBearing: true,
  usage: { freshInputTokens: 80, cachedInputTokens: 20, outputTokens: 30, thinkingTokens: 7 },
};

test('a Factory card becomes one structured record with provider costs, token detail, stages and fallback counts', () => {
  const record = buildIssueCostRecord({ issue: factoryIssue, kind: 'factory', card: factoryCard, traces: [tracedBuild], fallbackMarks: ['pool-exhausted'] });

  assert.deepEqual(record.identity, { issueNumber: 211, title: 'Store structured cost records', kind: 'factory', outcome: 'done', completedAt: '2026-10-05T12:00:00.000Z' });
  assert.equal(record.cost.totalUsd, 0.42);
  assert.deepEqual(record.cost.byProviderModel, [{ stage: 'build', provider: 'deepseek', model: 'deepseek-v4-flash', costUsd: 0.42, freshInputTokens: 80, cachedInputTokens: 20, outputTokens: 30, thinkingTokens: 7 }]);
  assert.equal(record.stages.find((stage) => stage.stage === 'build').durationMs, 3000000);
  assert.deepEqual(record.fallbacks, { poolExhausted: 1, persistentOutage: 0 });
  assert.deepEqual(record.gaps, []);
});

test('a laptop record names its subscription builder gap and does not invent a trace cost', () => {
  const record = buildIssueCostRecord({ issue: { ...factoryIssue, number: 212 }, kind: 'laptop', pullRequest: { commits: [{ author: { login: 'toddwyder' } }] }, traces: [] });

  assert.equal(record.identity.kind, 'laptop');
  assert.ok(record.gaps.includes('builder: subscription, quota only'));
  assert.equal(record.cost.totalUsd, null);
  assert.equal(record.cost.faceValueUsd, null);
});

test('missing usage is a named gap rather than zero tokens', () => {
  const record = buildIssueCostRecord({ issue: factoryIssue, kind: 'factory', card: factoryCard, traces: [{ ...tracedBuild, usage: null }] });

  assert.ok(record.gaps.includes('trace trace-1: usage unavailable'));
  assert.equal(record.cost.byProviderModel[0].freshInputTokens, null);
});

test('a missing monetary cost leaves aggregate cost unknown rather than writing zero', () => {
  const record = buildIssueCostRecord({ issue: factoryIssue, kind: 'factory', card: factoryCard, traces: [{ ...tracedBuild, costUsd: null }] });

  assert.equal(record.cost.totalUsd, null);
  assert.ok(record.gaps.includes('trace trace-1: cost unavailable'));
});

test('a Factory record carries waits, non-bot commit rescues, review rounds and dated rework lines', () => {
  const record = buildIssueCostRecord({
    issue: factoryIssue, kind: 'factory', card: { ...factoryCard, waits: [{ startedAt: '2026-10-05T10:20:00Z', endedAt: '2026-10-05T10:30:00Z', reason: 'Todd approval' }] },
    pullRequest: { number: 300, commits: [
      { sha: 'factory', author: { login: 'julia-factory[bot]' }, committedAt: '2026-10-05T10:20:00Z' },
      { sha: 'rescue', author: { login: 'operator' }, committedAt: '2026-10-05T10:25:00Z' },
    ] },
    factoryBotLogin: 'julia-factory[bot]', traces: [tracedBuild], reviewRounds: [{ number: 1, outcome: 'changes-requested' }],
    rework: [{ at: '2026-10-05T11:01:00Z', reason: 'Reviewer timed out before a verdict' }],
  });

  assert.deepEqual(record.waits, [{ startedAt: '2026-10-05T10:20:00Z', endedAt: '2026-10-05T10:30:00Z', reason: 'Todd approval' }]);
  assert.deepEqual(record.rescues, [{ sha: 'rescue', actor: 'operator', committedAt: '2026-10-05T10:25:00Z' }]);
  assert.deepEqual(record.reviewRounds, [{ number: 1, outcome: 'changes-requested' }]);
  assert.deepEqual(record.rework, [{ at: '2026-10-05T11:01:00Z', reason: 'Reviewer timed out before a verdict' }]);
});

test('a repeated save writes the issue record once and returns the stored row', async () => {
  const record = buildIssueCostRecord({ issue: factoryIssue, kind: 'factory', card: factoryCard, traces: [tracedBuild] });
  const commands = [];
  const runPsql = async ({ args, stdin }) => {
    commands.push({ args, stdin });
    return { status: 0, stdout: `${JSON.stringify(record)}\n`, stderr: '' };
  };

  const saved = await saveIssueCostRecord({ record, database: 'factory', runPsql });

  assert.equal(commands.length, 1);
  assert.ok(commands[0].args.includes('ON_ERROR_STOP=1'));
  assert.deepEqual(commands[0].args.slice(-2), ['-f', '-']);
  assert.match(commands[0].stdin, /ON CONFLICT \(record_key\) DO UPDATE/);
  assert.deepEqual(saved, record);
});

test('a review trace without an issue becomes an unmatched cost record, never a guessed issue match', () => {
  const record = buildUnmatchedReviewCostRecord({ ...tracedBuild, id: 'review-trace', phase: 'review' });

  assert.equal(record.recordKey, 'unmatched-review:review-trace');
  assert.equal(record.identity.kind, 'unmatched-review');
  assert.equal(record.cost.totalUsd, 0.42);
});

test('capture wiring reads a Factory card, its traces and every session message before saving one record', async () => {
  const calls = [];
  const saved = await captureIssueCostRecord({
    issue: factoryIssue, kind: 'factory', from: '2026-10-05T00:00:00Z', to: '2026-10-06T00:00:00Z', factoryBotLogin: 'julia-factory[bot]',
    readCards: async () => [{ ...factoryCard, number: 211, sessions: { one: { threadId: 'thread-1', resourceId: 'project' } } }],
    readSpans: async () => [{ id: 'raw', sessionId: 'one' }],
    normalizeTraces: () => [{ ...tracedBuild, card: 211, correlated: true }, { ...tracedBuild, id: 'other-card', card: 999, correlated: true, costUsd: 5 }],
    readMessages: async (input) => { calls.push(input); return [{ parts: [{ type: 'data-mastracode-pack-fallback', data: { reason: 'pool-exhausted' } }] }]; },
    readFallbackReasons: (messages) => messages.flatMap((message) => message.parts.map((part) => part.data.reason)),
    readPullRequest: async () => ({ number: 300, commits: [{ sha: 'rescue', author: { login: 'operator' }, committedAt: '2026-10-05T10:25:00Z' }] }),
    saveRecord: async (record) => record,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { threadId: 'thread-1', resourceId: 'project' });
  assert.equal(saved.fallbacks.poolExhausted, 1);
  assert.equal(saved.cost.totalUsd, 0.42);
  assert.deepEqual(saved.rescues, [{ sha: 'rescue', actor: 'operator', committedAt: '2026-10-05T10:25:00Z' }]);
});
