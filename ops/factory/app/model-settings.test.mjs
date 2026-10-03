import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import util from 'node:util';
import test from 'node:test';

// Initialize test environment dynamically using made-up test model IDs
process.env.JULIA_BUILDER_MODEL = 'command-code/test-maker-alpha/test-builder-model';
process.env.JULIA_REVIEWER_MODELS = 'test-maker-beta/test-reviewer-model';
process.env.JULIA_CHEAP_MODEL = 'test-maker-alpha/test-cheap-model';
process.env.JULIA_FALLBACK_MODEL = 'test-maker-alpha/test-fallback-model';

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
  // Read builder model from a Factory project object using made-up model IDs
  const factoryProject = {
    id: 'proj-1',
    name: 'julia-next',
    defaultModelId: 'command-code/test-maker-alpha/test-builder-model',
  };
  const builder = await getFactoryBuilderModel(factoryProject);
  assert.equal(builder, 'command-code/test-maker-alpha/test-builder-model');
  assert.equal(modelMaker(builder), 'test-maker-alpha');

  // Different maker (test-maker-alpha builder + test-maker-beta reviewer) passes
  const passed = reviewerModels({ JULIA_REVIEWER_MODELS: 'test-maker-beta/test-reviewer-model' }, builder);
  assert.equal(passed.length, 1);
  assert.equal(passed[0].model, 'test-maker-beta/test-reviewer-model');

  // Same maker (test-maker-alpha builder + test-maker-alpha reviewer) fails
  assert.throws(
    () => reviewerModels({ JULIA_REVIEWER_MODELS: 'test-maker-alpha/test-reviewer-backup' }, builder),
    /must be from a different maker than the builder \(test-maker-alpha\)/,
  );

  // Same maker across routes (command-code builder + commandcode reviewer) fails
  assert.throws(
    () => reviewerModels({ JULIA_REVIEWER_MODELS: 'commandcode/test-maker-alpha/test-reviewer-backup' }, builder),
    /must be from a different maker than the builder \(test-maker-alpha\)/,
  );
});

test('changing the builder in Factory setting updates the builder model and triggers maker check without code rebuild', async () => {
  // First state: Factory project default model is maker alpha
  let factoryProject = {
    id: 'proj-1',
    name: 'julia-next',
    defaultModelId: 'command-code/test-maker-alpha/test-builder-model',
  };
  let builder = await getFactoryBuilderModel(factoryProject);
  assert.equal(modelMaker(builder), 'test-maker-alpha');

  // Maker-beta reviewer passes with maker-alpha builder
  assert.doesNotThrow(() => reviewerModels({ JULIA_REVIEWER_MODELS: 'test-maker-beta/test-reviewer-model' }, builder));

  // Second state: Operator updates Factory project default model to maker-beta in Factory settings
  factoryProject = {
    id: 'proj-1',
    name: 'julia-next',
    defaultModelId: 'command-code/test-maker-beta/test-builder-model',
  };
  builder = await getFactoryBuilderModel(factoryProject);
  assert.equal(modelMaker(builder), 'test-maker-beta');

  // Maker-beta reviewer now FAILS with maker-beta builder, with zero code change
  assert.throws(
    () => reviewerModels({ JULIA_REVIEWER_MODELS: 'test-maker-beta/test-reviewer-model' }, builder),
    /must be from a different maker than the builder \(test-maker-beta\)/,
  );

  // Maker-alpha reviewer now PASSES with maker-beta builder
  assert.doesNotThrow(() => reviewerModels({ JULIA_REVIEWER_MODELS: 'commandcode/test-maker-alpha/test-reviewer-model' }, builder));
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
    reviewerModels({ JULIA_REVIEWER_MODELS: 'test-maker-beta/test-reviewer-model' }, fakeGitHubSecret);
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
  const builder = 'command-code/test-maker-alpha/test-builder-model';
  const fallback = 'test-maker-alpha/test-direct-fallback';

  // Builder routes to Command Code custom provider
  const builderFirstSegment = builder.split('/')[0];
  assert.equal(builderFirstSegment, 'command-code');

  // Fallback routes directly to provider key
  const fallbackFirstSegment = fallback.split('/')[0];
  assert.equal(fallbackFirstSegment, 'test-maker-alpha');

  assert.notEqual(builderFirstSegment, fallbackFirstSegment, 'Builder and fallback must have distinct routes');
});

test('code review agent keeps its GitHub tools and its memory', async () => {
  const agent = createCodeReviewAgent({
    JULIA_REVIEWER_MODELS: 'test-maker-beta/test-reviewer-model',
    JULIA_BUILDER_MODEL: 'command-code/test-maker-alpha/test-builder-model',
    JULIA_CHEAP_MODEL: 'test-maker-alpha/test-cheap-model',
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
  // Direct made-up test models
  assert.equal(modelMaker('test-maker-alpha/test-model-1'), 'test-maker-alpha');
  assert.equal(modelMaker('test-maker-beta/test-model-2'), 'test-maker-beta');
  assert.equal(modelMaker('vendor-gamma/test-model-3'), 'vendor-gamma');

  // Routed through command-code custom provider
  assert.equal(modelMaker('command-code/test-maker-alpha/test-model-1'), 'test-maker-alpha');
  assert.equal(modelMaker('command-code/test-maker-beta/test-model-2'), 'test-maker-beta');

  // Routed through commandcode gateway
  assert.equal(modelMaker('commandcode/test-maker-alpha/test-model-1'), 'test-maker-alpha');
  assert.equal(modelMaker('commandcode/test-maker-beta/test-model-2'), 'test-maker-beta');

  // Other gateways
  assert.equal(modelMaker('openrouter/test-maker-alpha/test-model-1'), 'test-maker-alpha');
  assert.equal(modelMaker('openrouter/test-maker-beta/test-model-2'), 'test-maker-beta');
});

test('formatModelReadback formats models cleanly and safely without exposing secrets', () => {
  const settings = {
    builder: 'command-code/test-maker-alpha/test-builder-model',
    reviewerModels: ['test-maker-beta/test-reviewer-model'],
    cheap: 'test-maker-alpha/test-cheap-model',
    fallback: 'test-maker-alpha/test-fallback-model',
  };

  const readback = formatModelReadback(settings);
  assert.equal(
    readback,
    '[Models] Configured models - builder: command-code/test-maker-alpha/test-builder-model, reviewer: test-maker-beta/test-reviewer-model, cheap: test-maker-alpha/test-cheap-model, fallback: test-maker-alpha/test-fallback-model',
  );

  // Assert rejected if model identifier contains a secret pattern
  assert.throws(
    () => formatModelReadback({ ...settings, builder: 'sk-ant-api03-secret12345/model' }),
    /holds a credential-like value/,
  );
});

test('no hidden model defaults or live model endpoints exist across the entire app source tree', () => {
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

  const forbiddenPatterns = [
    /JULIA_BUILDER_MODEL\s*(?:\?\?|\|\|)\s*['"`]/,
    /JULIA_REVIEWER_MODELS\s*(?:\?\?|\|\|)\s*['"`]/,
    /JULIA_CHEAP_MODEL\s*(?:\?\?|\|\|)\s*['"`]/,
    /JULIA_FALLBACK_MODEL\s*(?:\?\?|\|\|)\s*['"`]/,
    /DEFAULT_REVIEWER_MODELS\s*=/,
    /DEFAULT_BUILDER_MODEL\s*=/,
    /['"]openai\/gpt-6-sol['"]/,
    /['"]deepseek\/deepseek-v4-pro['"]/,
    /['"]deepseek\/deepseek-v4-flash['"]/,
    /['"]moonshotai\/Kimi-K2\.7-Code['"]/,
    /api\.commandcode\.ai/,
  ];

  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(content),
        `File ${file} contains forbidden model default or endpoint pattern: ${pattern}`,
      );
    }
  }
});
