import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_STATE_DIR = '/var/lib/julia-dashboard';
export const STALE_AFTER_MS = 8 * 24 * 60 * 60 * 1000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, name) => {
      if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
      if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
      return ENTITIES[name.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMoney(value) {
  const number = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function cardPrice(card, label) {
  const at = card.indexOf(`>${label}</p>`);
  if (at === -1) return null;
  const value = card.slice(at, at + 800).match(/\$([\d.,]+)/);
  return parseMoney(value?.[1]);
}

export function parseAnthropicPrices(body) {
  const cards = String(body).split(/modelName[^>]*>/i).slice(1);
  const rows = [];
  const seen = new Set();
  for (const card of cards) {
    const name = card.match(/^([^<]+)</)?.[1]?.trim();
    if (!name || seen.has(name)) continue;
    const input = cardPrice(card, 'Input');
    const output = cardPrice(card, 'Output');
    if (input === null || output === null) continue;
    seen.add(name);
    rows.push({ name, inputPerMillion: input, outputPerMillion: output });
  }
  return rows;
}

function unwrap(value) {
  return Array.isArray(value) && value.length === 2 && value[0] === 0 ? value[1] : value;
}

export function parseOpenAIPrices(body) {
  const html = String(body);
  const rows = [];
  const seen = new Set();
  const propsPattern = /props="([^"]+)"/g;
  for (const match of html.matchAll(propsPattern)) {
    let props;
    try {
      props = JSON.parse(htmlToText(match[1]));
    } catch {
      continue;
    }
    if (unwrap(props?.tier) !== 'standard' || !Array.isArray(props?.rows)) continue;
    for (const entry of props.rows[1] ?? []) {
      const cells = entry?.[1];
      if (!Array.isArray(cells)) continue;
      const name = unwrap(cells[0]);
      if (typeof name !== 'string') continue;
      const numbers = cells.slice(1).map(unwrap).filter(value => typeof value === 'number');
      if (numbers.length < 2) continue;
      const displayName = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (seen.has(displayName)) continue;
      seen.add(displayName);
      rows.push({ name: displayName, inputPerMillion: numbers[0], outputPerMillion: numbers.at(-1) });
    }
  }
  return rows;
}

export function parseCommandCodePrices(body) {
  const rows = [];
  const seen = new Set();
  for (const chunk of String(body).split(/role="row"/).slice(1)) {
    const name = chunk.match(/<span class="[^"]*\btruncate\b[^"]*"[^>]*>([^<]{2,60})<\/span>/)?.[1];
    if (!name) continue;
    const cells = [...chunk.matchAll(/\$[\d.,]+|Free/g)].map(match => match[0]);
    if (cells.length < 2) continue;
    const clean = name.replace(/\s*\(latest\)$/i, '').trim();
    if (seen.has(clean)) continue;
    const input = /^free$/i.test(cells[0]) ? 0 : parseMoney(cells[0]);
    const output = /^free$/i.test(cells[1]) ? 0 : parseMoney(cells[1]);
    if (input === null || output === null) continue;
    seen.add(clean);
    rows.push({ name: clean, inputPerMillion: input, outputPerMillion: output });
  }
  return rows;
}

export const PARSERS = Object.freeze({
  anthropic: parseAnthropicPrices,
  openai: parseOpenAIPrices,
  commandcode: parseCommandCodePrices,
});

export function parsePrices(parserName, body, label = parserName) {
  const parser = PARSERS[parserName];
  if (!parser) throw new Error(`unknown price parser: ${parserName}`);
  const rows = parser(body).map(row => ({
    ...row,
    free: row.inputPerMillion === 0 && row.outputPerMillion === 0,
  }));
  if (rows.length === 0) {
    throw new Error(`the ${label} price page returned no models. The page changed shape.`);
  }
  return rows;
}

export function priceKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(latest|preview|experimental|exp)\b/g, ' ')
    .replace(/[^a-z0-9.]/g, '')
    .replace(/\./g, '')
    .replace(/^claude/, '');
}

export function findPrice(model, rows) {
  const names = new Set();
  if (model.modelName) {
    names.add(model.modelName);
    names.add(model.modelName.split('/').at(-1));
  }
  const idTail = String(model.id).split('/').slice(1);
  if (idTail.length > 1) {
    names.add(idTail.join('/'));
    names.add(idTail.at(-1));
  }
  const keys = [...names].map(priceKey).filter(Boolean);
  const matches = (key, candidate) => {
    if (key === candidate) return true;
    if (candidate.length >= 6 && key.startsWith(candidate) && /^\d{6,}$/.test(key.slice(candidate.length))) return true;
    if (key.length >= 6 && candidate.startsWith(key) && /^\d{6,}$/.test(candidate.slice(key.length))) return true;
    return false;
  };
  for (const row of rows) {
    const key = priceKey(row.name);
    if (keys.includes(key)) return row;
  }
  for (const row of rows) {
    const key = priceKey(row.name);
    if (keys.some(candidate => matches(candidate, key))) return row;
  }
  return null;
}

function prettyFromSlug(slug) {
  const dated = String(slug).match(/^(.*?)-(\d{4}-\d{2}-\d{2})$/);
  const base = dated ? dated[1] : String(slug);
  const suffix = dated ? ` (${dated[2]})` : '';
  const [head, ...rest] = base.split('-');
  const capitalised = rest.map(word => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`);
  if (/^gpt$/i.test(head)) return `GPT-${[base.split('-')[1], ...capitalised.slice(1)].filter(Boolean).join(' ')}${suffix}`;
  if (/^o\d/i.test(head)) return [head, ...capitalised].join(' ') + suffix;
  return [head[0]?.toUpperCase() + head.slice(1), ...capitalised].join(' ') + suffix;
}

export function displayName(model, priceRow) {
  const rowName = priceRow?.name;
  if (rowName) {
    if (model.provider === 'anthropic' && !/^claude\b/i.test(rowName)) return `Claude ${rowName}`;
    if (model.provider === 'openai') return prettyFromSlug(rowName);
    return rowName;
  }
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

export function mergeSweep({ previousModels = [], available, pricesByProvider, readAt, defaultIds = {} }) {
  const models = [];
  const excluded = [];
  const added = [];
  const kept = new Set();
  for (const model of available) {
    if (kept.has(model.id)) continue;
    const rows = pricesByProvider[model.provider] ?? [];
    const price = findPrice(model, rows);
    if (!price) {
      excluded.push({ id: model.id, provider: model.provider, reason: 'no saved price' });
      continue;
    }
    kept.add(model.id);
    models.push({
      id: model.id,
      provider: model.provider,
      name: model.modelName,
      displayName: displayName(model, price),
      inputPerMillion: price.inputPerMillion,
      outputPerMillion: price.outputPerMillion,
      free: price.free === true,
      priceSource: price.source,
      priceReadAt: readAt,
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
  return { models, excluded, added, retired, defaults };
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

// Mastra Code lists one model under several ids: an alias beside its dated snapshot
// (claude-haiku-4-5 and claude-haiku-4-5-20251001), and the same model again under a second
// provider when two accounts can run it. Those are one model at one price, so the screen keeps
// the shortest id and drops the rest. A name at two different prices stays twice, because
// picking one spends a different account's money.
export function onePerName(models = []) {
  const kept = new Map();
  for (const model of models) {
    const name = model.displayName ?? displayName(model);
    const price = model.free ? 'free' : `${model.inputPerMillion}/${model.outputPerMillion}`;
    const key = `${name}\u0000${price}`;
    const seen = kept.get(key);
    if (!seen || String(model.id).length < String(seen.id).length) {
      kept.set(key, { ...model, displayName: name });
    }
  }
  return [...kept.values()];
}

export function startModels(saved) {
  // Only a model the sweep recorded a price for may reach the screen, even if the file was
  // edited by hand. A free model is priced at zero, so it counts as priced.
  const priced = (saved.models ?? []).filter(model => model.free === true
    || (Number.isFinite(model.inputPerMillion) && Number.isFinite(model.outputPerMillion)));
  const byId = new Map(priced.map(model => [model.id, model]));
  const mainSession = byId.get(saved.defaults?.mainSession) ?? priced[0] ?? null;
  const shipping = byId.get(saved.defaults?.shipping)
    ?? priced.find(model => model.id !== mainSession?.id)
    ?? null;
  const effort = saved.defaults?.effort ?? 'large';
  return { mainSession, shipping, effort };
}
