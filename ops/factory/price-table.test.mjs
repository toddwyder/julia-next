import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRICE_TABLE,
  getModelPrice,
  calculateModelCost,
} from './price-table.mjs';

test('OpenRouter advertises its own current rates and does not invent a cache discount', () => {
  const price = getModelPrice('openrouter/deepseek/deepseek-chat');
  assert.equal(price.freshInputPerMillion, .2574);
  assert.equal(price.outputPerMillion, 1.0287);
  assert.equal(price.cachedInputPerMillion, null);
  const result = calculateModelCost({ model: 'openrouter/deepseek/deepseek-chat', usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 500 } });
  assert.equal(result.error, 'no_cached_input_price');
});

test('an unverified wrapper model or cache-write TTL remains a price gap', () => {
  assert.equal(getModelPrice('gpt-4o', 'commandcode'), null);
  const result = calculateModelCost({ model: 'anthropic/claude-sonnet-4-6', usage: { inputTokens: 1000, outputTokens: 100, inputDetails: { cacheWrite: 500 } } });
  assert.equal(result.error, 'no_cache_write_price_context');
});

test('price table entries have required schema: fresh, cached, output, provider, payFactor, sourceUrl, dateChecked', () => {
  assert.ok(Object.keys(PRICE_TABLE).length > 0);
  for (const [modelId, entry] of Object.entries(PRICE_TABLE)) {
    assert.equal(typeof entry.freshInputPerMillion, 'number', `${modelId} missing freshInputPerMillion`);
    assert.ok(entry.cachedInputPerMillion === null || typeof entry.cachedInputPerMillion === 'number', `${modelId} missing cachedInputPerMillion`);
    assert.equal(typeof entry.outputPerMillion, 'number', `${modelId} missing outputPerMillion`);
    assert.equal(typeof entry.provider, 'string', `${modelId} missing provider`);
    assert.equal(typeof entry.payFactor, 'number', `${modelId} missing payFactor`);
    assert.match(entry.sourceUrl, /^https?:\/\//, `${modelId} sourceUrl must be a URL`);
    assert.match(entry.dateChecked, /^\d{4}-\d{2}-\d{2}/, `${modelId} dateChecked must be ISO date`);
  }
});

test('DeepSeek rates correctly distinguish cached input from fresh input (fixes Mastra bundled bug)', () => {
  const v4 = getModelPrice('deepseek/deepseek-v4-pro');
  assert.ok(v4);
  assert.equal(v4.freshInputPerMillion, 0.66);
  assert.equal(v4.cachedInputPerMillion, 0.022);
  assert.equal(v4.outputPerMillion, 1.98);
  assert.equal(v4.payFactor, 1.0);
  assert.ok(v4.cachedInputPerMillion < v4.freshInputPerMillion);
});

test('DeepSeek Pro rates include thinking tokens as output rate', () => {
  const r1 = getModelPrice('deepseek/deepseek-v4-pro');
  assert.ok(r1);
  assert.equal(r1.freshInputPerMillion, 0.66);
  assert.equal(r1.cachedInputPerMillion, 0.022);
  assert.equal(r1.outputPerMillion, 1.98);
  assert.equal(r1.payFactor, 1.0);
});

test('Command Code provider applies 1/7 pay factor ($10 buys $70 credit)', () => {
  const cc = getModelPrice('commandcode/deepseek-v4-pro');
  assert.ok(cc);
  assert.equal(cc.provider, 'commandcode');
  assert.equal(cc.payFactor, 10 / 70);
});

test('Subscriptions (ChatGPT/Codex, Gemini) have what-you-pay payFactor 0', () => {
  const gpt = getModelPrice('openai/gpt-4o');
  assert.ok(gpt);
  assert.equal(gpt.payFactor, 0.0);

  const gemini = getModelPrice('google/gemini-2.5-pro');
  assert.ok(gemini);
  assert.equal(gemini.payFactor, 0.0);
});

test('calculateModelCost calculates fresh input, cached input, output and what-you-pay cost', () => {
  const result = calculateModelCost({
    startedAt: '2026-09-28T12:00:00Z',
    model: 'deepseek/deepseek-v4-pro',
    usage: {
      inputTokens: 1000000,
      cachedInputTokens: 800000,
      outputTokens: 100000,
      reasoningTokens: 20000,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.freshInputTokens, 200000);
  assert.equal(result.cachedInputTokens, 800000);
  assert.equal(result.outputTokens, 100000);
  assert.equal(result.thinkingTokens, 20000);
  // Off-peak face cost: .132 + .0176 + .198 = .3476.
  assert.equal(Math.round(result.faceCostUsd * 1000) / 1000, 0.348);
  assert.equal(Math.round(result.whatYouPayUsd * 1000) / 1000, 0.348);
  assert.equal(result.provider, 'deepseek');
});

test('calculateModelCost applies Command Code pay factor', () => {
  const result = calculateModelCost({
    startedAt: '2026-09-28T12:00:00Z',
    model: 'commandcode/deepseek-v4-pro',
    usage: {
      inputTokens: 1000000,
      cachedInputTokens: 0,
      outputTokens: 100000,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'commandcode');
  // Verified Command Code Pro face cost: .66 + .198 = .858.
  assert.ok(Math.abs(result.faceCostUsd - .858) < 1e-12);
  // Apply the credit payment factor once.
  assert.equal(Math.round(result.whatYouPayUsd * 100) / 100, 0.12);
});

test('calculateModelCost reports subscription what-you-pay as $0 while retaining tokens and face cost', () => {
  const result = calculateModelCost({
    startedAt: '2026-09-28T12:00:00Z',
    model: 'openai/gpt-4o',
    usage: {
      inputTokens: 1000000,
      cachedInputTokens: 500000,
      outputTokens: 100000,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.whatYouPayUsd, 0.0);
  assert.ok(result.faceCostUsd > 0);
  assert.equal(result.freshInputTokens, 500000);
});

test('calculateModelCost returns unpriced model named gap when model is not in price table', () => {
  const result = calculateModelCost({
    startedAt: '2026-09-28T12:00:00Z',
    model: 'unknown/some-experimental-model',
    usage: { inputTokens: 100, outputTokens: 50 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'unpriced_model');
  assert.equal(result.model, 'unknown/some-experimental-model');
});

test('calculateModelCost returns no token count named gap when usage is missing or has no tokens', () => {
  const result = calculateModelCost({
    startedAt: '2026-09-28T12:00:00Z',
    model: 'deepseek/deepseek-v4-pro',
    usage: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'no_token_count');
});

test('OpenRouter models are present in price table with 1.0 pay factor', () => {
  const orDeepSeek = getModelPrice('openrouter/deepseek/deepseek-chat');
  assert.ok(orDeepSeek);
  assert.equal(orDeepSeek.provider, 'openrouter');
  assert.equal(orDeepSeek.payFactor, 1.0);

  const orClaude = getModelPrice('openrouter/openai/gpt-4o');
  assert.ok(orClaude);
  assert.equal(orClaude.provider, 'openrouter');
});

test('getModelPrice disambiguates bare model names to canonical provider over wrappers', () => {
  const gpt = getModelPrice('gpt-4o');
  assert.ok(gpt);
  assert.equal(gpt.provider, 'openai'); // canonical provider, not commandcode

  const claude = getModelPrice('claude-sonnet-4-6');
  assert.ok(claude);
  assert.equal(claude.provider, 'anthropic');
});

test('Mastra output tokens include thinking; the output rate bills them once', () => {
  const result = calculateModelCost({
    startedAt: '2026-09-28T12:00:00Z',
    model: 'deepseek/deepseek-v4-pro',
    usage: {
      inputTokens: 100000,
      cachedInputTokens: 80000,
      outputTokens: 10000, // Mastra/AI SDK total output includes reasoning
      reasoningTokens: 6000, // separate reasoning tokens (total 10k output)
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.outputTokens, 10000); // 4k + 6k
  assert.equal(result.thinkingTokens, 6000);
  // Thinking tokens are already included in the 10k output total.
  assert.equal(Math.round(result.whatYouPayUsd * 10000) / 10000, 0.0348);
});

test('DeepSeek Pro pricing follows UTC peak windows and the October public holiday', () => {
  const usage = { inputTokens: 1000000, outputTokens: 1000000, cachedInputTokens: 0 };
  assert.equal(calculateModelCost({ model: 'deepseek/deepseek-v4-pro', usage, startedAt: '2026-09-28T02:00:00Z' }).whatYouPayUsd, 5.28);
  assert.equal(calculateModelCost({ model: 'deepseek/deepseek-v4-pro', usage, startedAt: '2026-09-28T12:00:00Z' }).whatYouPayUsd, 2.64);
  assert.equal(calculateModelCost({ model: 'deepseek/deepseek-v4-pro', usage, startedAt: '2026-10-01T02:00:00Z' }).whatYouPayUsd, 2.64);
});

test('partial or impossible usage is a named gap instead of a fabricated free half of a call', () => {
  assert.equal(calculateModelCost({ model: 'openai/gpt-4o', usage: { inputTokens: 100 } }).error, 'no_token_count');
  assert.equal(calculateModelCost({ model: 'openai/gpt-4o', usage: { inputTokens: 100, outputTokens: 5, cachedInputTokens: 200 } }).error, 'invalid_token_count');
});
