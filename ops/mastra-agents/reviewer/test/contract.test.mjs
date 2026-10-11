import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REVIEWER, REVIEWER_RESOURCE, finishReviewerRun, providerUsageIsUnknown, requireCompleteFileReview, requireCostStoreReadable, reviewPromptContract, reviewStepBudget, reviewThread, requestWithoutOutputCap, requireLiveTracing, reviewerConfiguration, reviewerDuckDBSettings, reviewerExporterConfiguration, reviewerStorageConfiguration } from '../src/contract.mjs';
import { captureCommandCodeResponse, commandCodeMetadata } from '../src/reviewer.mjs';
import { commandCodeCostEstimate, commandCodeUsageSummary, requireUsageSummaryCoverage, usageSummaryDelta } from '../src/commandcode-cost.mjs';

test('the reviewer defaults to CommandCode DeepSeek Flash and never sends an output cap', () => {
  assert.deepEqual(DEFAULT_REVIEWER.model, 'deepseek/deepseek-v4.1-flash');
  const body = requestWithoutOutputCap({ model: DEFAULT_REVIEWER.model, max_tokens: 12, max_completion_tokens: 13, max_output_tokens: 14 });
  assert.equal('max_tokens' in body, false);
  assert.equal('max_completion_tokens' in body, false);
  assert.equal('max_output_tokens' in body, false);
});

test('reviewer memory uses one stable private resource and one thread per review', () => {
  assert.equal(REVIEWER_RESOURCE, 'julia-reviewer');
  assert.equal(reviewThread('JUL-206', 'a'.repeat(40)), `reviewer:JUL-206:${'a'.repeat(40)}`);
  assert.notEqual(REVIEWER_RESOURCE, 'julia-builder');
});

test('reviewer step budget follows the immutable file inventory and contract phases', () => {
  assert.equal(reviewStepBudget(['a.mjs']), 5);
  assert.equal(reviewStepBudget(['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs']), 8);
  assert.throws(() => reviewStepBudget([]), /changed file/);
});

test('provider usage is known when every attempted response supplied token metadata', () => {
  assert.equal(providerUsageIsUnknown({ attempted: 6, observed: 6 }), false);
  assert.equal(providerUsageIsUnknown({ attempted: 6, observed: 6, failures: 1 }), true);
  assert.equal(providerUsageIsUnknown({ attempted: 6, observed: 5 }), true);
  assert.equal(providerUsageIsUnknown({ attempted: 1, observed: 1, error: new Error('usage.prompt_tokens is missing or unknown') }), true);
});

test('provider boundary fails closed when the stock cost store cannot be read', async () => {
  await assert.doesNotReject(requireCostStoreReadable(async () => ({ cost: 0.25 })));
  await assert.rejects(requireCostStoreReadable(async () => { throw new Error('database invalidated'); }), /cost store is unavailable/);
});

test('the model prompt keeps requirements and proof but reads candidate bytes through tools', () => {
  const input = { candidate: 'abc', sources: { specification: 'requirements', clarifications: 'decisions', 'test-evidence': 'proof', diff: 'large diff', 'file:a.mjs': 'large file' } };
  assert.deepEqual(reviewPromptContract(input), {
    candidate: 'abc', sources: { specification: 'requirements', clarifications: 'decisions', 'test-evidence': 'proof' },
  });
  assert.deepEqual(input.sources, { specification: 'requirements', clarifications: 'decisions', 'test-evidence': 'proof', diff: 'large diff', 'file:a.mjs': 'large file' });
});

test('a review refuses to start when no live trace context exists', () => {
  assert.throws(() => requireLiveTracing(null), /tracing context is not live/);
  assert.doesNotThrow(() => requireLiveTracing({ traceId: 'trace-206', currentSpan: { isValid: true } }));
});

test('per-card reviewer model overrides the CommandCode default', () => {
  assert.equal(reviewerConfiguration({ reviewer: { model: 'deepseek/custom' } }).model, 'deepseek/custom');
  assert.equal(reviewerConfiguration({ reviewer: { connection: { route: 'api', provider: 'commandcode' } } }).connection, 'existing-commandcode');
  assert.equal(reviewerConfiguration().model, DEFAULT_REVIEWER.model);
});

test('the persistent DuckDB store has a bounded working set on the reviewer laptop', () => {
  assert.deepEqual(reviewerStorageConfiguration('C:/proof/reviewer-costs.duckdb'), {
    id: 'julia-reviewer-observability',
    path: 'C:/proof/reviewer-costs.duckdb',
    memoryLimit: '1400MB',
    threads: 1,
    retention: { observability: { spans: { maxAge: '14d' } } },
  });
  assert.deepEqual(reviewerExporterConfiguration(), { maxBatchSize: 100 });
  assert.deepEqual(reviewerDuckDBSettings(), [
    'SET preserve_insertion_order = false',
    "PRAGMA force_compression = 'zstd'",
  ]);
});

test('published CommandCode prices produce a labeled estimate from every token category', async () => {
  const usage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 400_000 } };
  assert.deepEqual(commandCodeCostEstimate(usage, new Date('2026-10-11T18:00:00Z')), {
    cost: 0.6912, kind: 'estimated', source: 'commandcode.pricing.2026-10-11', priceBand: 'off-peak',
  });
  assert.deepEqual(commandCodeCostEstimate(usage, new Date('2026-10-12T06:30:00Z')), {
    cost: 1.3812, kind: 'estimated', source: 'commandcode.pricing.2026-10-11', priceBand: 'peak',
  });
  assert.throws(() => commandCodeCostEstimate({ completion_tokens: 4 }), /prompt_tokens is missing or unknown/);
  assert.throws(() => commandCodeCostEstimate({ prompt_tokens: 8 }), /completion_tokens is missing or unknown/);
});

test('raw CommandCode tokens survive schema normalization and carry the published-price estimate', async () => {
  const usage = { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 };
  captureCommandCodeResponse({ id: 'raw-response-a', usage });
  const metadata = await commandCodeMetadata.extractMetadata({ parsedBody: { id: 'raw-response-a', usage } });
  assert.equal(metadata.commandcode.responseId, 'raw-response-a');
  assert.deepEqual(metadata.commandcode.usage, usage);
  assert.equal(metadata.commandcode.cost.source, 'commandcode.pricing.2026-10-11');
  assert.equal(metadata.commandcode.cost.kind, 'estimated');
  assert.ok(metadata.commandcode.cost.cost > 0);
  await assert.rejects(commandCodeMetadata.extractMetadata({ parsedBody: { id: 'raw-response-b', usage } }), /response identity is missing or unknown/);
});

test('launcher-key usage snapshots provide a nonnegative actual machine delta', async () => {
  let authorization;
  const snapshot = await commandCodeUsageSummary({ key: 'secret', fetchImpl: async (_url, options) => {
    authorization = options.headers.Authorization;
    return { ok: true, json: async () => ({ totalCount: 12, totalCost: 1.25, totalTokensIn: 500, totalTokensOut: 40 }) };
  } });
  assert.equal(authorization, 'Bearer secret');
  assert.deepEqual(snapshot, { totalCount: 12, totalCost: 1.25, totalTokensIn: 500, totalTokensOut: 40 });
  assert.deepEqual(usageSummaryDelta({ totalCount: 10, totalCost: 1, totalTokensIn: 400, totalTokensOut: 30 }, snapshot), {
    kind: 'actual', cost: 0.25, requestCount: 2, tokensIn: 100, tokensOut: 10, mayIncludeOtherUsage: true,
  });
});

test('machine reconciliation refuses a snapshot that has not caught up with every attempted call', () => {
  const before = { totalCount: 10, totalCost: 1, totalTokensIn: 400, totalTokensOut: 30 };
  const caughtUp = { totalCount: 12, totalCost: 1.2, totalTokensIn: 450, totalTokensOut: 40 };
  assert.equal(requireUsageSummaryCoverage(before, caughtUp, 2), caughtUp);
  assert.throws(() => requireUsageSummaryCoverage(before, { ...caughtUp, totalCount: 11 }, 2), /has not reported every attempted provider call/);
});

test('end of run waits for memory, flushes observability, then closes both intact stores', async () => {
  const calls = [];
  await finishReviewerRun({
    memory: { settled: async () => calls.push('settled') },
    observability: { flush: async () => calls.push('flush') },
    primaryStorage: { close: async () => calls.push('close-primary') },
    vectorStorage: { close: async () => calls.push('close-vector') },
    observabilityStorage: { close: async () => calls.push('close-observability') },
  });
  assert.deepEqual(calls, ['settled', 'flush', 'close-primary', 'close-vector', 'close-observability']);
});

test('end of run attempts every ordered step when an earlier step fails', async () => {
  const calls = [];
  await assert.rejects(
    finishReviewerRun({
      memory: { settled: async () => { calls.push('settled'); throw new Error('settle failed'); } },
      observability: { flush: async () => calls.push('flush') },
      primaryStorage: { close: async () => calls.push('close-primary') },
      vectorStorage: { close: async () => calls.push('close-vector') },
      observabilityStorage: { close: async () => calls.push('close-observability') },
    }),
    /settle failed/,
  );
  assert.deepEqual(calls, ['settled', 'flush', 'close-primary', 'close-vector', 'close-observability']);
});

test('a verdict fails closed unless it accounts for every changed file exactly once', () => {
  assert.doesNotThrow(() => requireCompleteFileReview(['a.mjs', 'nested/b.mjs'], ['nested/b.mjs', 'a.mjs']));
  assert.throws(() => requireCompleteFileReview(['a.mjs', 'nested/b.mjs'], ['a.mjs']), /missing nested\/b\.mjs/);
  assert.throws(() => requireCompleteFileReview(['a.mjs'], ['a.mjs', 'invented.mjs']), /unexpected invented\.mjs/);
  assert.throws(() => requireCompleteFileReview(['a.mjs'], ['a.mjs', 'a.mjs']), /duplicate a\.mjs/);
});
