import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FOUR_DELIVERY_ROLES,
  loadRoleDefaults,
  saveRoleDefaults,
  setRoleDefault,
  discoverLiveModels,
  loadModelInventory,
  findMatchingModel,
  runModelsCli,
} from './julia-models.mjs';

test('Antigravity ACP, CommandCode API, and Claude exact models discovery rules', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-models-rules-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const connectionsPath = join(dir, 'connections.json');

  const mockConnections = [
    { id: 'agy-acp', type: 'acp', service: 'Antigravity', maker: 'Google', status: 'enabled' },
    { id: 'cmd-api', type: 'api', service: 'CommandCode', maker: 'DeepSeek', status: 'enabled', endpoint: 'https://api.example.com/v1', authReference: 'COMMANDCODE_API_KEY' },
    { id: 'claude-acp', type: 'acp', service: 'Claude', maker: 'Anthropic', status: 'enabled', command: 'claude' },
  ];

  const testOptions = {
    adapter: async (conn) => {
      if (conn.service === 'Antigravity') {
        return {
          status: 'PASS',
          models: [
            { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)', route: 'acp', service: 'Antigravity', maker: 'Google', thinking: { supported: ['low', 'high'], default: 'high' } },
            { id: 'claude-sonnet-5-5-high', name: 'Claude Sonnet 5.5 (High)', route: 'acp', service: 'Antigravity', maker: 'Anthropic', thinking: { supported: ['low', 'high'], default: 'high' } },
          ],
          testedAt: new Date().toISOString(),
        };
      }
      if (conn.service === 'CommandCode') {
        return {
          status: 'PASS',
          models: [
            { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek v4 Pro', route: 'api', service: 'CommandCode', maker: 'DeepSeek', thinking: { supported: false, default: null } },
          ],
          testedAt: new Date().toISOString(),
        };
      }
      if (conn.service === 'Claude') {
        return {
          status: 'PASS',
          models: [
            { id: 'sonnet', name: 'Claude Sonnet', route: 'acp', service: 'Claude', maker: 'Anthropic', thinking: { supported: ['medium'], default: 'medium' } },
          ],
          testedAt: new Date().toISOString(),
        };
      }
      return { status: 'FAIL', reason: 'unknown', models: [] };
    },
  };

  const { models } = await discoverLiveModels({
    connections: mockConnections,
    testOptions,
  });

  assert.equal(models.length, 4);
  const agyGemini = models.find(m => m.id === 'gemini-3.8-flash-high');
  assert.equal(agyGemini.service, 'Antigravity');
  assert.equal(agyGemini.route, 'acp');
  assert.equal(agyGemini.maker, 'Google');

  const cmdDeepseek = models.find(m => m.id === 'deepseek/deepseek-v4-pro');
  assert.equal(cmdDeepseek.service, 'CommandCode');
  assert.equal(cmdDeepseek.route, 'api');
  assert.equal(cmdDeepseek.maker, 'DeepSeek');

  const claudeModel = models.find(m => m.id === 'sonnet');
  assert.equal(claudeModel.service, 'Claude');
  assert.equal(claudeModel.route, 'acp');
  assert.equal(claudeModel.maker, 'Anthropic');
});

test('every discovered model is selectable for all four roles without a qualification run', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-models-roles-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const defaultsPath = join(dir, 'role-defaults.json');

  const mockInventory = [
    { id: 'gemini-flash', name: 'Gemini Flash', route: 'api', service: 'CommandCode', maker: 'Google', connectionId: 'commandcode-api', thinking: { supported: ['low', 'medium', 'high'], default: 'medium' }, readiness: 'READY' },
  ];

  for (const role of FOUR_DELIVERY_ROLES) {
    const updated = await setRoleDefault(role, 'gemini-flash', {
      inventory: mockInventory,
      defaultsPath,
    });
    assert.equal(updated.model, 'gemini-flash');
    assert.equal(updated.route, 'api');
    assert.equal(updated.connectionId, 'commandcode-api');
    assert.equal(updated.thinking, 'medium');
  }

  const loaded = await loadRoleDefaults({ path: defaultsPath });
  for (const role of FOUR_DELIVERY_ROLES) {
    assert.equal(loaded[role].model, 'gemini-flash');
    assert.equal(loaded[role].route, 'api');
  }
});

test('defaults store exact model and route; "mid-tier" is never interpreted by code', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-models-exact-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const defaultsPath = join(dir, 'role-defaults.json');

  const mockInventory = [
    { id: 'custom-model-id-123', name: 'Custom Exact Model', route: 'api', service: 'CommandCode', maker: 'DeepSeek', connectionId: 'cmd-api', thinking: { supported: false, default: null } },
  ];

  const updated = await setRoleDefault('builder', 'custom-model-id-123', {
    inventory: mockInventory,
    defaultsPath,
  });

  assert.equal(updated.model, 'custom-model-id-123');
  assert.equal(updated.route, 'api');
  assert.equal(updated.service, 'CommandCode');
  assert.equal(updated.maker, 'DeepSeek');

  await assert.rejects(
    setRoleDefault('builder', 'mid-tier-model', { inventory: mockInventory, defaultsPath }),
    /not offered by any active connection/,
  );
});

test('findMatchingModel requires route when model name is ambiguous across routes', () => {
  const mockInventory = [
    { id: 'grok-2', name: 'Grok 2', route: 'acp', service: 'Antigravity', routeLabel: 'Grok 2 through Antigravity' },
    { id: 'grok-2', name: 'Grok 2', route: 'api', service: 'CommandCode', routeLabel: 'Grok 2 through CommandCode' },
  ];

  assert.throws(
    () => findMatchingModel('grok-2', mockInventory),
    /ambiguous across routes/,
  );

  const matchedAcp = findMatchingModel('grok-2', mockInventory, { route: 'acp' });
  assert.equal(matchedAcp.route, 'acp');
  assert.equal(matchedAcp.service, 'Antigravity');

  const matchedApi = findMatchingModel('grok-2', mockInventory, { route: 'api' });
  assert.equal(matchedApi.route, 'api');
  assert.equal(matchedApi.service, 'CommandCode');
});

test('CLI parser and executor supports $models syntax', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-cli-models-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const defaultsPath = join(dir, 'role-defaults.json');
  const cachePath = join(dir, 'models-cache.json');

  const mockInventory = [
    { id: 'codex', name: 'Codex', route: 'acp', service: 'Codex', maker: 'OpenAI', connectionId: 'codex-acp', thinking: { supported: ['low', 'high'], default: 'high' }, readiness: 'READY', routeLabel: 'Codex through Codex' },
    { id: 'deepseek-flash', name: 'DeepSeek Flash', route: 'api', service: 'CommandCode', maker: 'DeepSeek', connectionId: 'commandcode-api', thinking: { supported: false, default: null }, readiness: 'READY', routeLabel: 'DeepSeek Flash through CommandCode' },
  ];
  await saveRoleDefaults({
    builder: { model: 'codex', route: 'acp', service: 'Codex', maker: 'OpenAI', thinking: 'high' },
    reviewer: { model: 'deepseek-flash', route: 'api', service: 'CommandCode', maker: 'DeepSeek', thinking: null },
    crashFixer: { model: 'codex', route: 'acp', service: 'Codex', maker: 'OpenAI', thinking: 'high' },
    fixReviewer: { model: 'deepseek-flash', route: 'api', service: 'CommandCode', maker: 'DeepSeek', thinking: null },
  }, { path: defaultsPath });

  const logs = [];
  const logger = msg => logs.push(msg);

  await runModelsCli('$models list', {
    defaultsPath,
    cachePath,
    logger,
    discoverFn: async () => ({ models: mockInventory, errors: [] }),
  });
  assert.ok(logs.some(l => l.includes('Codex through Codex')));
  assert.ok(logs.some(l => l.includes('DeepSeek Flash through CommandCode')));
  assert.ok(logs.some(l => l.includes('builder')));

  logs.length = 0;
  await runModelsCli('$models default builder codex --thinking low', {
    defaultsPath,
    cachePath,
    logger,
    discoverFn: async () => ({ models: mockInventory, errors: [] }),
  });
  assert.ok(logs.some(l => l.includes('Set builder default to codex')));
  const updatedDefaults = await loadRoleDefaults({ path: defaultsPath });
  assert.equal(updatedDefaults.builder.thinking, 'low');
});

test('loadModelInventory refreshes cache when provider inventory updates and avoids stale cached data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-cache-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cachePath = join(dir, 'models-cache.json');

  const staleModel = { id: 'stale-model', name: 'Stale Model', route: 'api', service: 'OldService', maker: 'OldMaker', thinking: { supported: false, default: null } };
  const freshModel = { id: 'fresh-model', name: 'Fresh Model', route: 'api', service: 'NewService', maker: 'NewMaker', thinking: { supported: false, default: null } };

  const fs = await import('node:fs/promises');
  await fs.writeFile(cachePath, JSON.stringify([staleModel], null, 2));

  const discovered = await loadModelInventory({
    cachePath,
    discoverFn: async () => ({ models: [freshModel], errors: [] }),
  });

  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].id, 'fresh-model');
  assert.equal(discovered[0].service, 'NewService');

  const updatedCacheRaw = await fs.readFile(cachePath, 'utf8');
  assert.ok(updatedCacheRaw.includes('fresh-model'));
  assert.ok(!updatedCacheRaw.includes('stale-model'));
});

test('duplicate model IDs across routes are safely disambiguated and selectable through $init', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-duplicate-init-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateDirectory = join(dir, 'runs');

  const duplicateInventory = [
    { id: 'same-model', name: 'Same Model API', route: 'api', service: 'CommandCode', maker: 'DeepSeek', connectionId: 'cmd-api', thinking: { supported: false, default: null } },
    { id: 'same-model', name: 'Same Model ACP', route: 'acp', service: 'Claude', maker: 'Anthropic', connectionId: 'claude-acp', thinking: { supported: false, default: null } },
  ];

  const connections = [
    { id: 'cmd-api', service: 'CommandCode', type: 'api', status: 'enabled', lastTest: { status: 'PASS' } },
    { id: 'claude-acp', service: 'Claude', type: 'acp', status: 'enabled', lastTest: { status: 'PASS' } },
  ];

  const { runInit } = await import('./julia-init.mjs');

  const cardFixture = {
    identifier: 'JUL-220',
    title: 'Duplicate route probe',
    state: { name: 'Ready' },
    acceptanceCriteria: '- [ ] duplicate model selectable across routes',
    testSeams: 'seams agreed',
  };

  const res = await runInit('$init JUL-220 --builder same-model:api none --reviewer same-model:acp none --crash-fixer same-model:api none --fix-reviewer same-model:acp none --decision Start', {
    card: cardFixture,
    inventory: duplicateInventory,
    connections,
    stateDirectory,
    decision: 'Start',
  });

  assert.equal(res.issueId, 'JUL-220');
  assert.equal(res.configuration.builder.identity, 'same-model:api');
  assert.equal(res.configuration.reviewer.identity, 'same-model:acp');
  assert.equal(res.configuration.builder.maker, 'DeepSeek');
  assert.equal(res.configuration.reviewer.maker, 'Anthropic');
});
