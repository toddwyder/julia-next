import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REVIEWER, REVIEWER_RESOURCE, finishReviewerRun, requireCompleteFileReview, reviewThread, requestWithoutOutputCap, requireLiveTracing, reviewerConfiguration } from '../src/contract.mjs';
import { captureCommandCodeResponse, commandCodeMetadata } from '../src/reviewer.mjs';

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

test('a review refuses to start when no live trace context exists', () => {
  assert.throws(() => requireLiveTracing(null), /tracing context is not live/);
  assert.doesNotThrow(() => requireLiveTracing({ traceId: 'trace-206', currentSpan: { isValid: true } }));
});

test('per-card reviewer model overrides the CommandCode default', () => {
  assert.equal(reviewerConfiguration({ reviewer: { model: 'deepseek/custom' } }).model, 'deepseek/custom');
  assert.equal(reviewerConfiguration({ reviewer: { connection: { route: 'api', provider: 'commandcode' } } }).connection, 'existing-commandcode');
  assert.equal(reviewerConfiguration().model, DEFAULT_REVIEWER.model);
});

test('every CommandCode response requires finite nonnegative provider cost and token counts', async () => {
  assert.deepEqual(await commandCodeMetadata.extractMetadata({ parsedBody: { usage: { prompt_tokens: 8, completion_tokens: 4, cost: { total: 0.125 } } } }), { gateway: { cost: 0.125, source: 'commandcode.usage.cost.total' } });
  await assert.rejects(commandCodeMetadata.extractMetadata({ parsedBody: { usage: {} } }), /usage\.cost\.total is missing or unknown/);
  await assert.rejects(commandCodeMetadata.extractMetadata({ parsedBody: { usage: { cost: { total: 'unknown' } } } }), /usage\.cost\.total is missing or unknown/);
  await assert.rejects(commandCodeMetadata.extractMetadata({ parsedBody: { usage: { cost: { total: 0.01 }, completion_tokens: 4 } } }), /usage\.prompt_tokens is missing or unknown/);
  await assert.rejects(commandCodeMetadata.extractMetadata({ parsedBody: { usage: { cost: { total: 0.01 }, prompt_tokens: 8 } } }), /usage\.completion_tokens is missing or unknown/);
});

test('raw CommandCode usage survives schema normalization and stays correlated by response ID', async () => {
  const usage = { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18, cost: { total: 0.007 } };
  captureCommandCodeResponse({ id: 'raw-response-a', usage });
  assert.deepEqual(await commandCodeMetadata.extractMetadata({ parsedBody: { id: 'raw-response-a', usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } } }), {
    gateway: { cost: 0.007, source: 'commandcode.usage.cost.total' },
    commandcode: { responseId: 'raw-response-a', usage },
  });
  await assert.rejects(commandCodeMetadata.extractMetadata({ parsedBody: { id: 'raw-response-b', usage: { prompt_tokens: 13, completion_tokens: 5 } } }), /usage\.cost\.total is missing or unknown/);
  await assert.rejects(commandCodeMetadata.extractMetadata({ parsedBody: { id: 'raw-response-a', usage: { prompt_tokens: 13, completion_tokens: 5 } } }), /usage\.cost\.total is missing or unknown/);
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
