import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Initialize test environment dynamically
process.env.JULIA_BUILDER_MODEL = 'test-builder-vendor/test-builder-model';
process.env.JULIA_REVIEWER_MODELS = 'test-reviewer-vendor/test-reviewer-model';
process.env.JULIA_CHEAP_MODEL = 'test-cheap-vendor/test-cheap-model';
process.env.JULIA_FALLBACK_MODEL = 'test-fallback-vendor/test-fallback-model';

import { Agent } from '@mastra/core/agent';
import {
  builderModel,
  reviewerModels,
  cheapModel,
  fallbackModel,
  modelMaker,
  validateModelSettings,
  formatModelReadback,
  resolveLanguageModel,
} from './src/mastra/reviewer/model-choice.ts';

const { createCodeReviewAgent, codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');
const { createWorkflowReviewAgent, workflowReviewAgent } = await import('./src/mastra/reviewer/agents/workflow-review-agent.ts');

test('builder, reviewer, cheap, and fallback models are read from environment settings without code defaults', () => {
  const env = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };

  assert.equal(builderModel(env), 'deepseek/deepseek-v4-pro');
  assert.deepEqual(reviewerModels(env), [
    { model: 'moonshotai/Kimi-K2.7-Code', maxRetries: 1 },
  ]);
  assert.equal(cheapModel(env), 'deepseek/deepseek-v4-flash');
  assert.equal(fallbackModel(env), 'deepseek/deepseek-v4-pro');

  const settings = validateModelSettings(env);
  assert.equal(settings.builder, 'deepseek/deepseek-v4-pro');
  assert.deepEqual(settings.reviewerModels, ['moonshotai/Kimi-K2.7-Code']);
  assert.equal(settings.cheap, 'deepseek/deepseek-v4-flash');
  assert.equal(settings.fallback, 'deepseek/deepseek-v4-pro');
});

test('changing only environment settings updates all four model choices with no code rebuild', () => {
  // Simulate reading directly from server settings file (/etc/julia-factory/factory.env)
  function parseEnvContent(raw) {
    const parsed = {};
    for (const line of raw.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        let v = line.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        parsed[k] = v;
      }
    }
    return parsed;
  }

  const factoryEnvContent1 = `
JULIA_BUILDER_MODEL="deepseek/deepseek-v4-pro"
JULIA_REVIEWER_MODELS="moonshotai/Kimi-K2.7-Code"
JULIA_CHEAP_MODEL="deepseek/deepseek-v4-flash"
JULIA_FALLBACK_MODEL="deepseek/deepseek-v4-pro"
`;
  const env1 = parseEnvContent(factoryEnvContent1);
  assert.equal(builderModel(env1), 'deepseek/deepseek-v4-pro');
  assert.equal(reviewerModels(env1)[0].model, 'moonshotai/Kimi-K2.7-Code');
  assert.equal(cheapModel(env1), 'deepseek/deepseek-v4-flash');
  assert.equal(fallbackModel(env1), 'deepseek/deepseek-v4-pro');

  const factoryEnvContent2 = `
JULIA_BUILDER_MODEL="commandcode/moonshotai/Kimi-K2.7-Code"
JULIA_REVIEWER_MODELS="commandcode/deepseek/deepseek-v4-pro,anthropic/claude-sonnet-5-5"
JULIA_CHEAP_MODEL="google/gemini-3.7-flash"
JULIA_FALLBACK_MODEL="openai/gpt-6-sol"
`;
  const env2 = parseEnvContent(factoryEnvContent2);
  assert.equal(builderModel(env2), 'commandcode/moonshotai/Kimi-K2.7-Code');
  assert.deepEqual(reviewerModels(env2), [
    { model: 'commandcode/deepseek/deepseek-v4-pro', maxRetries: 1 },
    { model: 'anthropic/claude-sonnet-5-5', maxRetries: 1 },
  ]);
  assert.equal(cheapModel(env2), 'google/gemini-3.7-flash');
  assert.equal(fallbackModel(env2), 'openai/gpt-6-sol');

  const settings = validateModelSettings(env2);
  assert.equal(settings.builder, 'commandcode/moonshotai/Kimi-K2.7-Code');
  assert.deepEqual(settings.reviewerModels, [
    'commandcode/deepseek/deepseek-v4-pro',
    'anthropic/claude-sonnet-5-5',
  ]);
  assert.equal(settings.cheap, 'google/gemini-3.7-flash');
  assert.equal(settings.fallback, 'openai/gpt-6-sol');
});

test('agent wiring consumes dynamic settings for builder and reviewer models', async () => {
  const env = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };

  const agent1 = createCodeReviewAgent(env);
  assert.equal(agent1.model[0].model, 'moonshotai/Kimi-K2.7-Code');
  assert.equal(agent1.model[0].maxRetries, 1);

  const wfAgent1 = createWorkflowReviewAgent(env);
  assert.equal(wfAgent1.model[0].model, 'moonshotai/Kimi-K2.7-Code');
  assert.equal(wfAgent1.model[0].maxRetries, 1);

  // Verify changing only env changes the reviewer model across agents
  const env2 = {
    JULIA_BUILDER_MODEL: 'commandcode/deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'anthropic/claude-sonnet-5-5',
    JULIA_CHEAP_MODEL: 'google/gemini-3.7-flash',
    JULIA_FALLBACK_MODEL: 'openai/gpt-6-sol',
  };
  const agent2 = createCodeReviewAgent(env2);
  assert.equal(agent2.model[0].model, 'anthropic/claude-sonnet-5-5');

  const wfAgent2 = createWorkflowReviewAgent(env2);
  assert.equal(wfAgent2.model[0].model, 'anthropic/claude-sonnet-5-5');

  const testBuilderAgent = new Agent({
    id: 'test-builder-agent',
    name: 'Test Builder',
    model: builderModel(env),
    instructions: 'Build cards.',
  });
  assert.equal(testBuilderAgent.model, 'deepseek/deepseek-v4-pro');

  // Verify agents fail to initialize if builder and reviewer share the same maker
  const sameMakerEnv = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'commandcode/deepseek/deepseek-v4-flash',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };
  assert.throws(
    () => createCodeReviewAgent(sameMakerEnv),
    /must be from a different maker than the builder \(deepseek\)/,
  );
  assert.throws(
    () => createWorkflowReviewAgent(sameMakerEnv),
    /must be from a different maker than the builder \(deepseek\)/,
  );
});

test('missing JULIA_BUILDER_MODEL fails loudly with no hidden code default', () => {
  const env = {
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };
  assert.throws(
    () => builderModel(env),
    /JULIA_BUILDER_MODEL is required/,
  );
  assert.throws(
    () => reviewerModels(env),
    /JULIA_BUILDER_MODEL is required/,
  );
  assert.throws(
    () => validateModelSettings(env),
    /JULIA_BUILDER_MODEL is required/,
  );
});

test('missing JULIA_REVIEWER_MODELS fails loudly with no hidden code default', () => {
  const env = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };
  assert.throws(
    () => reviewerModels(env),
    /JULIA_REVIEWER_MODELS is required/,
  );
  assert.throws(
    () => validateModelSettings(env),
    /JULIA_REVIEWER_MODELS is required/,
  );
});

test('missing JULIA_CHEAP_MODEL fails loudly', () => {
  const env = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };
  assert.throws(
    () => cheapModel(env),
    /JULIA_CHEAP_MODEL is required/,
  );
  assert.throws(
    () => validateModelSettings(env),
    /JULIA_CHEAP_MODEL is required/,
  );
});

test('missing JULIA_FALLBACK_MODEL fails loudly', () => {
  const env = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
  };
  assert.throws(
    () => fallbackModel(env),
    /JULIA_FALLBACK_MODEL is required/,
  );
  assert.throws(
    () => validateModelSettings(env),
    /JULIA_FALLBACK_MODEL is required/,
  );
});

test('formatModelReadback outputs live readback and ensures no secret keys are exposed', () => {
  const settings = {
    builder: 'deepseek/deepseek-v4-pro',
    reviewerModels: ['moonshotai/Kimi-K2.7-Code'],
    cheap: 'deepseek/deepseek-v4-flash',
    fallback: 'deepseek/deepseek-v4-pro',
  };

  const readback = formatModelReadback(settings);
  assert.equal(
    readback,
    '[Models] Configured models - builder: deepseek/deepseek-v4-pro, reviewer: moonshotai/Kimi-K2.7-Code, cheap: deepseek/deepseek-v4-flash, fallback: deepseek/deepseek-v4-pro',
  );
  // Ensure no API keys or secret patterns are leaked
  assert.ok(!readback.includes('sk-'));
  assert.ok(!readback.toLowerCase().includes('secret'));

  // Ensure legitimate models pass without false positives
  const legitimateSamples = [
    'deepseek/deepseek-v4-pro',
    'moonshotai/Kimi-K2.7-Code',
    'anthropic/claude-3-7-sonnet',
    'openai/gpt-4o',
    'google/gemini-2.0-flash-thinking-exp',
    'meta-llama/Llama-3.3-70B-Instruct',
    'mistralai/Mistral-Large-Instruct-2407',
  ];
  for (const sample of legitimateSamples) {
    const formatted = formatModelReadback({
      ...settings,
      builder: sample,
    });
    assert.ok(formatted.includes(sample));
  }

  // Test various secret key patterns in model identifiers are rejected
  const secretSamples = [
    'sk-ant-api03-secretkey12345/model',
    'provider/pk-live-9876543210abcdef',
    'ghp_1234567890abcdefghijklmnopqrstuvwxyz/model',
    'bearer token_12345',
    'provider/0123456789abcdef0123456789abcdef0123456789abcdef',
    'provider/secret_key=12345',
    'provider/password_admin',
  ];

  for (const sample of secretSamples) {
    assert.throws(
      () => formatModelReadback({
        ...settings,
        builder: sample,
      }),
      /Potential secret key detected/,
      `Should reject secret sample: ${sample}`,
    );
  }
});

test('modelMaker extracts canonical maker ignoring gateway/route prefixes', () => {
  // Direct models
  assert.equal(modelMaker('deepseek/deepseek-v4-pro'), 'deepseek');
  assert.equal(modelMaker('moonshotai/Kimi-K2.7-Code'), 'moonshot');
  assert.equal(modelMaker('openai/gpt-6-sol'), 'openai');
  assert.equal(modelMaker('anthropic/claude-sonnet-5-5'), 'anthropic');
  assert.equal(modelMaker('google/gemini-3.7-flash'), 'google');

  // Routed through commandcode gateway
  assert.equal(modelMaker('commandcode/deepseek/deepseek-v4-pro'), 'deepseek');
  assert.equal(modelMaker('commandcode/moonshotai/Kimi-K2.7-Code'), 'moonshot');
  assert.equal(modelMaker('commandcode/deepseek-v4-pro'), 'deepseek');
  assert.equal(modelMaker('commandcode/Kimi-K2.7-Code'), 'moonshot');
  assert.equal(modelMaker('commandcode/claude-sonnet-5-5'), 'anthropic');
  assert.equal(modelMaker('commandcode/gpt-6-sol'), 'openai');

  // Other gateways
  assert.equal(modelMaker('openrouter/deepseek/deepseek-r1'), 'deepseek');
  assert.equal(modelMaker('openrouter/openai/gpt-4o'), 'openai');
});

test('maker check passes when builder and reviewer are different makers through the same route', () => {
  const env = {
    JULIA_BUILDER_MODEL: 'commandcode/deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'commandcode/moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'commandcode/deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };
  const result = reviewerModels(env);
  assert.equal(result.length, 1);
  assert.equal(result[0].model, 'commandcode/moonshotai/Kimi-K2.7-Code');
});

test('maker check rejects same-maker builder and reviewer even when routed differently or identically', () => {
  // Both on commandcode route, same maker (deepseek)
  const envSameRoute = {
    JULIA_BUILDER_MODEL: 'commandcode/deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'commandcode/deepseek/deepseek-v4-flash',
  };
  assert.throws(
    () => reviewerModels(envSameRoute),
    /must be from a different maker than the builder/,
  );

  // One direct, one routed, same maker (deepseek)
  const envMixedRoute = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'commandcode/deepseek-v4-flash',
  };
  assert.throws(
    () => reviewerModels(envMixedRoute),
    /must be from a different maker than the builder/,
  );

  // Reviewer backup list containing a same-maker model
  const envBackupSameMaker = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code,deepseek/deepseek-v4-flash',
  };
  assert.throws(
    () => reviewerModels(envBackupSameMaker),
    /must be from a different maker than the builder/,
  );
});

test('no hidden model defaults exist across the entire app source tree', () => {
  // Recursively collect all .ts and .js source files under ops/factory/app/src
  function getAllSourceFiles(dir) {
    const files = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getAllSourceFiles(fullPath));
      } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.js') || fullPath.endsWith('.mjs')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const srcDir = fileURLToPath(new URL('./src', import.meta.url));
  const sourceFiles = getAllSourceFiles(srcDir);
  assert.ok(sourceFiles.length > 5, 'Must find source files under src');

  const forbiddenDefaultPatterns = [
    /JULIA_BUILDER_MODEL\s*(?:\?\?|\|\|)\s*['"`]/,
    /JULIA_REVIEWER_MODELS\s*(?:\?\?|\|\|)\s*['"`]/,
    /JULIA_CHEAP_MODEL\s*(?:\?\?|\|\|)\s*['"`]/,
    /JULIA_FALLBACK_MODEL\s*(?:\?\?|\|\|)\s*['"`]/,
    /DEFAULT_REVIEWER_MODELS\s*=/,
    /DEFAULT_BUILDER_MODEL\s*=/,
    /['"]openai\/gpt-6-sol['"]/,
    /['"]deepseek\/deepseek-v4-pro['"]/,
  ];

  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of forbiddenDefaultPatterns) {
      assert.ok(
        !pattern.test(content),
        `File ${file} contains hidden model default pattern: ${pattern}`,
      );
    }
  }

  // Also check register-typescript-esm.mjs and test files
  const registerContent = readFileSync(new URL('./register-typescript-esm.mjs', import.meta.url), 'utf8');
  assert.ok(!registerContent.includes('JULIA_BUILDER_MODEL'), 'register-typescript-esm.mjs must not set default model env vars');
  assert.ok(!registerContent.includes('JULIA_REVIEWER_MODELS'), 'register-typescript-esm.mjs must not set default model env vars');
  assert.ok(!registerContent.includes('JULIA_CHEAP_MODEL'), 'register-typescript-esm.mjs must not set default model env vars');
  assert.ok(!registerContent.includes('JULIA_FALLBACK_MODEL'), 'register-typescript-esm.mjs must not set default model env vars');

  const batchingTestContent = readFileSync(new URL('./review-route-batching.test.mjs', import.meta.url), 'utf8');
  for (const pattern of forbiddenDefaultPatterns) {
    assert.ok(
      !pattern.test(batchingTestContent),
      `review-route-batching.test.mjs contains hidden default assignment: ${pattern}`,
    );
  }
});

test('pi-models.commandcode.json contains moonshotai/Kimi-K2.7-Code', () => {
  const filePath = new URL('../../service-dropbox/pi-models.commandcode.json', import.meta.url);
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Running inside standalone installed app directory where service-dropbox is not deployed
      return;
    }
    throw err;
  }
  const parsed = JSON.parse(content);
  const models = parsed.providers?.commandcode?.models ?? [];
  const kimi = models.find(m => m.id === 'moonshotai/Kimi-K2.7-Code');
  assert.ok(kimi, 'moonshotai/Kimi-K2.7-Code must be defined in pi-models.commandcode.json');
  assert.equal(kimi.contextWindow, 256000);
});

test('resolveLanguageModel routes via Command Code OpenAI-compatible gateway when key is present', () => {
  const envWithKey = {
    COMMANDCODE_API_KEY: 'test-cc-key',
    COMMANDCODE_BASE_URL: 'https://api.commandcode.ai/provider/v1',
  };
  const model = resolveLanguageModel('moonshotai/Kimi-K2.7-Code', envWithKey);
  assert.equal(typeof model, 'object');
  assert.equal(model.id, 'commandcode/moonshotai/Kimi-K2.7-Code');

  const routedModel = resolveLanguageModel('commandcode/moonshotai/Kimi-K2.7-Code', envWithKey);
  assert.equal(typeof routedModel, 'object');
  assert.equal(routedModel.id, 'commandcode/moonshotai/Kimi-K2.7-Code');

  const plainModel = resolveLanguageModel('moonshotai/Kimi-K2.7-Code', {});
  assert.equal(plainModel, 'moonshotai/Kimi-K2.7-Code');
});

test('Factory startup and index entry point consumes model settings dynamically', () => {
  const customEnv = {
    JULIA_BUILDER_MODEL: 'commandcode/deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'commandcode/moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'commandcode/deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };

  // Verifies validateModelSettings validates all 4 settings and builderModel returns project model choice
  const validated = validateModelSettings(customEnv);
  assert.equal(validated.builder, 'commandcode/deepseek/deepseek-v4-pro');
  assert.deepEqual(validated.reviewerModels, ['commandcode/moonshotai/Kimi-K2.7-Code']);
  assert.equal(validated.cheap, 'commandcode/deepseek/deepseek-v4-flash');
  assert.equal(validated.fallback, 'deepseek/deepseek-v4-pro');

  const readback = formatModelReadback(validated);
  assert.ok(readback.includes('builder: commandcode/deepseek/deepseek-v4-pro'));
  assert.ok(readback.includes('reviewer: commandcode/moonshotai/Kimi-K2.7-Code'));
});

test('syncFactoryProjectModel synchronizes builder model to Factory project storage without code rebuild', async () => {
  const { syncFactoryProjectModel } = await import('./src/mastra/factory-model-sync.ts');
  const { LibSQLFactoryStorage } = await import('@mastra/libsql');
  const { FactoryProjectsStorage } = await import('@mastra/factory/storage/domains/projects/base');
  const { DEFAULT_RETENTION } = await import('@mastra/code-sdk/utils/storage-maintenance');

  const storage = new LibSQLFactoryStorage({
    id: 'test-sync-storage',
    url: 'file::memory:',
    retention: DEFAULT_RETENTION,
  });
  await storage.init();
  const projects = storage.registerDomain(new FactoryProjectsStorage());
  await projects.ensureReady();

  const p1 = await projects.create({ orgId: 'org1', userId: 'user1', input: { name: 'proj1' } });
  assert.equal(p1.defaultModelId, null);

  // Sync initial builder model
  const env1 = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };
  const count1 = await syncFactoryProjectModel(storage, env1);
  assert.equal(count1, 1);
  const updated1 = await projects.get({ orgId: 'org1', id: p1.id });
  assert.equal(updated1.defaultModelId, 'deepseek/deepseek-v4-pro');

  // Change only settings and sync again with NO code build
  const env2 = {
    JULIA_BUILDER_MODEL: 'commandcode/deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };
  const count2 = await syncFactoryProjectModel(storage, env2);
  assert.equal(count2, 1);
  const updated2 = await projects.get({ orgId: 'org1', id: p1.id });
  assert.equal(updated2.defaultModelId, 'commandcode/deepseek/deepseek-v4-pro');
});

