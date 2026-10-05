import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIssueCostRecord, buildUnmatchedReviewCostRecord, saveIssueCostRecord } from './issue-cost-records.mjs';

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
  assert.equal(record.cost.totalUsd, 0);
});

test('missing usage is a named gap rather than zero tokens', () => {
  const record = buildIssueCostRecord({ issue: factoryIssue, kind: 'factory', card: factoryCard, traces: [{ ...tracedBuild, usage: null }] });

  assert.ok(record.gaps.includes('trace trace-1: usage unavailable'));
  assert.equal(record.cost.byProviderModel[0].freshInputTokens, null);
});

test('a repeated save writes the issue record once and returns the stored row', async () => {
  const record = buildIssueCostRecord({ issue: factoryIssue, kind: 'factory', card: factoryCard, traces: [tracedBuild] });
  const commands = [];
  const runPsql = async ({ args }) => {
    commands.push({ args });
    return { status: 0, stdout: `${JSON.stringify(record)}\n`, stderr: '' };
  };

  const saved = await saveIssueCostRecord({ record, database: 'factory', runPsql });

  assert.equal(commands.length, 1);
  assert.ok(commands[0].args.includes('ON_ERROR_STOP=1'));
  assert.match(commands[0].args.join(' '), /ON CONFLICT \(record_key\) DO NOTHING/);
  assert.deepEqual(saved, record);
});

test('a review trace without an issue becomes an unmatched cost record, never a guessed issue match', () => {
  const record = buildUnmatchedReviewCostRecord({ ...tracedBuild, id: 'review-trace', phase: 'review' });

  assert.equal(record.recordKey, 'unmatched-review:review-trace');
  assert.equal(record.identity.kind, 'unmatched-review');
  assert.equal(record.cost.totalUsd, 0.42);
});
