import test from 'node:test';
import assert from 'node:assert/strict';
import { costOfTokens, costFromMetrics, findCost, loadCatalog, priceFor, readCorrections } from './model-prices.js';

const catalog = {
  source: 'test-list',
  costs: {
    commandcode: { models: {
      'deepseek/deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
      'moonshotai/Kimi-K3.1-Pro': { cost: { input: 2, output: 10, cache_read: 0.4 } },
      'inclusionai/ling-3.1-flash:free': { cost: { input: 0, output: 0, cache_read: 0 } },
    } },
    anthropic: { models: {
      'claude-opus-5-5': { cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } },
    } },
    openai: { models: {
      'gpt-6-luna': { cost: { input: 0.2, output: 1.2, cache_read: 0.02 } },
      'gpt-6.1-sol': {
        cost: {
          input: 2, output: 10, cache_read: 0.1, cache_write: 2.5,
          tiers: [{ input: 4, output: 15, cache_read: 0.2, cache_write: 5, tier: { type: 'context', size: 272000 } }],
        },
      },
    } },
  },
};

const corrections = readCorrections({ file: new URL('../config/price-corrections.json', import.meta.url).pathname });

test('the corrections file holds DeepSeek peak hours and the free CommandCode model', () => {
  assert.equal(corrections.peakWindows.length, 2);
  assert.deepEqual(corrections.freeModels, ['commandcode/inclusionai/ling-3.1-flash:free']);
});

test('a model models.dev leaves out is priced from the corrections file', () => {
  const empty = { source: 'test-list', costs: {} };
  const kimi = priceFor({ catalog: empty, corrections, provider: 'commandcode', model: 'moonshotai/Kimi-K3.1-Pro' });
  assert.equal(kimi.inputPerMillion, 2);
  assert.equal(kimi.outputPerMillion, 10);
  assert.equal(kimi.cacheReadPerMillion, 0.2);
  assert.equal(kimi.source, 'the corrections file');
  assert.equal(priceFor({ catalog: empty, corrections, provider: 'commandcode', model: 'moonshotai/Kimi-K4' }), null);
});

test('the picker shows the base DeepSeek rate whatever the hour', () => {
  const shown = priceFor({ catalog, corrections, provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash' });
  assert.equal(shown.inputPerMillion, 0.15);
  assert.equal(shown.peak, false);
});

test('a DeepSeek call during peak hours is priced at the peak rate', () => {
  const peak = priceFor({ catalog, corrections, provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', at: '2026-11-13T02:00:00Z' });
  assert.equal(peak.inputPerMillion, 0.3);
  assert.equal(peak.outputPerMillion, 1.2);
  assert.equal(peak.peak, true);
});

test('the same DeepSeek call off peak keeps the models.dev rate', () => {
  const off = priceFor({ catalog, corrections, provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', at: '2026-11-13T05:00:00Z' });
  assert.equal(off.inputPerMillion, 0.15);
  assert.equal(off.outputPerMillion, 0.6);
  assert.equal(off.peak, false);
});

test('peak hours only apply on weekdays', () => {
  // 2026-11-14 is a Saturday.
  const weekend = priceFor({ catalog, corrections, provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', at: '2026-11-14T02:00:00Z' });
  assert.equal(weekend.inputPerMillion, 0.15);
});

test('a model missing from the list is refused instead of guessed', () => {
  assert.equal(priceFor({ catalog, corrections, provider: 'commandcode', model: 'nobody/no-such-model', at: '2026-11-13T02:00:00Z' }), null);
  assert.equal(findCost(catalog, 'commandcode', 'nobody/no-such-model'), null);
});

test('a dated build of a listed model resolves to its listed price', () => {
  const found = findCost(catalog, 'commandcode', 'deepseek/deepseek-v4.1-flash-1017-cm');
  assert.equal(found.cost.input, 0.15);
});

test('a free model costs nothing and is not multiplied', () => {
  const free = priceFor({ catalog, corrections, provider: 'commandcode', model: 'inclusionai/ling-3.1-flash:free', at: '2026-11-13T02:00:00Z' });
  assert.equal(free.free, true);
  assert.equal(free.inputPerMillion, 0);
  assert.equal(free.peak, false);
});

test('component token rows price one call once, without counting totals twice', () => {
  const at = new Date('2026-11-13T02:00:00Z');
  const price = priceFor({ catalog, corrections, provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', at });
  const cost = costOfTokens({
    price,
    tokens: { inputText: 91056, cacheRead: 99328, outputText: 88, outputReasoning: 44, totalInput: 190384, totalOutput: 132 },
  });
  assert.equal(cost.usd, 0.028071168);
});

test('a context tier applies once the input passes its size', () => {
  const at = new Date('2026-11-05T00:00:00Z');
  const price = priceFor({ catalog, corrections, provider: 'openai', model: 'gpt-6.1-sol', at });
  const small = costOfTokens({ price, tokens: { inputText: 1000, outputText: 100 } });
  const large = costOfTokens({ price, tokens: { inputText: 300000, outputText: 100 } });
  assert.equal(small.usd, (1000 * 2 + 100 * 10) / 1_000_000);
  assert.equal(large.usd, (300000 * 4 + 100 * 15) / 1_000_000);
});

test('a run total is unknown when any call has no price', () => {
  const rows = [
    { spanId: 'a', provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', timestamp: '2026-11-13T02:00:00Z', name: 'mastra_model_input_text_tokens', value: 1_000_000 },
    { spanId: 'b', provider: 'commandcode', model: 'nobody/no-such-model', timestamp: '2026-11-13T02:00:00Z', name: 'mastra_model_input_text_tokens', value: 10 },
  ];
  const total = costFromMetrics(rows, { catalog, corrections });
  assert.equal(total.usd, null);
  assert.deepEqual(total.unpriced, ['commandcode/nobody/no-such-model']);
});

test('a memory note-taker rolled up to the agent span keeps its own rate', () => {
  const rows = [
    { spanId: 'a', provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', timestamp: '2026-11-13T05:00:00Z', name: 'mastra_model_input_text_tokens', value: 1_000_000 },
    { spanId: 'a', provider: 'openai', model: 'gpt-6-luna', timestamp: '2026-11-13T05:00:00Z', name: 'mastra_model_input_text_tokens', value: 1_000_000 },
  ];
  const total = costFromMetrics(rows, { catalog, corrections });
  assert.equal(total.calls, 2);
  assert.equal(total.usd, 0.15 + 0.2);
});

test('a model name Mastra wrote with dashes still finds its price', () => {
  const rows = [
    { spanId: 'a', provider: 'commandcode', model: 'deepseek-deepseek-v4-1-flash', timestamp: '2026-11-13T05:00:00Z', name: 'mastra_model_input_text_tokens', value: 1_000_000 },
  ];
  const total = costFromMetrics(rows, { catalog, corrections });
  assert.equal(total.calls, 1);
  assert.equal(total.usd, 0.15);
});

test('a duration row adds no call to the run total', () => {
  const rows = [
    { spanId: 'a', provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', timestamp: '2026-11-13T05:00:00Z', name: 'mastra_model_input_text_tokens', value: 1_000_000 },
    { spanId: 'a', provider: null, model: null, timestamp: '2026-11-13T05:00:00Z', name: 'mastra_agent_duration_ms', value: 466 },
    { spanId: 'b', provider: null, model: null, timestamp: '2026-11-13T05:00:00Z', name: 'mastra_workflow_duration_ms', value: 35 },
  ];
  const total = costFromMetrics(rows, { catalog, corrections });
  assert.equal(total.calls, 1);
  assert.equal(total.usd, 0.15);
  assert.deepEqual(total.unpriced, []);
});

// The real price list is on this machine, so one test reads it to keep the wiring honest.
test('the shipped price list prices a peak DeepSeek call at the peak rate', () => {
  let shipped;
  try {
    shipped = loadCatalog();
  } catch {
    return; // No price list on this machine, so there is nothing to read here.
  }
  const at = new Date('2026-11-13T02:00:00Z');
  const price = priceFor({ catalog: shipped, corrections, provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', at });
  assert.ok(price, 'the shipped list knows this model');
  assert.equal(price.peak, true);
  assert.equal(price.inputPerMillion, 0.3);
});
