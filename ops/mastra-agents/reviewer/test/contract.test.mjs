import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REVIEWER, memoryScope, purgeAndCompact, requestWithoutOutputCap, requireLiveTracing, reviewerConfiguration } from '../src/contract.mjs';

test('the reviewer defaults to CommandCode DeepSeek Flash and never sends an output cap', () => {
  assert.deepEqual(DEFAULT_REVIEWER.model, 'deepseek/deepseek-v4.1-flash');
  const body = requestWithoutOutputCap({ model: DEFAULT_REVIEWER.model, max_tokens: 12, max_completion_tokens: 13, max_output_tokens: 14 });
  assert.equal('max_tokens' in body, false);
  assert.equal('max_completion_tokens' in body, false);
  assert.equal('max_output_tokens' in body, false);
});

test('reviewer memory is private to its card and never shares a builder resource', () => {
  assert.equal(memoryScope('JUL-206'), 'reviewer:JUL-206');
  assert.notEqual(memoryScope('JUL-206'), 'builder:JUL-206');
});

test('a review refuses to start when no live trace context exists', () => {
  assert.throws(() => requireLiveTracing(null), /tracing context is not live/);
  assert.doesNotThrow(() => requireLiveTracing({ traceId: 'trace-206', currentSpan: { isValid: true } }));
});

test('per-card reviewer model overrides the CommandCode default', () => {
  assert.equal(reviewerConfiguration({ reviewer: { model: 'deepseek/custom' } }).model, 'deepseek/custom');
  assert.equal(reviewerConfiguration().model, DEFAULT_REVIEWER.model);
});

test('purge deletes the isolated memory thread before compacting local storage', async () => {
  const calls = [];
  await purgeAndCompact({
    memory: { deleteThread: async id => calls.push(`delete:${id}`), settled: async () => calls.push('settled') },
    threadId: 'reviewer:JUL-206:abc', compact: async () => calls.push('compact'),
  });
  assert.deepEqual(calls, ['delete:reviewer:JUL-206:abc', 'settled', 'compact']);
});
