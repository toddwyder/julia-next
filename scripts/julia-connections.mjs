// Connection registry and lifecycle manager per ADR 0019 and ADR 0021.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  assertNoRawSecret,
  redactConnection,
  testApiAdapter,
  testAcpAdapter,
  testSdkAdapter,
} from './julia-connection-adapters.mjs';

export const STOCK_CONNECTION_TYPES = Object.freeze(['api', 'acp', 'sdk']);

export function defaultConnections() {
  return [
    {
      id: 'antigravity-acp',
      name: 'Google Antigravity (ACP)',
      type: 'acp',
      service: 'Antigravity',
      maker: 'Google',
      command: 'agy',
      status: 'enabled',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'commandcode-api',
      name: 'CommandCode (API)',
      type: 'api',
      service: 'CommandCode',
      maker: 'DeepSeek',
      endpoint: 'https://api.commandcode.ai/provider/v1',
      authReference: 'COMMANDCODE_API_KEY',
      status: 'enabled',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'claude-acp',
      name: 'Anthropic Claude (ACP)',
      type: 'acp',
      service: 'Claude',
      maker: 'Anthropic',
      command: 'claude-agent-acp',
      status: 'enabled',
      createdAt: new Date().toISOString(),
    },
  ];
}

export function defaultConnectionsPath() {
  return process.env.JULIA_CONNECTIONS_PATH || join(homedir(), '.julia', 'connections.json');
}

export function defaultAuditPath() {
  return join(homedir(), '.julia', 'connections-audit.jsonl');
}

async function recordAudit(entry, options = {}) {
  const auditPath = options.auditPath || defaultAuditPath();
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  try {
    await mkdir(dirname(auditPath), { recursive: true });
    const { appendFile } = await import('node:fs/promises');
    await appendFile(auditPath, line, 'utf8');
  } catch {}
}

export async function loadConnections(options = {}) {
  const path = options.path || defaultConnectionsPath();
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (options.initializeDefaults === false) return [];
      const defaults = defaultConnections();
      if (options.initializeDefaults) {
        await saveConnections(defaults, options);
      }
      return defaults;
    }
    throw error;
  }
}

export async function saveConnections(connections, options = {}) {
  const path = options.path || defaultConnectionsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(connections, null, 2) + '\n', 'utf8');
}

export async function addConnection(connection, options = {}) {
  if (!connection || typeof connection !== 'object') {
    throw new Error('connection must be an object');
  }
  if (!connection.id || typeof connection.id !== 'string') {
    throw new Error('connection requires a non-empty string id');
  }
  if (!connection.type || !STOCK_CONNECTION_TYPES.includes(connection.type)) {
    throw new Error(`unsupported connection type "${connection.type}"; must be one of: ${STOCK_CONNECTION_TYPES.join(', ')}`);
  }

  assertNoRawSecret(connection.authReference, 'authReference');

  const connections = await loadConnections(options);
  if (connections.some(c => c.id.toLowerCase() === connection.id.toLowerCase())) {
    throw new Error(`connection "${connection.id}" already exists`);
  }

  const record = {
    id: connection.id,
    name: connection.name || connection.id,
    type: connection.type,
    service: connection.service || connection.id,
    maker: connection.maker || 'Unknown',
    endpoint: connection.endpoint || null,
    authReference: connection.authReference || null,
    command: connection.command || null,
    args: connection.args || null,
    status: connection.status || 'enabled',
    createdAt: new Date().toISOString(),
  };

  connections.push(record);
  await saveConnections(connections, options);
  await recordAudit({ event: 'connection-added', id: record.id, type: record.type, service: record.service }, options);
  return redactConnection(record);
}

export async function reconnectConnection(id, updates = {}, options = {}) {
  assertNoRawSecret(updates.authReference, 'authReference');
  const connections = await loadConnections(options);
  const index = connections.findIndex(c => c.id.toLowerCase() === id.toLowerCase());
  if (index === -1) throw new Error(`connection "${id}" not found`);
  const conn = connections[index];
  const now = new Date().toISOString();
  for (const field of ['authReference', 'endpoint', 'name', 'command', 'maker', 'service', 'protocol']) {
    if (updates[field] !== undefined) conn[field] = updates[field];
  }
  conn.status = 'enabled';
  conn.updatedAt = now;
  await saveConnections(connections, options);
  await recordAudit({ event: 'connection-reconnected', id: conn.id, updates }, options);
  return redactConnection(conn);
}

export async function disableConnection(id, options = {}) {
  const connections = await loadConnections(options);
  const conn = connections.find(c => c.id.toLowerCase() === id.toLowerCase());
  if (!conn) throw new Error(`connection "${id}" not found`);
  conn.status = 'disabled';
  conn.updatedAt = new Date().toISOString();
  await saveConnections(connections, options);
  await recordAudit({ event: 'connection-disabled', id: conn.id }, options);
  return redactConnection(conn);
}

export async function enableConnection(id, options = {}) {
  const connections = await loadConnections(options);
  const conn = connections.find(c => c.id.toLowerCase() === id.toLowerCase());
  if (!conn) throw new Error(`connection "${id}" not found`);
  conn.status = 'enabled';
  conn.updatedAt = new Date().toISOString();
  await saveConnections(connections, options);
  await recordAudit({ event: 'connection-enabled', id: conn.id }, options);
  return redactConnection(conn);
}

export async function removeConnection(id, options = {}) {
  const connections = await loadConnections(options);
  const index = connections.findIndex(c => c.id.toLowerCase() === id.toLowerCase());
  if (index === -1) throw new Error(`connection "${id}" not found`);
  const [removed] = connections.splice(index, 1);
  await saveConnections(connections, options);
  await recordAudit({ event: 'connection-removed', id: removed.id }, options);
  return redactConnection(removed);
}

export async function getConnection(id, options = {}) {
  const connections = await loadConnections(options);
  const conn = connections.find(c => c.id.toLowerCase() === id.toLowerCase());
  return conn ? redactConnection(conn) : null;
}

export async function listConnections(options = {}) {
  const connections = await loadConnections(options);
  return connections.map(redactConnection);
}

export async function testConnection(id, options = {}) {
  const connections = options.connections || await loadConnections(options);
  const conn = connections.find(c => c.id.toLowerCase() === id.toLowerCase());
  if (!conn) throw new Error(`connection "${id}" not found`);

  if (conn.status === 'disabled') {
    return {
      status: 'FAIL',
      reason: `connection "${conn.id}" is disabled`,
      models: [],
      testedAt: new Date().toISOString(),
    };
  }

  let testResult;
  if (options.adapter) {
    testResult = await options.adapter(conn, options);
  } else if (conn.type === 'api') {
    testResult = await testApiAdapter(conn, options);
  } else if (conn.type === 'acp') {
    testResult = await testAcpAdapter(conn, options);
  } else if (conn.type === 'sdk') {
    testResult = await testSdkAdapter(conn, options);
  } else {
    throw new Error(`unsupported connection type "${conn.type}"`);
  }

  conn.lastTest = {
    status: testResult.status,
    testedAt: testResult.testedAt,
    modelCount: testResult.models?.length ?? 0,
    ...(testResult.reason ? { reason: testResult.reason } : {}),
  };
  if (options.path || !options.connections) {
    await saveConnections(connections, options);
  }
  await recordAudit({ event: 'connection-tested', id: conn.id, status: testResult.status, modelCount: conn.lastTest.modelCount }, options);
  return testResult;
}

export function parseConnectionsCommand(args) {
  if (typeof args === 'string') {
    args = args.trim().split(/\s+/).filter(Boolean);
  }
  if (!Array.isArray(args)) throw new Error('$connections arguments must be array or string');
  if (args[0] === '$connections') args = args.slice(1);
  const action = args[0] || 'list';
  const remaining = args.slice(1);

  if (action === 'list') return { action: 'list' };
  if (action === 'test') {
    if (!remaining[0]) throw new Error('$connections test requires a connection id');
    return { action: 'test', id: remaining[0] };
  }
  if (action === 'disable') {
    if (!remaining[0]) throw new Error('$connections disable requires a connection id');
    return { action: 'disable', id: remaining[0] };
  }
  if (action === 'enable') {
    if (!remaining[0]) throw new Error('$connections enable requires a connection id');
    return { action: 'enable', id: remaining[0] };
  }
  if (action === 'remove') {
    if (!remaining[0]) throw new Error('$connections remove requires a connection id');
    return { action: 'remove', id: remaining[0] };
  }
  if (action === 'add') {
    const parsed = { action: 'add' };
    let startIdx = 0;
    if (remaining[0] && STOCK_CONNECTION_TYPES.includes(remaining[0].toLowerCase())) {
      parsed.type = remaining[0].toLowerCase();
      startIdx = 1;
    }
    for (let i = startIdx; i < remaining.length; i++) {
      const arg = remaining[i];
      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        const val = remaining[++i];
        if (!val) throw new Error(`flag ${arg} requires a value`);
        parsed[key] = val;
      } else if (!parsed.id) {
        parsed.id = arg;
      }
    }
    if (!parsed.id) throw new Error('$connections add requires a connection id');
    if (!parsed.type) throw new Error('$connections add requires --type');
    return parsed;
  }
  if (action === 'reconnect') {
    const parsed = { action: 'reconnect', id: remaining[0], updates: {} };
    if (!parsed.id) throw new Error('$connections reconnect requires a connection id');
    for (let i = 1; i < remaining.length; i++) {
      const arg = remaining[i];
      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        const val = remaining[++i];
        if (!val) throw new Error(`flag ${arg} requires a value`);
        parsed.updates[key] = val;
      }
    }
    return parsed;
  }
  throw new Error(`unknown $connections action "${action}"`);
}

export async function runConnectionsCli(command, options = {}) {
  const parsed = parseConnectionsCommand(command);
  const logger = options.logger || console.log;
  switch (parsed.action) {
    case 'list': {
      const list = await listConnections(options);
      logger(`Active Connections (${list.length}):`);
      for (const c of list) {
        logger(`  - ${c.id}: ${c.name} [Type: ${c.type}, Service: ${c.service}, Maker: ${c.maker}, Status: ${c.status}]`);
      }
      return list;
    }
    case 'test': {
      const res = await testConnection(parsed.id, options);
      logger(`Connection "${parsed.id}" test result: ${res.status}${res.reason ? ` (${res.reason})` : ''}`);
      return res;
    }
    case 'add': {
      const added = await addConnection(parsed, options);
      logger(`Added connection "${added.id}" (${added.name || added.id})`);
      return added;
    }
    case 'reconnect': {
      const rec = await reconnectConnection(parsed.id, parsed.updates, options);
      logger(`Reconnected connection "${rec.id}"`);
      return rec;
    }
    case 'disable': {
      const dis = await disableConnection(parsed.id, options);
      logger(`Disabled connection "${dis.id}"`);
      return dis;
    }
    case 'enable': {
      const en = await enableConnection(parsed.id, options);
      logger(`Enabled connection "${en.id}"`);
      return en;
    }
    case 'remove': {
      const rem = await removeConnection(parsed.id, options);
      logger(`Removed connection "${rem.id}"`);
      return rem;
    }
    default: throw new Error(`unrecognized action ${parsed.action}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runConnectionsCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
