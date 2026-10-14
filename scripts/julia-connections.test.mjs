import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addConnection,
  reconnectConnection,
  disableConnection,
  enableConnection,
  removeConnection,
  getConnection,
  listConnections,
  testConnection,
  loadConnections,
  saveConnections,
  runConnectionsCli,
} from './julia-connections.mjs';

test('assertNoRawSecret blocks raw API keys and tokens from being stored in connections', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-secrets-'));
  const connectionsPath = join(dir, 'connections.json');

  // Attempting to pass raw tokens throws
  await assert.rejects(
    addConnection({
      id: 'bad-raw-1',
      type: 'api',
      authReference: 'sk-proj-1234567890abcdef1234567890',
    }, { path: connectionsPath }),
    /cannot store raw secret/,
  );

  await assert.rejects(
    addConnection({
      id: 'bad-raw-2',
      type: 'api',
      authReference: 'Bearer my-secret-jwt-token-string',
    }, { path: connectionsPath }),
    /cannot store raw secret/,
  );

  await assert.rejects(
    addConnection({
      id: 'bad-raw-3',
      type: 'api',
      authReference: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
    }, { path: connectionsPath }),
    /cannot store raw secret/,
  );

  await assert.rejects(
    addConnection({
      id: 'bad-raw-4',
      type: 'api',
      authReference: 'github_pat_1234567890abcdefghijklmnopqrstuvwxyz_12345678',
    }, { path: connectionsPath }),
    /cannot store raw secret/,
  );

  // Storing valid vault references passes
  const conn1 = await addConnection({
    id: 'good-ref-1',
    name: 'Good Ref 1',
    type: 'api',
    service: 'CommandCode',
    maker: 'DeepSeek',
    endpoint: 'https://api.example.com/v1',
    authReference: 'COMMANDCODE_API_KEY',
  }, { path: connectionsPath, initializeDefaults: false });
  assert.equal(conn1.authReference, 'COMMANDCODE_API_KEY');

  const conn2 = await addConnection({
    id: 'good-ref-2',
    name: 'Good Ref 2',
    type: 'api',
    service: 'Custom',
    maker: 'CustomMaker',
    endpoint: 'https://api.example.com/v1',
    authReference: 'op://vault-id/item-id/token',
  }, { path: connectionsPath, initializeDefaults: false });
  assert.equal(conn2.authReference, 'op://vault-id/***/token');
});

test('SDK routes fail closed: Cursor and SDK-agent routes are excluded under JUL-225', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-sdk-fail-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const connectionsPath = join(dir, 'connections.json');

  await addConnection({
    id: 'cursor-sdk',
    name: 'Cursor SDK Agent',
    type: 'sdk',
    service: 'Cursor',
    maker: 'Anysphere',
  }, { path: connectionsPath, initializeDefaults: false });

  const testRes = await testConnection('cursor-sdk', { path: connectionsPath });
  assert.equal(testRes.status, 'FAIL');
  assert.match(testRes.reason, /Cursor and SDK-agent routes are excluded under JUL-225/);
});

test('API connection correctly infers company maker from model ID and does not misattribute to connection maker', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-maker-attr-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const connectionsPath = join(dir, 'connections.json');

  await addConnection({
    id: 'cmd-multi',
    name: 'CommandCode Multi',
    type: 'api',
    service: 'CommandCode',
    maker: 'DeepSeek',
    endpoint: 'https://api.example.com/v1',
    authReference: 'COMMANDCODE_API_KEY',
  }, { path: connectionsPath, initializeDefaults: false });

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        { id: 'google/gemini-2.5-flash', name: 'Gemini Flash' },
        { id: 'anthropic/claude-3-7-sonnet', name: 'Claude 3.7' },
        { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
      ],
    }),
  });

  const testRes = await testConnection('cmd-multi', {
    path: connectionsPath,
    resolveSecret: () => 'valid-secret',
    fetchImpl: mockFetch,
  });

  assert.equal(testRes.status, 'PASS');
  const gemini = testRes.models.find(m => m.id.includes('gemini'));
  const claude = testRes.models.find(m => m.id.includes('claude'));
  const deepseek = testRes.models.find(m => m.id.includes('deepseek'));

  assert.equal(gemini.maker, 'Google');
  assert.equal(claude.maker, 'Anthropic');
  assert.equal(deepseek.maker, 'DeepSeek');
});

test('connections lifecycle: add, list, test, disable, enable, reconnect, and remove', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-connections-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const connectionsPath = join(dir, 'connections.json');

  const initial = await loadConnections({ path: connectionsPath, initializeDefaults: true });
  assert.equal(initial.length, 3);
  await saveConnections(initial, { path: connectionsPath });

  const added = await addConnection({
    id: 'test-anthropic',
    name: 'Anthropic Claude Code',
    type: 'acp',
    service: 'ClaudeCode',
    maker: 'Anthropic',
    command: 'claude',
  }, { path: connectionsPath });
  assert.equal(added.id, 'test-anthropic');
  assert.equal(added.status, 'enabled');

  await assert.rejects(
    addConnection({ id: 'test-anthropic', type: 'acp' }, { path: connectionsPath }),
    /already exists/,
  );

  const list = await listConnections({ path: connectionsPath });
  assert.equal(list.length, 4);
  assert.ok(list.some(c => c.id === 'test-anthropic'));

  const probeResult = await testConnection('test-anthropic', {
    path: connectionsPath,
    adapter: async (conn) => ({
      status: 'PASS',
      models: [{ id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', maker: 'Anthropic', route: 'acp', service: conn.service, thinking: { supported: ['low', 'high'], default: 'high' }, readiness: 'READY' }],
      testedAt: new Date().toISOString(),
    }),
  });
  assert.equal(probeResult.status, 'PASS');
  assert.equal(probeResult.models.length, 1);

  const stored = await getConnection('test-anthropic', { path: connectionsPath });
  assert.equal(stored.lastTest.status, 'PASS');
  assert.equal(stored.lastTest.modelCount, 1);

  const disabled = await disableConnection('test-anthropic', { path: connectionsPath });
  assert.equal(disabled.status, 'disabled');

  const disabledTest = await testConnection('test-anthropic', { path: connectionsPath });
  assert.equal(disabledTest.status, 'FAIL');
  assert.match(disabledTest.reason, /disabled/);

  const enabled = await enableConnection('test-anthropic', { path: connectionsPath });
  assert.equal(enabled.status, 'enabled');

  const reconnected = await reconnectConnection('test-anthropic', {
    authReference: 'ANTHROPIC_VAULT_KEY',
    command: 'claude-v2',
  }, { path: connectionsPath });
  assert.equal(reconnected.command, 'claude-v2');
  assert.equal(reconnected.authReference, 'ANTHROPIC_VAULT_KEY');

  const removed = await removeConnection('test-anthropic', { path: connectionsPath });
  assert.equal(removed.id, 'test-anthropic');
  const afterRemove = await listConnections({ path: connectionsPath });
  assert.equal(afterRemove.length, 3);
  assert.equal(await getConnection('test-anthropic', { path: connectionsPath }), null);
});

test('API connection tests endpoint and redacts secret references in output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-api-conn-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const connectionsPath = join(dir, 'connections.json');

  await addConnection({
    id: 'mock-api',
    name: 'Mock Provider API',
    type: 'api',
    service: 'MockService',
    maker: 'MockMaker',
    endpoint: 'https://api.example.com/v1',
    authReference: 'op://vault-id/secret-item/token',
  }, { path: connectionsPath, initializeDefaults: false });

  const list = await listConnections({ path: connectionsPath });
  assert.equal(list[0].authReference, 'op://vault-id/***/token');

  let calledUrl = null;
  let authHeader = null;
  const mockFetch = async (url, options) => {
    calledUrl = url;
    authHeader = options.headers?.Authorization;
    return {
      ok: true,
      json: async () => ({
        data: [
          { id: 'mock-model-1', name: 'Mock Model 1' },
          { id: 'mock-model-2', name: 'Mock Model 2' },
        ],
      }),
    };
  };

  const testRes = await testConnection('mock-api', {
    path: connectionsPath,
    resolveSecret: () => 'resolved-bearer-token',
    fetchImpl: mockFetch,
  });

  assert.equal(testRes.status, 'PASS');
  assert.equal(calledUrl, 'https://api.example.com/v1/models');
  assert.equal(authHeader, 'Bearer resolved-bearer-token');
  assert.equal(testRes.models.length, 2);
  assert.equal(testRes.models[0].service, 'MockService');
  assert.equal(testRes.models[0].route, 'api');
});

test('CLI parser and executor supports $connections syntax', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-cli-conn-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const connectionsPath = join(dir, 'connections.json');

  const logs = [];
  const logger = msg => logs.push(msg);

  await runConnectionsCli('$connections add api --id custom-api --name Custom --service CustomService --maker CustomMaker --endpoint https://api.custom.com/v1', { path: connectionsPath, logger, initializeDefaults: false });
  assert.ok(logs.some(l => l.includes('Added connection "custom-api"')));

  logs.length = 0;
  await runConnectionsCli('$connections list', { path: connectionsPath, logger });
  assert.ok(logs.some(l => l.includes('custom-api')));

  logs.length = 0;
  await runConnectionsCli('$connections disable custom-api', { path: connectionsPath, logger });
  assert.ok(logs.some(l => l.includes('Disabled connection "custom-api"')));

  logs.length = 0;
  await runConnectionsCli('$connections enable custom-api', { path: connectionsPath, logger });
  assert.ok(logs.some(l => l.includes('Enabled connection "custom-api"')));

  logs.length = 0;
  await runConnectionsCli('$connections remove custom-api', { path: connectionsPath, logger });
  assert.ok(logs.some(l => l.includes('Removed connection "custom-api"')));
});
