// Validates the four delivery role model selections and runtime limits.
// Per JUL-225 and ADR 0021, the checked-in static model catalog is no longer
// the authority for available models or defaults; live connections and $models
// manage live discovery and role defaults.
import { readFile } from 'node:fs/promises';

const ROLES = Object.freeze(['builder', 'reviewer']);
const HARNESSES = new Set(['claude-code', 'codex', 'omp', 'agy', 'cursor', 'custom']);
const CONNECTION_FIELDS = Object.freeze(['provider', 'endpoint', 'protocol', 'authReference']);

export const ADR_0021_LIMITS = Object.freeze({
  builder: Object.freeze({ maxTotalUsd: 2.00, activeMinutesCap: 90, scope: 'card' }),
  reviewer: Object.freeze({ maxTotalUsd: 1.00, activeMinutesCap: 30, scope: 'card' }),
  crashFixer: Object.freeze({ maxTotalUsd: 0.50, activeMinutesCap: 20, scope: 'incident' }),
  fixReviewer: Object.freeze({ maxTotalUsd: 0.25, activeMinutesCap: 10, scope: 'incident' }),
});

function reject(reason) {
  throw new Error(`delivery-tool settings: ${reason}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export function canonicalMaker(value) {
  return value ? value.trim().toLowerCase() : '';
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
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
  if (!['native', 'api', 'acp', 'sdk'].includes(connection.route)) reject(`${label} connection route must be native or api`);
  for (const field of CONNECTION_FIELDS) {
    if (!(field in connection)) reject(`${label} connection must include ${field}`);
  }
  if (connection.route === 'native') {
    for (const field of CONNECTION_FIELDS) {
      if (connection[field] !== null) reject(`${label} native connection must explicitly use null for ${field}`);
    }
    return;
  }
  if (connection.route === 'acp' || connection.route === 'sdk') {
    return;
  }
  for (const field of CONNECTION_FIELDS) {
    if (!nonEmptyString(connection[field])) reject(`${label} API connection requires ${field}`);
  }
  const endpoint = parseHttpUrl(connection.endpoint);
  if (!endpoint) reject(`${label} API connection endpoint must be an absolute HTTP(S) URL`);
  if (endpoint.username || endpoint.password) reject(`${label} API connection endpoint must not contain credentials`);
}

function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) reject('catalog must be a non-empty array');
  const ids = new Set();
  for (const [index, entry] of catalog.entries()) {
    if (!isObject(entry)) reject(`catalog entry ${index + 1} must be an object`);
    const label = catalogLabel(entry, index);
    checkKeys(entry, ['id', 'displayName', 'executableModelId', 'maker', 'harness', 'thinking', 'connection', 'route', 'service'], label);
    if (!nonEmptyString(entry.id) || /\s/.test(entry.id)) reject(`${label} ID must be a non-empty string without spaces`);
    if (ids.has(entry.id)) reject(`duplicate catalog ID "${entry.id}"`);
    ids.add(entry.id);
    for (const field of ['displayName', 'maker']) {
      if (!nonEmptyString(entry[field])) reject(`${label} ${field} must be a non-empty string`);
    }
    if (!nonEmptyString(entry.harness) || !HARNESSES.has(entry.harness)) reject(`${label} has unknown harness ${JSON.stringify(entry.harness)}`);
    if (!nonEmptyString(entry.executableModelId)
      && !(entry.executableModelId === null && ['codex', 'agy', 'cursor'].includes(entry.harness) && (entry.connection?.route === 'native' || entry.connection?.route === 'acp' || entry.connection?.route === 'sdk'))) {
      reject(`${label} executableModelId must be a non-empty string, or null for a supported native CLI default`);
    }
    if (entry.thinking) validateThinking(entry.thinking, label);
    if (entry.connection) validateConnection(entry.connection, label);
  }
  return catalog;
}

export function resolveCatalogEntry(catalog, reference, { route = null, service = null } = {}) {
  let matches = catalog.filter((entry) => entry.id === reference || entry.displayName === reference);
  if (matches.length === 0) {
    matches = catalog.filter((entry) => {
      const baseId = entry.id.includes(':') ? entry.id.split(':')[0] : entry.id;
      return baseId === reference;
    });
  }
  if (matches.length > 1 && route) {
    const routeFiltered = matches.filter((entry) => (entry.route || entry.connection?.route) === route);
    if (routeFiltered.length > 0) matches = routeFiltered;
  }
  if (matches.length > 1 && service) {
    const serviceFiltered = matches.filter((entry) => (entry.service || entry.connection?.provider) === service);
    if (serviceFiltered.length > 0) matches = serviceFiltered;
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) reject(`catalog reference ${JSON.stringify(reference)} is ambiguous`);
  return matches[0];
}

function validateRole(role, choice, catalog) {
  if (!isObject(choice)) reject(`${role} must name a model and thinking level`);
  checkKeys(choice, ['model', 'thinking', 'route', 'service', 'connectionId', 'maker'], role);
  if (!nonEmptyString(choice.model)) reject(`${role} model must be a non-empty exact catalog ID or display name`);
  const model = resolveCatalogEntry(catalog, choice.model, { route: choice.route, service: choice.service });
  if (!model) reject(`${role} model reference ${JSON.stringify(choice.model)} is unknown`);

  const thinking = choice.thinking === undefined ? model.thinking?.default : choice.thinking;
  if (model.thinking?.supported === false) {
    if (thinking !== null && thinking !== undefined) reject(`${role} model ${JSON.stringify(model.id)} does not support thinking`);
  } else if (model.thinking?.supported && Array.isArray(model.thinking.supported) && !model.thinking.supported.includes(thinking)) {
    reject(`${role} thinking ${JSON.stringify(thinking)} is not supported by catalog entry ${JSON.stringify(model.id)}`);
  }
  return { role, model, thinking };
}

function validateReviewerRunLimits(limits) {
  if (!isObject(limits)) reject('reviewerRunLimits must be an object');
  checkKeys(limits, ['maxTotalUsd', 'outputTokenCap'], 'reviewerRunLimits');
  if (!Number.isFinite(limits.maxTotalUsd) || limits.maxTotalUsd < 0) reject('reviewerRunLimits maxTotalUsd must be a non-negative number');
  if (limits.outputTokenCap !== null) reject('reviewerRunLimits outputTokenCap must be null');
  return { maxTotalUsd: limits.maxTotalUsd, outputTokenCap: null };
}

export function validateDeliveryToolSettings(settings, { allowSameService = false } = {}) {
  if (!isObject(settings)) reject('must be an object');
  checkKeys(settings, [
    'catalog', 'reviewerRunLimits', 'adr0021Limits',
    ...ROLES, 'recoveryReviewer', 'crashFixer', 'fixReviewer',
    'crash-fixer', 'fix-reviewer',
    '$notice', '_comment', 'notice',
  ], 'settings');
  const catalog = validateCatalog(settings.catalog);
  const resolved = Object.fromEntries(ROLES.map((role) => [role, validateRole(role, settings[role], catalog)]));

  // Builder and reviewer cross-company/service check (Criterion 6)
  const bMaker = canonicalMaker(resolved.builder.model.maker);
  const rMaker = canonicalMaker(resolved.reviewer.model.maker);
  const bService = canonicalMaker(resolved.builder.model.service || resolved.builder.model.connection?.provider);
  const rService = canonicalMaker(resolved.reviewer.model.service || resolved.reviewer.model.connection?.provider);
  const sameMaker = bMaker && rMaker && bMaker === rMaker;
  const sameService = bService && rService && bService === rService;

  if (sameMaker) {
    reject(`builder and reviewer both resolve to maker ${JSON.stringify(resolved.builder.model.maker)}; they must use different makers; builder and reviewer are from the same company; using the same service requires an explicit per-run decision (--allow-same-service), but same company is never permitted`);
  }
  if (sameService && !allowSameService) {
    reject(`builder and reviewer are from the same service; using the same service requires an explicit per-run decision (--allow-same-service)`);
  }

  // Crash-fixer and fix-reviewer roles (Criterion 7)
  const rawCrashFixer = settings.crashFixer || settings['crash-fixer'];
  const crashFixer = rawCrashFixer ? validateRole('crashFixer', rawCrashFixer, catalog) : null;

  const rawFixReviewer = settings.fixReviewer || settings['fix-reviewer'] || settings.recoveryReviewer
    || (catalog.some(entry => entry.id === 'google-gemini-recovery-reviewer') && settings.recoveryReviewer !== null && settings.fixReviewer === undefined && settings['fix-reviewer'] === undefined ? { model: 'google-gemini-recovery-reviewer' } : null);
  const fixReviewer = rawFixReviewer ? validateRole('fixReviewer', rawFixReviewer, catalog) : null;

  if (crashFixer && fixReviewer) {
    if (canonicalMaker(crashFixer.model.maker) === canonicalMaker(fixReviewer.model.maker)) {
      reject(`crash-fixer (${crashFixer.model.maker}) and fix reviewer (${fixReviewer.model.maker}) must be from different companies`);
    }
  }

  return {
    ...resolved,
    ...(crashFixer ? { crashFixer } : {}),
    ...(fixReviewer ? { fixReviewer, recoveryReviewer: fixReviewer } : {}),
    reviewerRunLimits: settings.reviewerRunLimits ? validateReviewerRunLimits(settings.reviewerRunLimits) : { maxTotalUsd: 1.0, outputTokenCap: null },
    limits: ADR_0021_LIMITS,
  };
}

export async function loadDeliveryToolSettings(path, { read = readFile, allowSameService = false } = {}) {
  let settings;
  try {
    settings = JSON.parse(await read(path, 'utf8'));
  } catch {
    reject(`could not read delivery-tool settings from ${path}`);
  }
  return validateDeliveryToolSettings(settings, { allowSameService });
}
