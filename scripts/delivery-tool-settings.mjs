// Delivery settings are deliberately declarative. This module resolves and
// validates them for a later runner; it never starts a coding harness.
import { readFile } from 'node:fs/promises';

const ROLES = Object.freeze(['builder', 'reviewer']);
const HARNESSES = new Set(['claude-code', 'codex', 'omp']);
const CONNECTION_FIELDS = Object.freeze(['provider', 'endpoint', 'protocol', 'authReference']);

function reject(reason) {
  throw new Error(`delivery-tool settings: ${reason}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function checkKeys(value, allowed, context) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) reject(`${context} contains unsupported setting "${extra}"`);
}

function catalogLabel(entry, index) {
  return nonEmptyString(entry?.id) ? `catalog entry "${entry.id}"` : `catalog entry ${index + 1}`;
}

function validateThinking(thinking, label) {
  if (!isObject(thinking)) reject(`${label} thinking must be an object`);
  checkKeys(thinking, ['supported', 'default'], `${label} thinking`);

  if (thinking.supported === false) {
    if (thinking.default !== null) reject(`${label} has unsupported thinking and must use a null default`);
    return;
  }
  if (!Array.isArray(thinking.supported) || thinking.supported.length === 0 || thinking.supported.some((level) => !nonEmptyString(level))) {
    reject(`${label} thinking supported must be a non-empty list or false`);
  }
  if (new Set(thinking.supported).size !== thinking.supported.length) reject(`${label} thinking levels must be unique`);
  if (!nonEmptyString(thinking.default) || !thinking.supported.includes(thinking.default)) {
    reject(`${label} has a default thinking level that is not supported`);
  }
}

function validateConnection(connection, label) {
  if (!isObject(connection)) reject(`${label} connection must be an object`);
  checkKeys(connection, ['route', ...CONNECTION_FIELDS], `${label} connection`);
  if (connection.route !== 'native' && connection.route !== 'api') reject(`${label} connection route must be native or api`);
  for (const field of CONNECTION_FIELDS) {
    if (!(field in connection)) reject(`${label} connection must include ${field}`);
  }
  if (connection.route === 'native') {
    for (const field of CONNECTION_FIELDS) {
      if (connection[field] !== null) reject(`${label} native connection must explicitly use null for ${field}`);
    }
    return;
  }
  for (const field of CONNECTION_FIELDS) {
    if (!nonEmptyString(connection[field])) reject(`${label} API connection requires ${field}`);
  }
  if (!isHttpUrl(connection.endpoint)) reject(`${label} API connection endpoint must be an absolute HTTP(S) URL`);
}

function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) reject('catalog must be a non-empty array');
  const ids = new Set();
  for (const [index, entry] of catalog.entries()) {
    if (!isObject(entry)) reject(`catalog entry ${index + 1} must be an object`);
    const label = catalogLabel(entry, index);
    checkKeys(entry, ['id', 'displayName', 'executableModelId', 'maker', 'harness', 'thinking', 'connection'], label);
    if (!nonEmptyString(entry.id) || /\s/.test(entry.id)) reject(`${label} ID must be a non-empty string without spaces`);
    if (ids.has(entry.id)) reject(`duplicate catalog ID "${entry.id}"`);
    ids.add(entry.id);
    for (const field of ['displayName', 'executableModelId', 'maker']) {
      if (!nonEmptyString(entry[field])) reject(`${label} ${field} must be a non-empty string`);
    }
    if (!nonEmptyString(entry.harness) || !HARNESSES.has(entry.harness)) reject(`${label} has unknown harness ${JSON.stringify(entry.harness)}`);
    validateThinking(entry.thinking, label);
    validateConnection(entry.connection, label);
  }
  return catalog;
}

function resolveCatalogEntry(catalog, reference) {
  const matches = catalog.filter((entry) => entry.id === reference || entry.displayName === reference);
  if (matches.length === 0) return null;
  if (matches.length > 1) reject(`catalog reference ${JSON.stringify(reference)} is ambiguous`);
  return matches[0];
}

function validateRole(role, choice, catalog) {
  if (!isObject(choice)) reject(`${role} must name a model and thinking level`);
  checkKeys(choice, ['model', 'thinking'], role);
  if (!nonEmptyString(choice.model)) reject(`${role} model must be a non-empty exact catalog ID or display name`);
  const model = resolveCatalogEntry(catalog, choice.model);
  if (!model) reject(`${role} model reference ${JSON.stringify(choice.model)} is unknown`);

  const thinking = choice.thinking === undefined ? model.thinking.default : choice.thinking;
  if (model.thinking.supported === false) {
    if (thinking !== null) reject(`${role} model ${JSON.stringify(model.id)} does not support thinking`);
  } else if (!model.thinking.supported.includes(thinking)) {
    reject(`${role} thinking ${JSON.stringify(thinking)} is not supported by catalog entry ${JSON.stringify(model.id)}`);
  }
  return { role, model, thinking };
}

export function validateDeliveryToolSettings(settings) {
  if (!isObject(settings)) reject('must be an object');
  checkKeys(settings, ['catalog', ...ROLES], 'settings');
  const catalog = validateCatalog(settings.catalog);
  const resolved = Object.fromEntries(ROLES.map((role) => [role, validateRole(role, settings[role], catalog)]));
  if (resolved.builder.model.maker === resolved.reviewer.model.maker) {
    reject(`builder and reviewer both resolve to maker ${JSON.stringify(resolved.builder.model.maker)}; they must use different makers`);
  }
  return resolved;
}

export async function loadDeliveryToolSettings(path, { read = readFile } = {}) {
  let settings;
  try {
    settings = JSON.parse(await read(path, 'utf8'));
  } catch {
    reject(`could not read delivery-tool settings from ${path}`);
  }
  return validateDeliveryToolSettings(settings);
}
