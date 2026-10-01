import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRICE_TABLE,
  getModelPrice,
  calculateModelCost,
} from './price-table.mjs';

test('price table entries have required schema: fresh, cached, output, provider, payFactor, sourceUrl, dateChecked', () => {
  assert.ok(Object.keys(PRICE_TABLE).length > 0);
  for (const [modelId, entry] of Object.entries(PRICE_TABLE)) {
    assert.equal(typeof entry.freshInputPerMillion, 'number', `${modelId} missing freshInputPerMillion`);
    assert.equal(typeof entry.cachedInputPerMillion, 'number', `${modelId} missing cachedInputPerMillion`);
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
  assert.equal(v4.freshInputPerMillion, 0.27);
  assert.equal(v4.cachedInputPerMillion, 0.07);
  assert.equal(v4.outputPerMillion, 1.10);
  assert.equal(v4.payFactor, 1.0);
  assert.ok(v4.cachedInputPerMillion < v4.freshInputPerMillion);
});

test('DeepSeek reasoner / R1 rates include thinking tokens as output rate', () => {
  const r1 = getModelPrice('deepseek/deepseek-reasoner');
  assert.ok(r1);
  assert.equal(r1.freshInputPerMillion, 0.55);
  assert.equal(r1.cachedInputPerMillion, 0.14);
  assert.equal(r1.outputPerMillion, 2.19);
  assert.equal(r1.payFactor, 1.0);
});

test('Command Code provider applies 1/7 pay factor ($10 buys $70 credit)', () => {
  const cc = getModelPrice('commandcode/claude-3-7-sonnet');
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
  // face cost = (200k * 0.27 / 1M) + (800k * 0.07 / 1M) + (100k * 1.10 / 1M)
  // = 0.054 + 0.056 + 0.11 = 0.22
  assert.equal(Math.round(result.faceCostUsd * 1000) / 1000, 0.22);
  assert.equal(Math.round(result.whatYouPayUsd * 1000) / 1000, 0.22);
  assert.equal(result.provider, 'deepseek');
});

test('calculateModelCost applies Command Code pay factor', () => {
  const result = calculateModelCost({
    model: 'commandcode/claude-3-7-sonnet',
    usage: {
      inputTokens: 1000000,
      cachedInputTokens: 0,
      outputTokens: 100000,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'commandcode');
  // Face cost for claude-3-7-sonnet: 1M * 3.00/1M + 100k * 15.00/1M = 3.00 + 1.50 = 4.50
  assert.equal(result.faceCostUsd, 4.50);
  // What you pay = 4.50 * (10 / 70) = 0.642857...
  assert.equal(Math.round(result.whatYouPayUsd * 100) / 100, 0.64);
});

test('calculateModelCost reports subscription what-you-pay as $0 while retaining tokens and face cost', () => {
  const result = calculateModelCost({
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
    model: 'unknown/some-experimental-model',
    usage: { inputTokens: 100, outputTokens: 50 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'unpriced_model');
  assert.equal(result.model, 'unknown/some-experimental-model');
});

test('calculateModelCost returns no token count named gap when usage is missing or has no tokens', () => {
  const result = calculateModelCost({
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

  const orClaude = getModelPrice('openrouter/anthropic/claude-3.5-sonnet');
  assert.ok(orClaude);
  assert.equal(orClaude.provider, 'openrouter');
});

test('getModelPrice disambiguates bare model names to canonical provider over wrappers', () => {
  const gpt = getModelPrice('gpt-4o');
  assert.ok(gpt);
  assert.equal(gpt.provider, 'openai'); // canonical provider, not commandcode

  const claude = getModelPrice('claude-3-5-sonnet');
  assert.ok(claude);
  assert.equal(claude.provider, 'anthropic');
});

test('calculateModelCost ensures thinking tokens are billed at output rate when separate from output', () => {
  const result = calculateModelCost({
    model: 'deepseek/deepseek-reasoner',
    usage: {
      inputTokens: 100000,
      cachedInputTokens: 80000,
      outputTokens: 4000, // raw text output
      reasoningTokens: 6000, // separate reasoning tokens (total 10k output)
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.outputTokens, 10000); // 4k + 6k
  assert.equal(result.thinkingTokens, 6000);
  // (20k * 0.55/1M) + (80k * 0.14/1M) + (10k * 2.19/1M) = 0.011 + 0.0112 + 0.0219 = 0.0441
  assert.equal(Math.round(result.whatYouPayUsd * 10000) / 10000, 0.0441);
});
