import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeSweep, priceLabel, pricedModels, readModels, stateDir } from './models.js';

const priced = (inputPerMillion, outputPerMillion) => ({ inputPerMillion, outputPerMillion });
const model = (id, provider, modelName) => ({ id, provider, modelName });

const catalog = {
  source: 'test-list',
  costs: {
    anthropic: { models: {
      'claude-opus-5-5': { cost: { input: 4, output: 20 } },
      'claude-sonnet-5-5': { cost: { input: 3, output: 15 } },
    } },
  },
};
const corrections = { peakWindows: [], freeModels: [], excludeDates: [] };

test('a model that appears is added and a model that disappeared is retired', () => {
  const first = mergeSweep({
    previousModels: [],
    available: [model('anthropic/claude-opus-5-5', 'anthropic', 'claude-opus-5-5')],
  });
  assert.deepEqual(first.added, ['anthropic/claude-opus-5-5']);
  assert.equal(first.models[0].displayName, 'Claude Opus 5.5');

  const second = mergeSweep({
    previousModels: first.models,
    available: [model('anthropic/claude-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5')],
  });
  assert.deepEqual(second.retired, ['anthropic/claude-opus-5-5']);
  assert.deepEqual(second.added, ['anthropic/claude-sonnet-5-5']);
  assert.deepEqual(second.models.map(row => row.id), ['anthropic/claude-sonnet-5-5']);
});

test('the sweep records which models the accounts offer, without a price', () => {
  const merged = mergeSweep({
    previousModels: [],
    available: [model('anthropic/claude-opus-5-5', 'anthropic', 'claude-opus-5-5')],
  });
  assert.deepEqual(merged.models, [{
    id: 'anthropic/claude-opus-5-5',
    provider: 'anthropic',
    name: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
  }]);
});

test('the picker prices each model from the list at load and drops one the list cannot price', () => {
  const rows = pricedModels([
    model('anthropic/claude-opus-5-5', 'anthropic', 'claude-opus-5-5'),
    model('anthropic/claude-brand-new', 'anthropic', 'claude-brand-new'),
  ], { catalog, corrections });
  assert.deepEqual(rows.map(row => row.id), ['anthropic/claude-opus-5-5']);
  assert.equal(priceLabel(rows[0].price), '↓$4/$20↑');
});

test('a price the list changes shows on the next picker load with no sweep', () => {
  const rows = [model('commandcode/deepseek/deepseek-v4.1-flash', 'commandcode', 'deepseek/deepseek-v4.1-flash')];
  const before = {
    source: 'test-list',
    costs: { commandcode: { models: { 'deepseek/deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6 } } } } },
  };
  const after = {
    source: 'test-list',
    costs: { commandcode: { models: { 'deepseek/deepseek-v4.1-flash': { cost: { input: 0.2, output: 0.8 } } } } },
  };
  assert.equal(priceLabel(pricedModels(rows, { catalog: before, corrections })[0].price), '↓$0.15/$0.6↑');
  assert.equal(priceLabel(pricedModels(rows, { catalog: after, corrections })[0].price), '↓$0.2/$0.8↑');
});

test('the picker shows the base rate whatever hour the sweep runs at', () => {
  const rows = [model('commandcode/deepseek/deepseek-v4.1-flash', 'commandcode', 'deepseek/deepseek-v4.1-flash')];
  const deepseek = {
    source: 'test-list',
    costs: { commandcode: { models: { 'deepseek/deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6 } } } } },
  };
  const peak = { peakWindows: [{ provider: 'commandcode', modelPrefix: 'deepseek/', days: ['mon'], from: '01:00', to: '04:00', timezone: 'UTC', multiplier: 2 }], freeModels: [], excludeDates: [] };
  assert.equal(priceLabel(pricedModels(rows, { catalog: deepseek, corrections: peak })[0].price), '↓$0.15/$0.6↑');
});

test('the sweep writes beside the dashboard records, under the state folder', () => {
  assert.equal(stateDir({ DASHBOARD_STATE_DIR: '/var/lib/julia-dashboard' }), '/var/lib/julia-dashboard/state');
  assert.equal(stateDir({}), '/var/lib/julia-dashboard/state');
});

test('readModels reports a missing, empty, stale and fresh sweep apart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'julia-models-test-'));
  const write = body => writeFileSync(join(directory, 'models.json'), JSON.stringify(body));
  try {
    assert.equal(readModels({ directory }).status, 'missing');
    write({ sweptAt: '2026-10-29T00:00:00.000Z', models: [] });
    assert.equal(readModels({ directory }).status, 'empty');
    write({ sweptAt: '2026-10-01T00:00:00.000Z', models: [{ id: 'a/b' }] });
    assert.equal(readModels({ directory, now: new Date('2026-10-29T00:00:00.000Z') }).status, 'stale');
    write({ sweptAt: '2026-10-28T00:00:00.000Z', models: [{ id: 'a/b' }] });
    assert.equal(readModels({ directory, now: new Date('2026-10-29T00:00:00.000Z') }).status, 'ok');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('prices read input and output per million tokens in the approved form', () => {
  assert.equal(priceLabel({ ...priced(2, 10) }), '↓$2/$10↑');
  assert.equal(priceLabel({ ...priced(0.15, 0.6) }), '↓$0.15/$0.6↑');
  assert.equal(priceLabel({ ...priced(0, 0), free: true }), 'Free');
  assert.equal(priceLabel({ ...priced(0.1, 0.5) }), '↓$0.1/$0.5↑');
  assert.equal(priceLabel({}), '');
});
