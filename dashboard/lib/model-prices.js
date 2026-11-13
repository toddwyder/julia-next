// One price list for the picker and the run's spending total.
//
// Mastra keeps a copy of the models.dev price list and refreshes it daily when
// MASTRA_AUTO_REFRESH_PRICING is on. This module reads that copy (the refresh cache, or the
// list bundled with the installed program) instead of scraping provider price pages. The
// corrections file holds only the things models.dev gets wrong or leaves out: DeepSeek's
// peak-hour rate and the free CommandCode model.

import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = dirname(here);
const require = createRequire(import.meta.url);

export const DEFAULT_CORRECTIONS = join(dashboardRoot, 'config', 'price-corrections.json');
export const CACHE_FILE = join(homedir(), '.cache', 'mastra', 'pricing-data.json');
const MIN_PRICED_MODELS = 1000;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const METRIC_RATES = Object.freeze({
  'mastra_model_input_text_tokens': 'input',
  'mastra_model_input_image_tokens': 'input',
  'mastra_model_input_audio_tokens': 'input',
  'mastra_model_input_cache_read_tokens': 'cacheRead',
  'mastra_model_input_cache_write_tokens': 'cacheWrite',
  'mastra_model_output_text_tokens': 'output',
  'mastra_model_output_reasoning_tokens': 'output',
  'mastra_model_output_image_tokens': 'output',
  'mastra_model_output_audio_tokens': 'output',
});

function normalizeProvider(provider) {
  const text = String(provider ?? '').toLowerCase();
  // Mastra's trace rows name the endpoint `commandcode.chat`; a model id may say
  // `mastracode/commandcode`.
  const withoutEndpoint = text.replace(/\.[a-z0-9_-]+$/, '');
  return withoutEndpoint.split('/').filter(Boolean).at(-1) ?? '';
}

export function normalizeModel(model) {
  return String(model ?? '')
    .toLowerCase()
    .replace(/:free$/, '')
    .replace(/\./g, '-')
    .replace(/-latest$/, '')
    .replace(/-preview$/, '')
    .replace(/-experimental$/, '')
    .replace(/-exp$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-\d{8}$/, '');
}

function countModels(costs) {
  let count = 0;
  for (const provider of Object.values(costs ?? {})) count += Object.keys(provider?.models ?? {}).length;
  return count;
}

function normalizeCatalog(data) {
  const costs = data?.costs ?? data;
  if (!costs || typeof costs !== 'object') throw new Error('the Mastra price list has no costs');
  return costs;
}

function bundledCandidates(env = process.env) {
  const relative = join('node_modules', '@mastra', 'observability', 'dist', 'metrics', 'pricing-data.json');
  const candidates = [];
  try {
    candidates.push(join(dirname(require.resolve('@mastra/observability/package.json')), 'dist', 'metrics', 'pricing-data.json'));
  } catch {
    // The dashboard does not depend on @mastra/observability, so this can miss.
  }
  for (const root of [
    env.MASTRACODE_PROGRAM_DIR,
    env.MASTRACODE_PROGRAM,
    join(homedir(), '.local', 'lib', 'node_modules', 'mastracode'),
    '/usr/local/lib/node_modules/mastracode',
    '/usr/lib/node_modules/mastracode',
  ].filter(Boolean)) {
    candidates.push(join(root, relative));
  }
  return candidates;
}

function readCatalogFile(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const costs = normalizeCatalog(data);
  if (countModels(costs) < MIN_PRICED_MODELS) {
    throw new Error(`${path} holds fewer than ${MIN_PRICED_MODELS} priced models, so it is not a usable list`);
  }
  return {
    costs,
    source: path,
    readAt: statSync(path).mtime.toISOString(),
  };
}

// The refresh cache is the current list. The bundled copy is the same list one install older,
// and it keeps the sweep working before the first refresh has run.
export function loadCatalog({ env = process.env, cacheFile, bundledFile } = {}) {
  const explicit = env.MASTRA_PRICING_DATA || bundledFile;
  const files = [explicit, cacheFile ?? CACHE_FILE, ...bundledCandidates(env)].filter(Boolean);
  const problems = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      return readCatalogFile(file);
    } catch (error) {
      problems.push(error.message);
    }
  }
  throw new Error(`No Mastra price list was readable. Looked at ${files.join(', ')}.${problems.length ? ` ${problems.join('; ')}` : ''}`);
}

export function readCorrections({ file = DEFAULT_CORRECTIONS, env = process.env } = {}) {
  const path = env.PRICE_CORRECTIONS || file;
  if (!existsSync(path)) return { peakWindows: [], freeModels: [], excludeDates: [], overrides: {}, source: null };
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return {
    peakWindows: Array.isArray(data.peakWindows) ? data.peakWindows : [],
    freeModels: Array.isArray(data.freeModels) ? data.freeModels : [],
    excludeDates: Array.isArray(data.excludeDates) ? data.excludeDates : [],
    overrides: data.overrides && typeof data.overrides === 'object' ? data.overrides : {},
    source: path,
  };
}

function indexFor(catalog, provider) {
  const bucket = catalog.costs?.[provider]?.models ?? {};
  const index = new Map();
  for (const [key, entry] of Object.entries(bucket)) index.set(normalizeModel(key), { key, entry });
  return index;
}

function indexOf(catalog, provider) {
  catalog.indexes ??= new Map();
  if (!catalog.indexes.has(provider)) catalog.indexes.set(provider, indexFor(catalog, provider));
  return catalog.indexes.get(provider);
}

export function findCost(catalog, provider, model) {
  if (!catalog) return null;
  const name = normalizeProvider(provider);
  let index = indexOf(catalog, name);
  if (index.size === 0) {
    // Some accounts answer to `mastracode/commandcode`; the catalog only knows `commandcode`.
    const tail = String(provider ?? '').toLowerCase().split('/').filter(Boolean).at(-1);
    if (tail && tail !== name) index = indexOf(catalog, tail);
  }
  const wanted = normalizeModel(model);
  const exact = index.get(wanted);
  if (exact) return exact.entry;
  let best = null;
  for (const [key, value] of index) {
    if (!wanted.startsWith(`${key}-`)) continue;
    // `deepseek-v4.1-flash-1017-cm` is the same model as `deepseek-v4.1-flash`. A build or
    // date suffix starts with four digits; `claude-opus-5` must not capture `claude-opus-5-5`.
    if (!/^\d{4}/.test(wanted.slice(key.length + 1))) continue;
    if (!best || key.length > best.key.length) best = { key, entry: value.entry };
  }
  return best?.entry ?? null;
}

function minutesOf(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function peakMultiplier(corrections, provider, model, at) {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const day = DAYS[date.getUTCDay()];
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const dateKey = date.toISOString().slice(0, 10);
  if (corrections.excludeDates?.includes(dateKey)) return null;
  for (const window of corrections.peakWindows ?? []) {
    if (window.provider && normalizeProvider(window.provider) !== normalizeProvider(provider)) continue;
    if (window.modelPrefix && !String(model).toLowerCase().startsWith(String(window.modelPrefix).toLowerCase())) continue;
    if (Array.isArray(window.days) && !window.days.includes(day)) continue;
    const from = minutesOf(window.from);
    const to = minutesOf(window.to);
    if (from === null || to === null) continue;
    const inWindow = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    if (inWindow) return Number(window.multiplier ?? 1);
  }
  return null;
}

function isListedFree(corrections, provider, model) {
  const wanted = `${normalizeProvider(provider)}/${String(model).toLowerCase()}`;
  return (corrections.freeModels ?? []).some(entry => String(entry).toLowerCase() === wanted);
}

function baseRates(cost) {
  if (!cost) return null;
  const input = Number(cost.input);
  const output = Number(cost.output);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return {
    input,
    output,
    cacheRead: Number.isFinite(Number(cost.cache_read)) ? Number(cost.cache_read) : input,
    cacheWrite: Number.isFinite(Number(cost.cache_write)) ? Number(cost.cache_write) : input,
  };
}

function tiersOf(cost) {
  if (!Array.isArray(cost?.tiers)) return [];
  return cost.tiers
    .map(tier => ({ size: Number(tier?.tier?.size), rates: baseRates(tier) }))
    .filter(tier => Number.isFinite(tier.size) && tier.rates)
    .sort((a, b) => b.size - a.size);
}

function overrideCost(corrections, provider, model) {
  const wanted = `${normalizeProvider(provider)}/${String(model).toLowerCase()}`;
  for (const [key, cost] of Object.entries(corrections.overrides ?? {})) {
    if (String(key).toLowerCase() === wanted) return cost;
  }
  return null;
}

// `at` is the moment being priced. The picker leaves it out so it shows the base rate the
// provider advertises; the spending total passes each call's timestamp so peak hours count.
export function priceFor({ catalog, corrections = {}, provider, model, at = null }) {
  const override = overrideCost(corrections, provider, model);
  const cost = override ? { cost: override } : findCost(catalog, provider, model);
  const listedFree = isListedFree(corrections, provider, model);
  const rates = baseRates(cost?.cost);
  if (!rates && !listedFree) return null;
  const free = listedFree || (rates?.input === 0 && rates?.output === 0);
  const multiplier = free || !at ? 1 : (peakMultiplier(corrections, provider, model, at) ?? 1);
  const base = rates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const scaled = value => value * multiplier;
  return {
    provider: normalizeProvider(provider),
    model: String(model),
    inputPerMillion: scaled(base.input),
    outputPerMillion: scaled(base.output),
    cacheReadPerMillion: scaled(base.cacheRead),
    cacheWritePerMillion: scaled(base.cacheWrite),
    tiers: tiersOf(cost?.cost).map(tier => ({
      size: tier.size,
      inputPerMillion: scaled(tier.rates.input),
      outputPerMillion: scaled(tier.rates.output),
      cacheReadPerMillion: scaled(tier.rates.cacheRead),
      cacheWritePerMillion: scaled(tier.rates.cacheWrite),
    })),
    free,
    peak: multiplier > 1,
    source: override ? 'the corrections file' : `${catalog.source} (models.dev)`,
  };
}

export function ratesForTokens(price, totalInput = 0) {
  const tier = (price.tiers ?? []).find(row => totalInput >= row.size) ?? null;
  return tier ?? {
    inputPerMillion: price.inputPerMillion,
    outputPerMillion: price.outputPerMillion,
    cacheReadPerMillion: price.cacheReadPerMillion,
    cacheWritePerMillion: price.cacheWritePerMillion,
  };
}

// Component metric rows are priced on their own rate. The total rows already include the
// components, so they are used only when a call has no component rows: summing every row would
// count the same tokens twice.
export function costOfTokens({ price, tokens = {} }) {
  const number = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const totalInput = number(tokens.totalInput)
    || number(tokens.inputText) + number(tokens.cacheRead) + number(tokens.cacheWrite);
  const totalOutput = number(tokens.totalOutput)
    || number(tokens.outputText) + number(tokens.outputReasoning);
  const hasComponents = ['inputText', 'cacheRead', 'cacheWrite'].some(name => number(tokens[name]) > 0)
    || ['outputText', 'outputReasoning'].some(name => number(tokens[name]) > 0);
  const rates = ratesForTokens(price, totalInput);
  let usd = 0;
  if (price.free) return { usd: 0, pricedBy: price.source, peak: false, free: true };
  if (hasComponents) {
    usd += number(tokens.inputText) * rates.inputPerMillion;
    usd += number(tokens.cacheRead) * rates.cacheReadPerMillion;
    usd += number(tokens.cacheWrite) * rates.cacheWritePerMillion;
    usd += (number(tokens.outputText) + number(tokens.outputReasoning)) * rates.outputPerMillion;
  } else {
    usd += totalInput * rates.inputPerMillion;
    usd += totalOutput * rates.outputPerMillion;
  }
  return { usd: usd / 1_000_000, pricedBy: price.source, peak: price.peak === true, free: false };
}

function tokenField(name) {
  const rate = METRIC_RATES[name];
  if (!rate) return null;
  if (rate === 'input') return 'inputText';
  if (rate === 'cacheRead') return 'cacheRead';
  if (rate === 'cacheWrite') return 'cacheWrite';
  return 'outputText';
}

function reasoningField(name) {
  return name === 'mastra_model_output_reasoning_tokens' ? 'outputReasoning' : null;
}

// Prices one run from its metric rows. A call is one spanId; its timestamp picks the peak or
// off-peak rate. If any call has no price, the total is unknown rather than an undercount.
export function costFromMetrics(metricRows, { catalog = null, corrections = {}, at } = {}) {
  const groups = new Map();
  for (const row of metricRows ?? []) {
    const key = row.spanId ?? `${row.provider ?? ''}|${row.model ?? ''}|${row.timestamp ?? ''}`;
    const group = groups.get(key) ?? {
      spanId: key,
      provider: row.provider,
      model: row.model,
      at: row.timestamp,
      tokens: {},
    };
    group.provider ??= row.provider;
    group.model ??= row.model;
    if (group.at === undefined) group.at = row.timestamp;
    const name = String(row.name ?? '');
    const field = tokenField(name) ?? reasoningField(name);
    if (field) {
      group.tokens[field] = (group.tokens[field] ?? 0) + Number(row.value ?? 0);
    } else if (name === 'mastra_model_total_input_tokens') {
      group.tokens.totalInput = (group.tokens.totalInput ?? 0) + Number(row.value ?? 0);
    } else if (name === 'mastra_model_total_output_tokens') {
      group.tokens.totalOutput = (group.tokens.totalOutput ?? 0) + Number(row.value ?? 0);
    }
    groups.set(key, group);
  }

  const unpriced = [];
  let usd = 0;
  let calls = 0;
  for (const group of groups.values()) {
    const price = priceFor({
      catalog,
      corrections,
      provider: group.provider,
      model: group.model,
      at: at ?? group.at ?? new Date(),
    });
    if (!price) {
      unpriced.push(`${group.provider ?? 'unknown'}/${group.model ?? 'unknown'}`);
      continue;
    }
    calls += 1;
    usd += costOfTokens({ price, tokens: group.tokens }).usd;
  }
  return {
    usd: unpriced.length || calls === 0 ? null : usd,
    calls,
    unpriced: [...new Set(unpriced)],
  };
}
