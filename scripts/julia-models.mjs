import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConnections, testConnection } from './julia-connections.mjs';

export const FOUR_DELIVERY_ROLES = Object.freeze(['builder', 'reviewer', 'crashFixer', 'fixReviewer']);
export const ROLE_ALIASES = Object.freeze({
  'crash-fixer': 'crashFixer',
  'crashfixer': 'crashFixer',
  'crashFixer': 'crashFixer',
  'fix-reviewer': 'fixReviewer',
  'fixreviewer': 'fixReviewer',
  'fixReviewer': 'fixReviewer',
  'recovery-reviewer': 'fixReviewer',
  'recoveryReviewer': 'fixReviewer',
  'builder': 'builder',
  'reviewer': 'reviewer',
});

export function canonicalRoleName(role) {
  const normalized = role ? ROLE_ALIASES[role.trim()] || ROLE_ALIASES[role.trim().toLowerCase()] : null;
  if (!normalized) {
    throw new Error(`unknown delivery role "${role}"; valid roles are: builder, reviewer, crash-fixer, fix-reviewer`);
  }
  return normalized;
}

export function defaultModelsCachePath() {
  return process.env.JULIA_MODELS_CACHE_PATH ?? join(process.env.JULIA_CONFIG_DIRECTORY ?? join(homedir(), '.julia'), 'models-cache.json');
}

export function defaultRoleDefaultsPath() {
  return process.env.JULIA_ROLE_DEFAULTS_PATH ?? join(process.env.JULIA_CONFIG_DIRECTORY ?? join(homedir(), '.julia'), 'role-defaults.json');
}

export function initialStockRoleDefaults() {
  return {
    builder: {
      model: 'gemini-3.8-flash-high',
      route: 'acp',
      connectionId: 'antigravity-acp',
      service: 'Antigravity',
      maker: 'Google',
      thinking: 'high',
    },
    reviewer: {
      model: 'deepseek/deepseek-v4-pro',
      route: 'api',
      connectionId: 'commandcode-api',
      service: 'CommandCode',
      maker: 'DeepSeek',
      thinking: null,
    },
    crashFixer: {
      model: 'gemini-3.8-flash-medium',
      route: 'acp',
      connectionId: 'antigravity-acp',
      service: 'Antigravity',
      maker: 'Google',
      thinking: 'medium',
    },
    fixReviewer: {
      model: 'deepseek/deepseek-v4-pro',
      route: 'api',
      connectionId: 'commandcode-api',
      service: 'CommandCode',
      maker: 'DeepSeek',
      thinking: null,
    },
  };
}

export async function loadRoleDefaults({
  path = defaultRoleDefaultsPath(),
  read = readFile,
  initializeDefaults = true,
} = {}) {
  try {
    const raw = await read(path, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      builder: parsed.builder ? { ...parsed.builder } : null,
      reviewer: parsed.reviewer ? { ...parsed.reviewer } : null,
      crashFixer: parsed.crashFixer ? { ...parsed.crashFixer } : (parsed['crash-fixer'] ? { ...parsed['crash-fixer'] } : null),
      fixReviewer: parsed.fixReviewer ? { ...parsed.fixReviewer } : (parsed['fix-reviewer'] ? { ...parsed['fix-reviewer'] } : (parsed.recoveryReviewer ? { ...parsed.recoveryReviewer } : null)),
    };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.message?.includes('ENOENT')) {
      if (initializeDefaults) return initialStockRoleDefaults();
      return { builder: null, reviewer: null, crashFixer: null, fixReviewer: null };
    }
    throw error;
  }
}

export async function saveRoleDefaults(defaults, {
  path = defaultRoleDefaultsPath(),
  write = writeFile,
  mkdirImpl = mkdir,
} = {}) {
  await mkdirImpl(dirname(path), { recursive: true });
  await write(path, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
}

export async function discoverLiveModels({
  connectionsPath,
  testOptions = {},
  connections = null,
} = {}) {
  const activeConnections = connections || await loadConnections({ path: connectionsPath });
  const models = [];
  const errors = [];

  for (const conn of activeConnections) {
    if (conn.status === 'disabled') continue;
    try {
      const probe = await testConnection(conn.id, { path: connectionsPath, connections: activeConnections, ...testOptions });
      if (probe.status === 'PASS' && Array.isArray(probe.models)) {
        for (const item of probe.models) {
          models.push({
            id: item.id,
            name: item.name ?? item.id,
            route: item.route ?? conn.type,
            service: item.service || conn.service,
            maker: item.maker || conn.maker,
            connectionId: conn.id,
            thinking: item.thinking ?? { supported: false, default: null },
            readiness: item.readiness ?? 'READY',
            routeLabel: `${item.name ?? item.id} through ${item.service || conn.service}`,
            discoveredAt: probe.testedAt ?? new Date().toISOString(),
          });
        }
      } else {
        errors.push({ connectionId: conn.id, reason: probe.reason ?? 'test returned non-PASS status' });
      }
    } catch (err) {
      errors.push({ connectionId: conn.id, reason: err.message });
    }
  }

  const seen = new Set();
  const deduplicated = [];
  for (const m of models) {
    const key = `${m.id}::${m.route}::${m.service}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(m);
    }
  }
  return { models: deduplicated, errors };
}

export async function loadModelInventory({
  cachePath = defaultModelsCachePath(),
  connectionsPath,
  refresh = false,
  read = readFile,
  write = writeFile,
  mkdirImpl = mkdir,
  discoverFn = discoverLiveModels,
  discoverOptions = {},
} = {}) {
  try {
    const { models } = await discoverFn({ connectionsPath, ...discoverOptions });
    if (Array.isArray(models) && models.length > 0) {
      try {
        await mkdirImpl(dirname(cachePath), { recursive: true });
        await write(cachePath, `${JSON.stringify(models, null, 2)}\n`);
      } catch {}
      return models;
    }
  } catch (error) {
    if (refresh) throw error;
    try {
      const raw = await read(cachePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
    throw error;
  }

  try {
    const raw = await read(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}

  return [];
}

export function findMatchingModel(reference, inventory, { route = null, service = null } = {}) {
  if (!reference || typeof reference !== 'string') return null;
  const target = reference.trim().toLowerCase();

  const candidates = inventory.filter(m => {
    const matchesId = m.id.toLowerCase() === target;
    const matchesName = m.name?.toLowerCase() === target;
    const matchesLabel = m.routeLabel?.toLowerCase() === target;
    const matchesAny = matchesId || matchesName || matchesLabel;
    if (!matchesAny) return false;
    if (route && m.route.toLowerCase() !== route.toLowerCase()) return false;
    if (service && m.service.toLowerCase() !== service.toLowerCase()) return false;
    return true;
  });

  if (candidates.length === 0) {
    const serviceCandidates = inventory.filter(m => m.service?.toLowerCase() === target);
    if (serviceCandidates.length > 0) {
      return serviceCandidates.find(m => m.isDefault) || serviceCandidates[0];
    }
    return null;
  }
  if (candidates.length > 1) {
    const distinctRoutes = new Set(candidates.map(c => `${c.route}::${c.service}`));
    if (distinctRoutes.size > 1) {
      throw new Error(`model reference "${reference}" is ambiguous across routes (${candidates.map(c => c.routeLabel).join(', ')}); specify --route or provide the full route label`);
    }
  }
  return candidates[0];
}

export async function setRoleDefault(role, modelReference, {
  route = null,
  thinking = undefined,
  inventory = null,
  defaultsPath = defaultRoleDefaultsPath(),
  cachePath = defaultModelsCachePath(),
  connectionsPath,
  ...options
} = {}) {
  const canonicalRole = canonicalRoleName(role);
  const models = inventory || await loadModelInventory({ cachePath, connectionsPath, ...options });
  const model = findMatchingModel(modelReference, models, { route });
  if (!model) {
    throw new Error(`model "${modelReference}" is not offered by any active connection`);
  }

  let selectedThinking = thinking;
  if (selectedThinking === undefined) {
    selectedThinking = model.thinking?.default ?? null;
  }
  if (model.thinking?.supported === false && selectedThinking !== null) {
    throw new Error(`model "${model.id}" does not support thinking`);
  }
  if (Array.isArray(model.thinking?.supported) && selectedThinking !== null && !model.thinking.supported.includes(selectedThinking)) {
    throw new Error(`thinking level "${selectedThinking}" is not supported by model "${model.id}" (supported: ${model.thinking.supported.join(', ')})`);
  }

  const defaults = await loadRoleDefaults({ path: defaultsPath, ...options });
  defaults[canonicalRole] = {
    model: model.id,
    route: model.route,
    connectionId: model.connectionId,
    service: model.service,
    maker: model.maker,
    thinking: selectedThinking,
  };
  await saveRoleDefaults(defaults, { path: defaultsPath, ...options });
  return defaults[canonicalRole];
}

export function parseModelsCommand(rawCommand) {
  const parts = typeof rawCommand === 'string' ? rawCommand.trim().split(/\s+/) : (rawCommand ?? []);
  let args = [...parts];
  if (args[0] === '$models') args = args.slice(1);
  const action = args[0] || 'list';
  const rest = args.slice(1);

  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!flags._pos1) {
      flags._pos1 = arg;
    } else if (!flags._pos2) {
      flags._pos2 = arg;
    }
  }
  return { action, flags, pos1: flags._pos1 ?? null, pos2: flags._pos2 ?? null };
}

export async function runModelsCli(rawCommand, options = {}) {
  const { action, flags, pos1, pos2 } = parseModelsCommand(rawCommand);
  const logger = options.logger ?? console.log;

  switch (action) {
    case 'list': {
      const inventory = await loadModelInventory({ ...options, refresh: flags.refresh === true });
      const defaults = await loadRoleDefaults(options);
      logger(`Live Offered Models (${inventory.length} routes):`);
      for (const m of inventory) {
        logger(`  - ${m.routeLabel} [ID: ${m.id}, Route: ${m.route}, Maker: ${m.maker}, Readiness: ${m.readiness}, Thinking: ${JSON.stringify(m.thinking.default ?? 'none')}]`);
      }
      logger('\nCurrent Role Defaults:');
      for (const role of FOUR_DELIVERY_ROLES) {
        const d = defaults[role];
        if (d) {
          logger(`  ${role.padEnd(12)}: ${d.model} (${d.route} via ${d.service}, maker: ${d.maker}, effort: ${d.thinking ?? 'none'})`);
        } else {
          logger(`  ${role.padEnd(12)}: (unconfigured)`);
        }
      }
      return { inventory, defaults };
    }
    case 'refresh': {
      const inventory = await loadModelInventory({ ...options, refresh: true });
      logger(`Refreshed inventory: ${inventory.length} models currently available across connections`);
      return inventory;
    }
    case 'default':
    case 'set-default': {
      const role = pos1 || flags.role;
      const model = pos2 || flags.model;
      if (!role || !model) throw new Error('$models default requires <role> and <model>');
      const updated = await setRoleDefault(role, model, {
        route: flags.route,
        thinking: flags.thinking,
        ...options,
      });
      logger(`Set ${role} default to ${updated.model} (${updated.route} via ${updated.service}, maker: ${updated.maker})`);
      return updated;
    }
    default:
      throw new Error(`unknown $models action: "${action}"`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runModelsCli(process.argv.slice(2));
  } catch (error) {
    console.error(`$models error: ${error.message}`);
    process.exitCode = 1;
  }
}
