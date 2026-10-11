import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REVIEWER, REVIEWER_RESOURCE, finishReviewerRun, reviewThread, requestWithoutOutputCap, requireLiveTracing, reviewerConfiguration } from '../src/contract.mjs';

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
