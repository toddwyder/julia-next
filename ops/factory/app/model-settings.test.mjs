// model-settings.test.mjs -- verifies centralized model settings for builder,
// reviewer, cheap, and fallback jobs, without hidden code defaults, and
// verifies that maker checks judge the maker rather than the route.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  builderModel,
  reviewerModels,
  cheapModel,
  fallbackModel,
  modelMaker,
  validateModelSettings,
} from './src/mastra/reviewer/model-choice.ts';

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
  const env1 = {
    JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro',
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };
  assert.equal(builderModel(env1), 'deepseek/deepseek-v4-pro');
  assert.equal(reviewerModels(env1)[0].model, 'moonshotai/Kimi-K2.7-Code');

  const env2 = {
    JULIA_BUILDER_MODEL: 'commandcode/moonshotai/Kimi-K2.7-Code',
    JULIA_REVIEWER_MODELS: 'commandcode/deepseek/deepseek-v4-pro,anthropic/claude-sonnet-5-5',
    JULIA_CHEAP_MODEL: 'google/gemini-3.7-flash',
    JULIA_FALLBACK_MODEL: 'openai/gpt-6-sol',
  };
  assert.equal(builderModel(env2), 'commandcode/moonshotai/Kimi-K2.7-Code');
  assert.deepEqual(reviewerModels(env2), [
    { model: 'commandcode/deepseek/deepseek-v4-pro', maxRetries: 1 },
    { model: 'anthropic/claude-sonnet-5-5', maxRetries: 1 },
  ]);
  assert.equal(cheapModel(env2), 'google/gemini-3.7-flash');
  assert.equal(fallbackModel(env2), 'openai/gpt-6-sol');
});

test('missing JULIA_BUILDER_MODEL fails loudly with no hidden code default', () => {
  const env = {
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
    JULIA_CHEAP_MODEL: 'deepseek/deepseek-v4-flash',
    JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  };
  assert.throws(
    () => builderModel(env),
    /JULIA_BUILDER_MODEL/,
  );
  assert.throws(
    () => reviewerModels(env),
    /JULIA_BUILDER_MODEL/,
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
    /JULIA_REVIEWER_MODELS/,
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
    /JULIA_CHEAP_MODEL/,
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
    /JULIA_FALLBACK_MODEL/,
  );
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

test('pi-models.commandcode.json contains moonshotai/Kimi-K2.7-Code', () => {
  const content = readFileSync(new URL('../../service-dropbox/pi-models.commandcode.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(content);
  const models = parsed.providers?.commandcode?.models ?? [];
  const kimi = models.find(m => m.id === 'moonshotai/Kimi-K2.7-Code');
  assert.ok(kimi, 'moonshotai/Kimi-K2.7-Code must be defined in pi-models.commandcode.json');
  assert.equal(kimi.contextWindow, 256000);
});
