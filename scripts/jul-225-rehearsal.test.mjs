import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  testConnection,
  addConnection,
} from './julia-connections.mjs';

import {
  discoverLiveModels,
  setRoleDefault,
} from './julia-models.mjs';

import {
  runInit,
} from './julia-init.mjs';

test('Criterion 12: Focused real-connection rehearsal exercises selected JUL-208 builder (ACP) and reviewer (CommandCode API) routes with real calls', async (t) => {
  const rehearsalDir = await mkdtemp(join(tmpdir(), 'jul225-rehearsal-'));
  t.after(() => rm(rehearsalDir, { recursive: true, force: true }));

  const connectionsPath = join(rehearsalDir, 'connections.json');
  const defaultsPath = join(rehearsalDir, 'role-defaults.json');
  const stateDirectory = join(rehearsalDir, 'runs');

  // Verify zero product behavior changes
  const gitStatusBefore = execSync('git status --porcelain app/ lib/ graph/ components/', { encoding: 'utf8' }).trim();
  assert.equal(gitStatusBefore, '', 'Product directories (app/, lib/, graph/, components/) must remain untouched');

  // 1. Real ACP session probe with Antigravity (agy models)
  const agyConn = await addConnection({
    id: 'antigravity-acp',
    name: 'Google Antigravity (ACP)',
    type: 'acp',
    service: 'Antigravity',
    maker: 'Google',
    command: 'agy',
  }, { path: connectionsPath, initializeDefaults: false });

  const agyTest = await testConnection('antigravity-acp', { path: connectionsPath });
  assert.equal(agyTest.status, 'PASS');
  assert.ok(agyTest.models.length > 0, 'Real ACP probe must discover models from Antigravity');
  assert.equal(agyTest.models[0].route, 'acp');
  assert.equal(agyTest.models[0].service, 'Antigravity');

  // 2. Real API connection to CommandCode
  // Never simulated: requires real key from vault and performs real HTTPS call to CommandCode
  const apiKey = process.env.COMMANDCODE_API_KEY;
  if (!apiKey) {
    t.skip('COMMANDCODE_API_KEY must be present in environment (launch through julia-vault-windows.ps1)');
    return;
  }
  assert.ok(!apiKey.startsWith('mock-'), 'Must never use fake/mock keys for real rehearsal');

  await addConnection({
    id: 'commandcode-api',
    name: 'CommandCode (API)',
    type: 'api',
    service: 'CommandCode',
    maker: 'DeepSeek',
    endpoint: 'https://api.commandcode.ai/provider/v1',
    authReference: 'COMMANDCODE_API_KEY',
  }, { path: connectionsPath, initializeDefaults: false });

  const cmdTest = await testConnection('commandcode-api', {
    path: connectionsPath,
    resolveSecret: (ref) => ref === 'COMMANDCODE_API_KEY' ? apiKey : null,
  });

  assert.equal(cmdTest.status, 'PASS', `Real CommandCode API probe must PASS: ${cmdTest.reason}`);
  assert.ok(cmdTest.models.length > 0, 'Real CommandCode probe must return live provider models');
  assert.ok(cmdTest.models.some(m => m.route === 'api'));
  assert.equal(cmdTest.models[0].service, 'CommandCode');

  // 3. Live Model Discovery across the real connections
  const { models: discoveredInventory } = await discoverLiveModels({
    connectionsPath,
    testOptions: {
      resolveSecret: (ref) => ref === 'COMMANDCODE_API_KEY' ? apiKey : null,
    },
  });
  assert.ok(discoveredInventory.length >= 2, 'Inventory must contain models discovered from both real routes');
  assert.ok(discoveredInventory.some(m => m.route === 'acp'), 'Must contain real ACP model');
  assert.ok(discoveredInventory.some(m => m.route === 'api'), 'Must contain real API model');

  // 4. Role selection and $init preflight on real discovered models
  const acpModel = discoveredInventory.find(m => m.route === 'acp');
  const deepseekReviewer = discoveredInventory.find(m => m.route === 'api' && m.maker?.toLowerCase() === 'deepseek')
    || discoveredInventory.find(m => m.route === 'api' && m.id.includes('deepseek'))
    || discoveredInventory.find(m => m.route === 'api');
  assert.ok(acpModel && deepseekReviewer, 'Discovered inventory must have both ACP and API models');

  await setRoleDefault('builder', acpModel.id, {
    inventory: discoveredInventory,
    defaultsPath,
    route: 'acp',
  });

  await setRoleDefault('reviewer', deepseekReviewer.id, {
    inventory: discoveredInventory,
    defaultsPath,
    route: 'api',
  });

  await setRoleDefault('crashFixer', acpModel.id, {
    inventory: discoveredInventory,
    defaultsPath,
    route: 'acp',
  });

  await setRoleDefault('fixReviewer', deepseekReviewer.id, {
    inventory: discoveredInventory,
    defaultsPath,
    route: 'api',
  });

  const cardFixture = {
    identifier: 'JUL-225',
    title: 'Manage live Mastra connections and four delivery roles',
    state: { name: 'Ready', type: 'unstarted' },
    acceptanceCriteria: '- [ ] criterion 12 real rehearsal',
    testSeams: 'test seams agreed',
  };

  const initResult = await runInit('$init JUL-225 --start', {
    card: cardFixture,
    inventory: discoveredInventory,
    roleDefaultsPath: defaultsPath,
    stateDirectory,
    decision: 'Start',
  });

  assert.equal(initResult.issueId, 'JUL-225');
  assert.ok(initResult.configuration.builder, 'Configuration must contain builder role');
  assert.ok(initResult.configuration.reviewer, 'Configuration must contain reviewer role');
  assert.ok(initResult.configuration.crashFixer, 'Configuration must contain crashFixer role');
  assert.ok(initResult.configuration.fixReviewer, 'Configuration must contain fixReviewer role');

  // Verify zero product directory pollution after rehearsal
  const gitStatusAfter = execSync('git status --porcelain app/ lib/ graph/ components/', { encoding: 'utf8' }).trim();
  assert.equal(gitStatusAfter, '', 'Product directories must remain clean after rehearsal');
});
