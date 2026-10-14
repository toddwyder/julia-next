// The local `$init` wrapper saves model/spend/start choices before dispatch.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { assertDeliveryPath } from './julia-delivery-candidate.mjs';
import { validateDeliveryToolSettings, ADR_0021_LIMITS } from './delivery-tool-settings.mjs';
import { authorizationReason } from './julia-delivery-runner.mjs';
import { startMastraDelivery } from './julia-mastra-delivery.mjs';
import { loadRoleDefaults, loadModelInventory } from './julia-models.mjs';
import { loadConnections } from './julia-connections.mjs';
import {
  verifyCardAdmission,
  formatLimitsDisplay,
  fetchCardFromLinear,
  parseInitCommand,
  SelectionRequiredError,
  refusalReason,
} from './julia-init-preflight.mjs';

export { parseInitCommand, SelectionRequiredError } from './julia-init-preflight.mjs';

function reject(message) {
  throw new Error(`$init: ${message}`);
}

async function readJson(path, { read = readFile } = {}) {
  try {
    return JSON.parse(await read(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(path, value, { write = writeFile, mkdirImpl = mkdir, renameImpl = rename } = {}) {
  await mkdirImpl(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await write(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await renameImpl(temporaryPath, path);
}

async function recordEvent(eventsPath, event, { append = appendFile, mkdirImpl = mkdir } = {}) {
  await mkdirImpl(dirname(eventsPath), { recursive: true });
  await append(eventsPath, `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`, 'utf8');
}

function snapshot(resolved) {
  const roles = [
    'builder',
    'reviewer',
    ...(resolved.crashFixer ? ['crashFixer'] : []),
    ...(resolved.fixReviewer ? ['fixReviewer'] : (resolved.recoveryReviewer ? ['recoveryReviewer'] : [])),
  ];
  return Object.fromEntries(roles.filter(role => resolved[role]).map((role) => {
    const { model, thinking } = resolved[role];
    return [role, {
      identity: model.id,
      model: model.executableModelId,
      maker: model.maker,
      ...(model.service ? { service: model.service } : {}),
      harness: model.harness,
      thinking,
      connection: { ...model.connection },
    }];
  }));
}

export function buildCatalogFromInventory(inventory, connections = []) {
  const counts = new Map();
  for (const m of inventory) {
    counts.set(m.id, (counts.get(m.id) || 0) + 1);
  }

  return inventory.map(m => {
    const conn = connections.find(c => c.id === m.connectionId) || {};
    const route = m.route || conn.type || 'acp';
    const isApi = route === 'api';
    const uniqueId = counts.get(m.id) > 1 ? `${m.id}:${route}` : m.id;

    return {
      id: uniqueId,
      displayName: m.routeLabel || m.name || m.id,
      executableModelId: m.executableModelId ?? (route === 'acp' && m.id === 'codex' ? null : m.id),
      maker: m.maker,
      service: m.service || conn.service || (isApi ? 'CommandCode' : (route === 'acp' ? 'Codex' : 'Antigravity')),
      route,
      harness: m.harness || (route === 'acp' ? 'codex' : (route === 'api' ? 'omp' : 'custom')),
      thinking: m.thinking || { supported: false, default: null },
      connection: m.connection || {
        route,
        provider: (conn.service || m.service || (isApi ? 'commandcode' : null))?.toLowerCase() || null,
        endpoint: conn.endpoint ?? (isApi ? (m.endpoint || 'https://api.commandcode.ai/provider/v1') : null),
        protocol: conn.protocol ?? (isApi ? 'openai-compatible' : null),
        authReference: conn.authReference ?? (isApi ? (m.authReference || 'COMMANDCODE_API_KEY') : null),
      },
    };
  });
}

function isStaleChoice(choice, catalog) {
  if (!choice || typeof choice !== 'object' || typeof choice.model !== 'string') return true;
  const matches = catalog.filter((entry) => entry.id === choice.model || entry.displayName === choice.model || (entry.id.includes(':') && entry.id.split(':')[0] === choice.model));
  if (matches.length !== 1) return true;
  const [model] = matches;
  if (model.thinking?.supported === false) return choice.thinking !== null;
  return model.thinking?.supported ? !model.thinking.supported.includes(choice.thinking) : false;
}

function resolveSelections(settings, defaults, explicit, { allowSameService = false } = {}) {
  const selected = {
    builder: explicit.builder ?? (defaults === null ? settings.builder : defaults?.builder),
    reviewer: explicit.reviewer ?? (defaults === null ? settings.reviewer : defaults?.reviewer),
    ...(explicit.crashFixer ? { crashFixer: explicit.crashFixer } : (defaults?.crashFixer ? { crashFixer: defaults.crashFixer } : (settings.crashFixer ? { crashFixer: settings.crashFixer } : {}))),
    ...(explicit.fixReviewer ? { fixReviewer: explicit.fixReviewer } : (defaults?.fixReviewer ? { fixReviewer: defaults.fixReviewer } : (settings.fixReviewer ? { fixReviewer: settings.fixReviewer } : (settings.recoveryReviewer ? { fixReviewer: settings.recoveryReviewer } : {})))),
  };

  try {
    const validated = validateDeliveryToolSettings({
      catalog: settings.catalog,
      reviewerRunLimits: settings.reviewerRunLimits,
      recoveryReviewer: settings.recoveryReviewer,
      ...selected,
    }, { allowSameService });
    return { selected, resolved: validated };
  } catch (error) {
    const allRoles = ['builder', 'reviewer', ...(selected.crashFixer ? ['crashFixer'] : []), ...(selected.fixReviewer ? ['fixReviewer'] : [])];
    const missing = allRoles.filter((role) => !explicit[role] && isStaleChoice(selected[role], settings.catalog));
    if (missing.length) throw new SelectionRequiredError(missing, selected);
    throw error;
  }
}

export async function runInit(command, {
  connectionsPath,
  modelsCachePath,
  roleDefaultsPath,
  stateDirectory = process.env.JULIA_RUN_DIRECTORY ?? join(homedir(), '.julia', 'runs'),
  settingsPath = null,
  card,
  fetchCard = null,
  inventory = null,
  connections = null,
  dispatch = null,
  authorization,
  authorizationPath = process.env.JULIA_START_AUTHORIZATION,
  decision = null,
  askDecision = null,
  logger = () => {},
  read = readFile,
  ...writers
} = {}) {
  if (dispatch) assertDeliveryPath(stateDirectory);
  const eventsPath = join(stateDirectory, 'events.jsonl');
  const requireAuth = async (approved, issueId, configuration) => {
    const failure = authorizationReason(approved, issueId, configuration.reviewer.identity);
    if (!failure) return;
    const event = { event: 'dispatch-refused', issueId, reason: failure };
    await recordEvent(eventsPath, event, writers);
    logger(event);
    reject(`reviewer dispatch was refused: ${failure}`);
  };

  const parsed = parseInitCommand(command);
  const { issueId, choices, allowSameService = false } = parsed;
  const effectiveDecision = decision ?? parsed.decision;
  const runPath = join(stateDirectory, `${issueId}.json`);
  const saved = await readJson(runPath, { read });

  // Resume path: use saved immutable configuration without silent substitution
  if (saved) {
    if (Object.keys(choices).length > 0) {
      const event = { event: 'selection-refused', issueId, reason: 'saved-run-does-not-accept-flags', roles: Object.keys(choices) };
      await recordEvent(eventsPath, event, writers);
      logger(event);
      reject(`run ${issueId} already has a saved configuration; resume without role flags`);
    }
    const limitsSummary = formatLimitsDisplay(issueId, card, saved.configuration);
    logger(limitsSummary);
    logger({ event: 'run-resumed', issueId, configuration: saved.configuration });

    if (dispatch) {
      if (!saved.authorization) {
        const approved = authorization ?? (authorizationPath ? await readJson(authorizationPath, { read }) : null);
        await requireAuth(approved, issueId, saved.configuration);
        saved.authorization = { ...approved, configuration: saved.configuration };
        await writeJson(runPath, saved, writers);
      }
      const delivery = await dispatch(saved.configuration, { issueId, runPath, resumed: true, authorization: saved.authorization });
      if (delivery) return { issueId, configuration: saved.configuration, resumed: true, delivery };
    }
    return { issueId, configuration: saved.configuration, resumed: true };
  }

  // Preflight card check (Criterion 8: fail-closed)
  let currentCard = card;
  if (!currentCard) {
    if (process.env.JULIA_DELIVERY_OFFLINE_FIXTURE === '1' || settingsPath) {
      currentCard = {
        identifier: issueId,
        state: { name: 'Ready', type: 'unstarted' },
        description: '## Acceptance criteria\n- offline\n## Test seams\n- offline',
      };
    } else if (fetchCard) {
      currentCard = await fetchCard(issueId);
    } else if (process.env.JULIA_LINEAR_API_KEY || process.env.LINEAR_API_KEY) {
      currentCard = await fetchCardFromLinear(issueId);
    }
  }
  if (!currentCard && !card) {
    const event = { event: 'card-refused', issueId, reason: 'card-missing' };
    await recordEvent(eventsPath, event, writers);
    logger(event);
    reject(`card ${issueId} preflight failed; only verified Ready cards may be admitted to $init`);
  }
  if (currentCard) {
    try {
      verifyCardAdmission(currentCard, issueId);
    } catch (error) {
      const event = { event: 'card-refused', issueId, reason: error.message };
      await recordEvent(eventsPath, event, writers);
      logger(event);
      throw error;
    }
  }

  // Load connections and live inventory (Criterion 1: static catalog is not authority)
  const loadedConnections = connections || await loadConnections({ path: connectionsPath, read });
  let settings;
  const effectiveSettingsPath = settingsPath || (process.env.JULIA_DELIVERY_OFFLINE_FIXTURE === '1' ? new URL('../delivery-tools.json', import.meta.url) : null);
  if (effectiveSettingsPath) {
    settings = await readJson(effectiveSettingsPath, { read });
  } else {
    let liveInventory = inventory;
    if (!liveInventory) {
      liveInventory = await loadModelInventory({ cachePath: modelsCachePath, connectionsPath, read });
    }
    const catalog = buildCatalogFromInventory(liveInventory, loadedConnections);
    settings = {
      catalog,
      reviewerRunLimits: { maxTotalUsd: 1.00, outputTokenCap: null },
    };
  }

  const defaultsPath = join(stateDirectory, 'defaults.json');
  let defaults = await readJson(defaultsPath, { read });
  if (!defaults && roleDefaultsPath) {
    defaults = await loadRoleDefaults({ path: roleDefaultsPath, read });
  }

  let selected;
  let resolved;
  try {
    ({ selected, resolved } = resolveSelections(settings, defaults, choices, { allowSameService }));
  } catch (error) {
    const event = { event: 'selection-refused', issueId, reason: refusalReason(error), roles: error.roles ?? [] };
    await recordEvent(eventsPath, event, writers);
    logger(event);
    throw error;
  }

  const configuration = snapshot(resolved);

  // Connection readiness preflight for all active roles (Criterion 8)
  for (const [roleName, roleItem] of Object.entries(configuration)) {
    const model = roleItem;
    if (model?.connection?.provider) {
      const conn = loadedConnections.find(c => c.id === model.connection.provider || c.service?.toLowerCase() === model.connection.provider.toLowerCase());
      if (conn && conn.status === 'disabled') {
        const event = { event: 'selection-refused', issueId, reason: 'connection-disabled' };
        await recordEvent(eventsPath, event, writers);
        logger(event);
        reject(`connection "${conn.id}" for model "${model.identity}" is disconnected or disabled`);
      }
    }
  }

  // Display four roles and ADR 0021 limits (Criterion 9)
  const limitsSummary = formatLimitsDisplay(issueId, currentCard, configuration);
  logger(limitsSummary);

  // Mandatory Start or Cancel decision (Criterion 9)
  let userDecision = effectiveDecision;
  if (!userDecision && askDecision) {
    userDecision = await askDecision(limitsSummary);
  }
  if (!userDecision && (process.env.JULIA_DELIVERY_OFFLINE_FIXTURE === '1' || settingsPath)) {
    userDecision = 'Start';
  }
  if (!userDecision) {
    reject('$init requires an explicit decision: Start or Cancel');
  }
  const cleanDecision = String(userDecision).trim().toLowerCase();
  if (cleanDecision !== 'start' && cleanDecision !== 'cancel') {
    const event = { event: 'selection-refused', issueId, reason: 'invalid-decision' };
    await recordEvent(eventsPath, event, writers);
    logger(event);
    reject(`expected exactly Start or Cancel; got "${userDecision}"`);
  }
  if (cleanDecision === 'cancel') {
    const event = { event: 'init-cancelled', issueId };
    await recordEvent(eventsPath, event, writers);
    logger(event);
    return { issueId, status: 'CANCELLED', cancelled: true };
  }

  const approved = authorization ?? (authorizationPath ? await readJson(authorizationPath, { read }) : null);
  if (dispatch) {
    await requireAuth(approved, issueId, configuration);
  }
  const savedAuthorization = approved ? { ...approved, configuration } : null;

  await writeJson(defaultsPath, selected, writers);
  await writeJson(runPath, {
    issueId,
    configuration,
    limits: ADR_0021_LIMITS,
    authorization: savedAuthorization,
    startedAt: new Date().toISOString(),
  }, writers);

  const event = {
    event: 'selection-saved',
    issueId,
    builder: configuration.builder.identity,
    reviewer: configuration.reviewer.identity,
    crashFixer: configuration.crashFixer?.identity ?? null,
    fixReviewer: configuration.fixReviewer?.identity ?? null,
  };
  await recordEvent(eventsPath, event, writers);
  logger(event);

  if (dispatch) {
    const delivery = await dispatch(configuration, { issueId, runPath, resumed: false, authorization: savedAuthorization });
    if (delivery) return { issueId, configuration, resumed: false, delivery };
  }
  return { issueId, configuration, resumed: false };
}

export async function runInitCli(command, { ask, askDecision, ...options } = {}) {
  try {
    return await runInit(command, { askDecision, ...options });
  } catch (error) {
    if (!(error instanceof SelectionRequiredError) || !ask) throw error;
    let amended = command;
    for (const role of error.roles) {
      const answer = await ask(role);
      if (!String(answer).trim()) {
        const event = { event: 'selection-refused', issueId: parseInitCommand(command).issueId, reason: 'invalid-command', roles: [role] };
        await recordEvent(join(options.stateDirectory ?? '.julia/runs', 'events.jsonl'), event, options);
        options.logger?.(event);
        reject(`--${role} requires an exact model name or ID followed by a thinking level`);
      }
      amended += ` --${role} ${answer}`;
    }
    return runInit(amended, { askDecision, ...options });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prompts = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const isInteractive = Boolean(process.stdin.isTTY && !process.env.JULIA_NON_INTERACTIVE);
    const result = await runInitCli(process.argv.slice(2).join(' '), {
      fetchCard: fetchCardFromLinear,
      dispatch: async (configuration, { issueId, runPath, authorization }) => startMastraDelivery(issueId, configuration, {
        runPath, authorization,
        decision: process.env.JULIA_TECHNICAL_ACCEPTANCE ? JSON.parse(await readFile(process.env.JULIA_TECHNICAL_ACCEPTANCE, 'utf8')) : undefined,
      }),
      logger: (event) => console.error(typeof event === 'string' ? event : JSON.stringify(event)),
      ask: (role) => prompts.question(`$init needs ${role}; enter its exact model name or ID and thinking level: `),
      askDecision: isInteractive ? () => prompts.question('Start or Cancel? ') : null,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    prompts.close();
  }
}
