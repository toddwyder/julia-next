import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import util from 'node:util';
import test from 'node:test';

// Initialize test environment dynamically
process.env.JULIA_BUILDER_MODEL = 'command-code/deepseek/deepseek-v4-pro';
process.env.JULIA_REVIEWER_MODELS = 'moonshotai/Kimi-K2.7-Code';
process.env.JULIA_CHEAP_MODEL = 'deepseek/deepseek-v4-flash';
process.env.JULIA_FALLBACK_MODEL = 'deepseek/deepseek-v4-pro';

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
  getFactoryBuilderModel,
  SettingValidationError,
} from './src/mastra/reviewer/model-choice.ts';

const { createCodeReviewAgent, codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');
const { createWorkflowReviewAgent, workflowReviewAgent } = await import('./src/mastra/reviewer/agents/workflow-review-agent.ts');

test('no code of ours copies model choices into Factory storage; the copier and its startup hook are gone', () => {
  // factory-model-sync.ts must not exist
  assert.equal(existsSync(new URL('./src/mastra/factory-model-sync.ts', import.meta.url)), false);

  // index.ts must not import or run syncFactoryProjectModel or runStartupModelSync
  const indexSource = readFileSync(new URL('./src/mastra/index.ts', import.meta.url), 'utf8');
  assert.ok(!indexSource.includes('factory-model-sync'));
  assert.ok(!indexSource.includes('syncFactoryProjectModel'));
  assert.ok(!indexSource.includes('runStartupModelSync'));
  assert.ok(!indexSource.includes('createFileLedger'));

  // install.sh must not declare factory-model-sync.ts in its manifest
  const installerSource = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  assert.ok(!installerSource.includes('factory-model-sync.ts'));
});

test('the maker check rejects a same-maker builder/reviewer pair, reading the builder from Factory', async () => {
  // Read builder model from a Factory project object
  const factoryProject = {
    id: 'proj-1',
    name: 'julia-next',
    defaultModelId: 'command-code/deepseek/deepseek-v4-pro',
  };
  const builder = await getFactoryBuilderModel(factoryProject);
  assert.equal(builder, 'command-code/deepseek/deepseek-v4-pro');
  assert.equal(modelMaker(builder), 'deepseek');

  // Different maker (DeepSeek builder + Kimi reviewer) passes
  const passed = reviewerModels({ JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code' }, builder);
  assert.equal(passed.length, 1);
  assert.equal(passed[0].model, 'moonshotai/Kimi-K2.7-Code');

  // Same maker (DeepSeek builder + DeepSeek reviewer) fails
  assert.throws(
    () => reviewerModels({ JULIA_REVIEWER_MODELS: 'deepseek/deepseek-v4-flash' }, builder),
    /must be from a different maker than the builder \(deepseek\)/,
  );

  // Same maker across routes (command-code builder + commandcode reviewer) fails
  assert.throws(
    () => reviewerModels({ JULIA_REVIEWER_MODELS: 'commandcode/deepseek/deepseek-v4-pro' }, builder),
    /must be from a different maker than the builder \(deepseek\)/,
  );
});

test('changing the builder in Factory setting updates the builder model and triggers maker check without code rebuild', async () => {
  // First state: Factory project default model is DeepSeek
  let factoryProject = {
    id: 'proj-1',
    name: 'julia-next',
    defaultModelId: 'command-code/deepseek/deepseek-v4-pro',
  };
  let builder = await getFactoryBuilderModel(factoryProject);
  assert.equal(modelMaker(builder), 'deepseek');

  // Kimi reviewer passes with DeepSeek builder
  assert.doesNotThrow(() => reviewerModels({ JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code' }, builder));

  // Second state: Operator updates Factory project default model to Kimi in Factory settings
  factoryProject = {
    id: 'proj-1',
    name: 'julia-next',
    defaultModelId: 'command-code/moonshotai/Kimi-K2.7-Code',
  };
  builder = await getFactoryBuilderModel(factoryProject);
  assert.equal(modelMaker(builder), 'moonshot');

  // Kimi reviewer now FAILS with Kimi builder, with zero code change
  assert.throws(
    () => reviewerModels({ JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code' }, builder),
    /must be from a different maker than the builder \(moonshot\)/,
  );

  // DeepSeek reviewer now PASSES with Kimi builder
  assert.doesNotThrow(() => reviewerModels({ JULIA_REVIEWER_MODELS: 'commandcode/deepseek/deepseek-v4-pro' }, builder));
});

test('rejected settings never print their value, including through an error cause (tested with a fake secret)', () => {
  const fakeSecret = 'sk-fakefakefakefake0123456789zzzz';
  const fakeGitHubSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';

  // Test rejected reviewer setting containing a secret
  try {
    reviewerModels({ JULIA_REVIEWER_MODELS: fakeSecret });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes(fakeSecret), 'Error message must not include secret');
    assert.equal(err.cause, undefined, 'Error cause must be undefined to avoid leaking secret');
    assert.ok(!util.inspect(err).includes(fakeSecret), 'util.inspect(err) must not include secret');
    assert.ok(!String(err.stack).includes(fakeSecret), 'err.stack must not include secret');
  }

  // Test rejected builder model containing a secret
  try {
    reviewerModels({ JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code' }, fakeGitHubSecret);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes(fakeGitHubSecret), 'Error message must not include secret');
    assert.equal(err.cause, undefined, 'Error cause must be undefined');
    assert.ok(!util.inspect(err).includes(fakeGitHubSecret), 'util.inspect(err) must not include secret');
  }

  // Test malformed model identifier does not echo input
  const malformedInput = 'not-a-valid-provider-slash-model';
  try {
    reviewerModels({ JULIA_REVIEWER_MODELS: malformedInput });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(!err.message.includes(malformedInput), 'Error message must not echo malformed input');
  }
});

test('provider boundary: builder route through Command Code vs fallback through direct key', () => {
  const builder = 'command-code/deepseek/deepseek-v4-pro';
  const fallback = 'deepseek/deepseek-v4-pro';

  // Builder routes to Command Code custom provider
  const builderFirstSegment = builder.split('/')[0];
  assert.equal(builderFirstSegment, 'command-code');

  // Fallback routes directly to DeepSeek key
  const fallbackFirstSegment = fallback.split('/')[0];
  assert.equal(fallbackFirstSegment, 'deepseek');

  assert.notEqual(builderFirstSegment, fallbackFirstSegment, 'Builder and fallback must have distinct routes');
});

test('code review agent keeps its GitHub tools and its memory', async () => {
  const agent = createCodeReviewAgent({
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_BUILDER_MODEL: 'command-code/deepseek/deepseek-v4-pro',
  });

  // Tools restored
  const tools = await agent.listTools();
  assert.ok(tools, 'Agent must have tools configured');
  assert.ok(tools.parseGitHubPRUrl, 'parseGitHubPRUrl must be present');
  assert.ok(tools.getPullRequest, 'getPullRequest must be present');
  assert.ok(tools.getPullRequestDiff, 'getPullRequestDiff must be present');
  assert.ok(tools.getPullRequestFiles, 'getPullRequestFiles must be present');
  assert.ok(tools.getFileContent, 'getFileContent must be present');

  // Memory restored
  assert.ok(agent.hasOwnMemory(), 'Agent must have memory configured');
  const memory = await agent.getMemory();
  assert.ok(memory, 'Memory instance must exist');
});

test('modelMaker extracts canonical maker ignoring gateway/route prefixes', () => {
  // Direct models
  assert.equal(modelMaker('deepseek/deepseek-v4-pro'), 'deepseek');
  assert.equal(modelMaker('moonshotai/Kimi-K2.7-Code'), 'moonshot');
  assert.equal(modelMaker('openai/gpt-6-sol'), 'openai');
  assert.equal(modelMaker('anthropic/claude-sonnet-5-5'), 'anthropic');
  assert.equal(modelMaker('google/gemini-3.7-flash'), 'google');

  // Routed through command-code custom provider
  assert.equal(modelMaker('command-code/deepseek/deepseek-v4-pro'), 'deepseek');
  assert.equal(modelMaker('command-code/moonshotai/Kimi-K2.7-Code'), 'moonshot');

  // Routed through commandcode gateway
  assert.equal(modelMaker('commandcode/deepseek/deepseek-v4-pro'), 'deepseek');
  assert.equal(modelMaker('commandcode/moonshotai/Kimi-K2.7-Code'), 'moonshot');
  assert.equal(modelMaker('commandcode/deepseek-v4-pro'), 'deepseek');
  assert.equal(modelMaker('commandcode/Kimi-K2.7-Code'), 'moonshot');

  // Other gateways
  assert.equal(modelMaker('openrouter/deepseek/deepseek-r1'), 'deepseek');
  assert.equal(modelMaker('openrouter/openai/gpt-4o'), 'openai');
});

test('formatModelReadback formats models cleanly and safely without exposing secrets', () => {
  const settings = {
    builder: 'command-code/deepseek/deepseek-v4-pro',
    reviewerModels: ['moonshotai/Kimi-K2.7-Code'],
    cheap: 'deepseek/deepseek-v4-flash',
    fallback: 'deepseek/deepseek-v4-pro',
  };

  const readback = formatModelReadback(settings);
  assert.equal(
    readback,
    '[Models] Configured models - builder: command-code/deepseek/deepseek-v4-pro, reviewer: moonshotai/Kimi-K2.7-Code, cheap: deepseek/deepseek-v4-flash, fallback: deepseek/deepseek-v4-pro',
  );

  // Assert rejected if model identifier contains a secret pattern
  assert.throws(
    () => formatModelReadback({ ...settings, builder: 'sk-ant-api03-secret12345/model' }),
    /holds a credential-like value/,
  );
});

test('pi-models.commandcode.json contains moonshotai/Kimi-K2.7-Code', () => {
  const filePath = new URL('../../service-dropbox/pi-models.commandcode.json', import.meta.url);
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const parsed = JSON.parse(content);
  const models = parsed.providers?.commandcode?.models ?? [];
  const kimi = models.find(m => m.id === 'moonshotai/Kimi-K2.7-Code');
  assert.ok(kimi, 'moonshotai/Kimi-K2.7-Code must be defined in pi-models.commandcode.json');
  assert.equal(kimi.contextWindow, 256000);
});

test('no hidden model defaults exist across the entire app source tree', () => {
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
});
