import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseAnthropicPrices, parseCommandCodePrices, parseOpenAIPrices, parsePrices,
  mergeSweep, onePerName, readModels, startModels, priceLabel, stateDir,
} from './models.js';

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const priced = (inputPerMillion, outputPerMillion) => ({ inputPerMillion, outputPerMillion });
const model = (id, provider, modelName) => ({ id, provider, modelName });
const find = (rows, name) => rows.find(row => row.name === name);

test('the saved Anthropic page parses to its real prices', () => {
  const rows = parseAnthropicPrices(fixture('anthropic-pricing.html'));
  assert.deepEqual(find(rows, 'Opus 5.5'), { name: 'Opus 5.5', ...priced(4, 20) });
  assert.deepEqual(find(rows, 'Haiku 5.5'), { name: 'Haiku 5.5', ...priced(0.1, 0.5) });
});

test('the saved OpenAI page parses to its real prices', () => {
  const rows = parseOpenAIPrices(fixture('openai-pricing.html'));
  assert.deepEqual(find(rows, 'gpt-6-astra'), { name: 'gpt-6-astra', ...priced(10, 50) });
  assert.deepEqual(find(rows, 'gpt-6.1-sol'), { name: 'gpt-6.1-sol', ...priced(2, 10) });
});

test('the saved CommandCode page parses to its real prices', () => {
  const rows = parseCommandCodePrices(fixture('commandcode-pricing.html'));
  assert.deepEqual(find(rows, 'DeepSeek V4.1 Flash'), { name: 'DeepSeek V4.1 Flash', ...priced(0.15, 0.6) });
  assert.deepEqual(find(rows, 'Kimi K3.1 Pro'), { name: 'Kimi K3.1 Pro', ...priced(2, 10) });
});

test('a pricing page that changes shape fails loudly instead of returning nothing', () => {
  const pages = [
    ['anthropic', fixture('anthropic-pricing.html').replaceAll('modelName', 'modelLabel')],
    ['openai', fixture('openai-pricing.html').replaceAll('&quot;tier&quot;', '&quot;rate&quot;')],
    ['commandcode', fixture('commandcode-pricing.html').replaceAll('role="row"', 'role="line"')],
  ];
  for (const [parser, body] of pages) {
    assert.throws(() => parsePrices(parser, body, parser), /page changed shape/);
  }
});

const anthropicPrices = () => ({ anthropic: parseAnthropicPrices(fixture('anthropic-pricing.html')) });

test('a model that appears is added and a model that disappeared is retired', () => {
  const first = mergeSweep({
    previousModels: [],
    available: [model('anthropic/claude-opus-5-5', 'anthropic', 'claude-opus-5-5')],
    pricesByProvider: anthropicPrices(),
    readAt: '2026-10-29T00:00:00.000Z',
  });
  assert.deepEqual(first.added, ['anthropic/claude-opus-5-5']);
  assert.equal(first.models[0].displayName, 'Claude Opus 5.5');
  assert.equal(first.models[0].priceReadAt, '2026-10-29T00:00:00.000Z');

  const second = mergeSweep({
    previousModels: first.models,
    available: [model('anthropic/claude-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5')],
    pricesByProvider: anthropicPrices(),
    readAt: '2026-11-05T00:00:00.000Z',
  });
  assert.deepEqual(second.retired, ['anthropic/claude-opus-5-5']);
  assert.deepEqual(second.added, ['anthropic/claude-sonnet-5-5']);
  assert.deepEqual(second.models.map(row => row.id), ['anthropic/claude-sonnet-5-5']);
});

test('a model with no saved price is never written and is reported', () => {
  const merged = mergeSweep({
    previousModels: [],
    available: [
      model('anthropic/claude-opus-5-5', 'anthropic', 'claude-opus-5-5'),
      model('anthropic/claude-brand-new', 'anthropic', 'claude-brand-new'),
    ],
    pricesByProvider: anthropicPrices(),
    readAt: '2026-10-29T00:00:00.000Z',
  });
  assert.deepEqual(merged.models.map(row => row.id), ['anthropic/claude-opus-5-5']);
  assert.deepEqual(merged.excluded, [{ id: 'anthropic/claude-brand-new', provider: 'anthropic', reason: 'no saved price' }]);
});

test('a model without a price on disk never reaches the Start screen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'julia-models-test-'));
  try {
    writeFileSync(join(directory, 'models.json'), JSON.stringify({
      sweptAt: '2026-10-29T00:00:00.000Z',
      models: [{ id: 'anthropic/claude-brand-new', provider: 'anthropic', displayName: 'Claude Brand New' }],
      defaults: { mainSession: 'anthropic/claude-brand-new', shipping: 'anthropic/claude-brand-new', effort: 'large' },
    }));
    const saved = readModels({ directory });
    const picked = startModels(saved);
    assert.equal(picked.mainSession, null);
    assert.equal(picked.shipping, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('one model offered by two accounts shows once', () => {
  const rows = [
    { id: 'anthropic/claude-opus-5-5', provider: 'anthropic', displayName: 'Claude Opus 5.5', ...priced(4, 20) },
    { id: 'commandcode/claude-opus-5-5', provider: 'commandcode', displayName: 'Claude Opus 5.5', ...priced(4, 20) },
  ];
  assert.deepEqual(onePerName(rows).map(row => row.id), ['anthropic/claude-opus-5-5']);
});

test('an alias and its dated snapshot show once, and a clash at another price stays twice', () => {
  const rows = [
    { id: 'anthropic/claude-haiku-4-5-20251001', provider: 'anthropic', displayName: 'Claude Haiku 4.5', ...priced(1, 5) },
    { id: 'anthropic/claude-haiku-4-5', provider: 'anthropic', displayName: 'Claude Haiku 4.5', ...priced(1, 5) },
    { id: 'anthropic/claude-opus-4-5', provider: 'anthropic', displayName: 'Claude Opus 4.5', ...priced(5, 25) },
    { id: 'commandcode/claude-opus-4-5', provider: 'commandcode', displayName: 'Claude Opus 4.5', ...priced(9, 40) },
    { id: 'openai/gpt-6.1-sol', provider: 'openai', displayName: 'GPT-6.1 Sol', ...priced(2, 10) },
  ];
  const kept = onePerName(rows);
  const seenRows = kept.map(row => `${row.displayName} ${row.inputPerMillion}/${row.outputPerMillion}`);
  assert.equal(new Set(seenRows).size, seenRows.length, `the picker lists a row twice: ${seenRows.join(', ')}`);
  assert.equal(kept.filter(row => row.displayName === 'Claude Haiku 4.5').length, 1);
  assert.deepEqual(kept.filter(row => row.displayName === 'Claude Opus 4.5').map(row => row.id).sort(),
    ['anthropic/claude-opus-4-5', 'commandcode/claude-opus-4-5']);
});

test('the Start screen picks the saved defaults, and falls back when one is gone', () => {
  const directory = mkdtempSync(join(tmpdir(), 'julia-models-test-'));
  const saved = {
    sweptAt: '2026-10-29T00:00:00.000Z',
    accounts: [],
    models: [
      { id: 'openai/gpt-6.1-sol', provider: 'openai', displayName: 'GPT-6.1 Sol', ...priced(2, 10) },
      { id: 'anthropic/claude-opus-5-5', provider: 'anthropic', displayName: 'Claude Opus 5.5', ...priced(4, 20) },
    ],
    defaults: { mainSession: 'openai/gpt-6.1-sol', shipping: 'anthropic/claude-retired-5', effort: 'medium' },
  };
  try {
    writeFileSync(join(directory, 'models.json'), JSON.stringify(saved));
    const picked = startModels(readModels({ directory }));
    assert.equal(picked.mainSession.id, 'openai/gpt-6.1-sol');
    assert.equal(picked.shipping.id, 'anthropic/claude-opus-5-5');
    assert.equal(picked.effort, 'medium');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    write({ sweptAt: '2026-10-01T00:00:00.000Z', models: [{ id: 'a/b', ...priced(1, 2) }] });
    assert.equal(readModels({ directory, now: new Date('2026-10-29T00:00:00.000Z') }).status, 'stale');
    write({ sweptAt: '2026-10-28T00:00:00.000Z', models: [{ id: 'a/b', ...priced(1, 2) }] });
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
