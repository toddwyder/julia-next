import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { priceFor } from './model-prices.js';

export const DEFAULT_STATE_DIR = '/var/lib/julia-dashboard';
export const STALE_AFTER_MS = 8 * 24 * 60 * 60 * 1000;

function prettyFromSlug(slug) {
  const dated = String(slug).match(/^(.*?)-(\d{4}-\d{2}-\d{2}|\d{8})$/);
  const base = dated ? dated[1] : String(slug);
  const suffix = dated ? ` (${dated[2]})` : '';
  const words = base.split('/').at(-1).split('-').filter(Boolean);
  const [head, ...rest] = words;
  const capitalised = rest.map(word => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`);
  const joined = [...capitalised];
  if (joined.length >= 2 && /^\d{1,2}$/.test(joined.at(-2)) && /^\d{1,2}$/.test(joined.at(-1))) {
    joined.splice(-2, 2, `${joined.at(-2)}.${joined.at(-1)}`);
  }
  if (/^gpt$/i.test(head)) return `GPT-${joined.join(' ')}${suffix}`;
  if (/^o\d/i.test(head)) return [head.toLowerCase(), ...joined].join(' ') + suffix;
  const brand = /^deepseek$/i.test(head) ? 'DeepSeek' : head[0]?.toUpperCase() + head.slice(1);
  return [brand, ...joined].join(' ') + suffix;
}

export function displayName(model) {
  return prettyFromSlug(model.modelName ?? model.id);
}

export function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(4)));
}

export function priceLabel(model) {
  if (!model) return '';
  if (model.free === true) return 'Free';
  if (!Number.isFinite(model.inputPerMillion) || !Number.isFinite(model.outputPerMillion)) return '';
  return `↓$${formatMoney(model.inputPerMillion)}/$${formatMoney(model.outputPerMillion)}↑`;
}

// The sweep records which models each account offers. Prices are not saved, because the picker
// asks the price list on every page load: a price models.dev corrects today shows up on the next
// reload rather than waiting for the Monday sweep.
export function mergeSweep({ previousModels = [], available, defaultIds = {} }) {
  const models = [];
  const added = [];
  const kept = new Set();
  for (const model of available) {
    if (kept.has(model.id)) continue;
    kept.add(model.id);
    models.push({
      id: model.id,
      provider: model.provider,
      name: model.modelName,
      displayName: displayName(model),
    });
  }
  const before = new Set(previousModels.map(model => model.id));
  for (const model of models) {
    if (!before.has(model.id)) added.push(model.id);
  }
  const retired = [...before].filter(id => !kept.has(id));
  const byId = new Map(models.map(model => [model.id, model]));
  const defaults = {};
  for (const [slot, id] of Object.entries(defaultIds)) {
    const chosen = byId.get(id) ?? models[0];
    if (chosen) defaults[slot] = chosen.id;
  }
  return { models, added, retired, defaults };
}

// Prices are looked up at page load, so the screen always shows the list Mastra refreshed today.
// A model the list cannot price is left off the screen: the card must never start on a model whose
// spending it cannot count.
export function pricedModels(models = [], { catalog = null, corrections = {} } = {}) {
  const rows = [];
  for (const model of models) {
    const price = priceFor({ catalog, corrections, provider: model.provider, model: model.modelName ?? model.name ?? model.id });
    if (!price) continue;
    rows.push({ ...model, displayName: displayName(model), price });
  }
  return rows;
}

export function stateDir(env = process.env) {
  // Everything the dashboard records sits under <DASHBOARD_STATE_DIR>/state (lib/state.js),
  // so a sweep must write beside build.json and watchdog.json, not in the root.
  return join(env.DASHBOARD_STATE_DIR || DEFAULT_STATE_DIR, 'state');
}

export function readModels({ directory = stateDir(), now = new Date() } = {}) {
  const path = join(directory, 'models.json');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing', path, models: [], defaults: {} };
    throw error;
  }
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return { status: 'missing', path, models: [], defaults: {}, problem: 'models.json is not readable JSON' };
  }
  const models = Array.isArray(saved.models) ? saved.models : [];
  const sweptAt = saved.sweptAt ? new Date(saved.sweptAt) : null;
  if (models.length === 0) return { status: 'empty', path, sweptAt, models: [], defaults: {} };
  const age = sweptAt ? now.getTime() - sweptAt.getTime() : Infinity;
  return {
    status: age > STALE_AFTER_MS ? 'stale' : 'ok',
    path,
    sweptAt,
    age,
    models,
    defaults: saved.defaults ?? {},
    accounts: saved.accounts ?? [],
  };
}

// An account can answer to more than one provider name. Mastra Code lists the CommandCode
// models as `commandcode/…` and, for the two in its model pack, as `mastracode/commandcode/…`.
export function accountProviders(account = {}) {
  const providers = account.providers ?? (account.provider ? [account.provider] : []);
  return providers.filter(Boolean);
}

