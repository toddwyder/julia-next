import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

// Keep the SDK's settings/auth lookups away from the developer's real home directory.
const isolatedHome = mkdtempSync(join(tmpdir(), 'julia-model-settings-home-'));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

// Initialize test environment dynamically
process.env.JULIA_BUILDER_MODEL = 'command-code/test-builder-vendor/test-builder-model';
process.env.JULIA_REVIEWER_MODELS = 'test-reviewer-vendor/test-reviewer-model';
process.env.JULIA_CHEAP_MODEL = 'command-code/test-cheap-vendor/test-cheap-model';
process.env.JULIA_FALLBACK_MODEL = 'test-fallback-vendor/test-fallback-model';
process.env.COMMANDCODE_API_KEY = 'test-commandcode-credential-0001';

import {
  builderModel,
  reviewerModels,
  cheapModel,
  cheapMemoryModel,
  fallbackModel,
  modelMaker,
  validateModelSettings,
  formatModelReadback,
  resolveLanguageModel,
  commandCodeProviderModels,
  COMMAND_CODE_PROVIDER_ID,
  COMMAND_CODE_PROVIDER_NAME,
} from './src/mastra/reviewer/model-choice.ts';

const { createCodeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');
const { createWorkflowReviewAgent } = await import('./src/mastra/reviewer/agents/workflow-review-agent.ts');

const appDir = fileURLToPath(new URL('.', import.meta.url));

/** The starting settings from issue #185 ("Starting settings"). */
const STARTING = {
  JULIA_BUILDER_MODEL: 'command-code/deepseek/deepseek-v4-pro',
  JULIA_REVIEWER_MODELS: 'commandcode/moonshotai/Kimi-K2.7-Code',
  JULIA_CHEAP_MODEL: 'command-code/deepseek/deepseek-v4-flash',
  JULIA_FALLBACK_MODEL: 'deepseek/deepseek-v4-pro',
  COMMANDCODE_API_KEY: 'fake-commandcode-credential-aaaa1111',
};

// ---------------------------------------------------------------------------
// Settings: one place, no code defaults, route-distinct builder and fallback
// ---------------------------------------------------------------------------

test('the four jobs are read from environment settings with no code defaults', () => {
  assert.equal(builderModel(STARTING), 'command-code/deepseek/deepseek-v4-pro');
  assert.equal(cheapModel(STARTING), 'command-code/deepseek/deepseek-v4-flash');
  assert.equal(fallbackModel(STARTING), 'deepseek/deepseek-v4-pro');
  assert.deepEqual(validateModelSettings(STARTING), {
    builder: 'command-code/deepseek/deepseek-v4-pro',
    reviewerModels: ['commandcode/moonshotai/Kimi-K2.7-Code'],
    cheap: 'command-code/deepseek/deepseek-v4-flash',
    fallback: 'deepseek/deepseek-v4-pro',
  });
});

test('the builder is a Command Code custom-provider id and the fallback is an explicit direct route', () => {
  assert.equal(COMMAND_CODE_PROVIDER_NAME, 'Command Code');
  assert.equal(COMMAND_CODE_PROVIDER_ID, 'command-code');
  assert.ok(builderModel(STARTING).startsWith(`${COMMAND_CODE_PROVIDER_ID}/`));
  assert.ok(!fallbackModel(STARTING).startsWith(`${COMMAND_CODE_PROVIDER_ID}/`));

  // A fallback that would be sent back to Command Code is refused, whichever spelling reaches it.
  for (const viaCommandCode of ['command-code/deepseek/deepseek-v4-pro', 'commandcode/deepseek/deepseek-v4-pro']) {
    assert.throws(
      () => fallbackModel({ ...STARTING, JULIA_FALLBACK_MODEL: viaCommandCode }),
      /JULIA_FALLBACK_MODEL must name a direct provider route, not Command Code/,
    );
  }
  // The fallback is a different provider route from the builder.
  assert.throws(
    () => validateModelSettings({ ...STARTING, JULIA_BUILDER_MODEL: 'deepseek/deepseek-v4-pro' }),
    /JULIA_BUILDER_MODEL and JULIA_FALLBACK_MODEL must use different provider routes/,
  );
});

test('a Command Code builder or cheap model needs the Command Code key; a direct one does not', () => {
  const { COMMANDCODE_API_KEY: _omitted, ...withoutKey } = STARTING;
  assert.throws(() => validateModelSettings(withoutKey), /COMMANDCODE_API_KEY is required/);
  const direct = {
    ...withoutKey,
    JULIA_BUILDER_MODEL: 'anthropic/claude-sonnet-5-5',
    JULIA_CHEAP_MODEL: 'google/gemini-3.7-flash',
    JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code',
  };
  assert.equal(validateModelSettings(direct).builder, 'anthropic/claude-sonnet-5-5');
});

test('the Command Code provider lists exactly the bare models the settings route through it', () => {
  assert.deepEqual(commandCodeProviderModels(STARTING).sort(), ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro']);
  assert.deepEqual(
    commandCodeProviderModels({ ...STARTING, JULIA_CHEAP_MODEL: 'google/gemini-3.7-flash' }),
    ['deepseek/deepseek-v4-pro'],
  );
});

test('missing or malformed settings fail loudly and name only the setting', () => {
  const required = ['JULIA_BUILDER_MODEL', 'JULIA_REVIEWER_MODELS', 'JULIA_CHEAP_MODEL', 'JULIA_FALLBACK_MODEL'];
  for (const name of required) {
    const { [name]: _removed, ...rest } = STARTING;
    assert.throws(() => validateModelSettings(rest), new RegExp(`${name} is required`));
  }
  for (const name of ['JULIA_BUILDER_MODEL', 'JULIA_CHEAP_MODEL', 'JULIA_FALLBACK_MODEL']) {
    assert.throws(() => validateModelSettings({ ...STARTING, [name]: 'no-slash-here' }), new RegExp(`${name} must use a provider/model identifier`));
  }
});

test('a rejected setting never echoes its value, including a key pasted into it', () => {
  const fakeSecret = 'sk-fakefakefakefake0123456789zzzz';
  const probes = [
    ['JULIA_BUILDER_MODEL', `command-code/${fakeSecret}`],
    ['JULIA_BUILDER_MODEL', fakeSecret],
    ['JULIA_CHEAP_MODEL', `command-code/${fakeSecret}`],
    ['JULIA_FALLBACK_MODEL', `deepseek/${fakeSecret}`],
    ['JULIA_FALLBACK_MODEL', `command-code/deepseek/${fakeSecret}`],
    ['JULIA_REVIEWER_MODELS', `moonshotai/Kimi-K2.7-Code,vendor/${fakeSecret}`],
    ['JULIA_REVIEWER_MODELS', `deepseek/${fakeSecret}`], // same maker as the builder
  ];
  for (const [name, value] of probes) {
    let caught;
    try {
      validateModelSettings({ ...STARTING, [name]: value });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `${name}=${value.replace(fakeSecret, '<secret>')} must be rejected`);
    assert.ok(!String(caught.message).includes(fakeSecret), `${name}: error message leaked the value`);
    assert.ok(!String(caught.stack).includes(fakeSecret), `${name}: error stack leaked the value`);
    assert.match(caught.message, new RegExp(name));
  }
  assert.throws(() => modelMaker(` / `), (error) => !String(error.message).includes('/ '));
});

test('formatModelReadback names the four settings and refuses to print a secret', () => {
  const settings = validateModelSettings(STARTING);
  assert.equal(
    formatModelReadback(settings, STARTING),
    '[Models] Configured models - builder: command-code/deepseek/deepseek-v4-pro, reviewer: commandcode/moonshotai/Kimi-K2.7-Code, cheap: command-code/deepseek/deepseek-v4-flash, fallback: deepseek/deepseek-v4-pro',
  );
  const fakeSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  assert.throws(
    () => formatModelReadback({ ...settings, builder: `command-code/${fakeSecret}` }, STARTING),
    (error) => /JULIA_BUILDER_MODEL/.test(error.message) && !error.message.includes(fakeSecret),
  );
  // An environment secret that ended up inside a model id is also refused without printing it.
  assert.throws(
    () => formatModelReadback({ ...settings, cheap: `command-code/${STARTING.COMMANDCODE_API_KEY}` }, STARTING),
    (error) => !error.message.includes(STARTING.COMMANDCODE_API_KEY),
  );
});

test('modelMaker looks through route prefixes so the maker check holds for any route', () => {
  assert.equal(modelMaker('deepseek/deepseek-v4-pro'), 'deepseek');
  assert.equal(modelMaker('moonshotai/Kimi-K2.7-Code'), 'moonshot');
  assert.equal(modelMaker('command-code/deepseek/deepseek-v4-pro'), 'deepseek');
  assert.equal(modelMaker('commandcode/moonshotai/Kimi-K2.7-Code'), 'moonshot');
  assert.equal(modelMaker('openrouter/openai/gpt-4o'), 'openai');
});

test('the maker check accepts a different-maker pair and rejects a same-maker pair on any route', () => {
  assert.equal(reviewerModels(STARTING).length, 1);
  for (const sameMaker of [
    'commandcode/deepseek/deepseek-v4-flash',
    'deepseek/deepseek-v4-flash',
    'command-code/deepseek/deepseek-v4-flash',
    'moonshotai/Kimi-K2.7-Code,deepseek/deepseek-v4-flash',
  ]) {
    assert.throws(
      () => reviewerModels({ ...STARTING, JULIA_REVIEWER_MODELS: sameMaker }),
      /must be from a different maker than the builder/,
    );
  }
});

test('changing only the settings moves the builder, reviewer and cheap consumers with no code change', async () => {
  const env2 = {
    JULIA_BUILDER_MODEL: 'command-code/moonshotai/Kimi-K2.7-Code',
    JULIA_REVIEWER_MODELS: 'anthropic/claude-sonnet-5-5',
    JULIA_CHEAP_MODEL: 'google/gemini-3.7-flash',
    JULIA_FALLBACK_MODEL: 'openai/gpt-6-sol',
  };
  // No Command Code key here: reviewer ids stay direct, so the new reviewer id is visible as set.
  assert.equal(builderModel(env2), 'command-code/moonshotai/Kimi-K2.7-Code');
  assert.equal(cheapModel(env2), 'google/gemini-3.7-flash');
  assert.equal(fallbackModel(env2), 'openai/gpt-6-sol');

  const [reviewerBefore] = createCodeReviewAgent(STARTING).model;
  const [reviewerAfter] = createCodeReviewAgent(env2).model;
  assert.notDeepEqual(reviewerBefore.model, reviewerAfter.model);
  assert.equal(reviewerAfter.model, 'anthropic/claude-sonnet-5-5');
  assert.equal(createWorkflowReviewAgent(env2).model[0].model, 'anthropic/claude-sonnet-5-5');
  assert.throws(() => createCodeReviewAgent({ ...env2, JULIA_REVIEWER_MODELS: 'moonshotai/Kimi-K2.7-Code' }), /different maker/);
});

test('no hidden model defaults exist across the app source tree', () => {
  function sourceFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) files.push(...sourceFiles(fullPath));
      else if (/\.(ts|js|mjs)$/.test(fullPath)) files.push(fullPath);
    }
    return files;
  }
  const files = sourceFiles(join(appDir, 'src'));
  assert.ok(files.length > 5, 'Must find source files under src');
  const forbidden = [
    /JULIA_(?:BUILDER|REVIEWER|CHEAP|FALLBACK)_MODELS?\s*(?:\?\?|\|\|)\s*['"`]/,
    /DEFAULT_REVIEWER_MODELS\s*=/,
    /DEFAULT_BUILDER_MODEL\s*=/,
    /['"]openai\/gpt-6-sol['"]/,
    /['"]deepseek\/deepseek-v4-(?:pro|flash)['"]/,
    /['"]deepseek\/deepseek-flash['"]/,
  ];
  for (const file of [...files, join(appDir, 'register-typescript-esm.mjs'), join(appDir, 'review-route-batching.test.mjs')]) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of forbidden) assert.ok(!pattern.test(content), `${file} contains hidden model default: ${pattern}`);
  }
});

// ---------------------------------------------------------------------------
// Provider boundary: the pinned @mastra/code-sdk decides which provider key is used
// ---------------------------------------------------------------------------

test('provider boundary: the builder goes through Command Code and the fallback through the direct DeepSeek key', async () => {
  const { setCustomProvidersSource } = await import('@mastra/code-sdk/agents/custom-provider-source');
  const { resolveModel } = await import('@mastra/code-sdk/agents/model');
  const { commandCodeProviderRecord } = await import('./src/mastra/factory-model-sync.ts');

  const calls = [];
  const realFetch = globalThis.fetch;
  const savedDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  process.env.DEEPSEEK_API_KEY = 'fake-direct-deepseek-credential';
  // The record Factory's custom-providers store would hold after startup sync.
  const record = commandCodeProviderRecord({ ...STARTING, COMMANDCODE_BASE_URL: 'https://commandcode.test/provider/v1' });
  setCustomProvidersSource(() => [record]);
  const prompt = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
  try {
    await resolveModel(builderModel(STARTING)).doGenerate({ prompt });
    await resolveModel(fallbackModel(STARTING)).doGenerate({ prompt });
  } finally {
    globalThis.fetch = realFetch;
    setCustomProvidersSource(undefined);
    if (savedDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = savedDeepSeekKey;
  }

  assert.deepEqual(calls, [
    { url: 'https://commandcode.test/provider/v1/chat/completions', authorization: `Bearer ${STARTING.COMMANDCODE_API_KEY}` },
    { url: 'https://api.deepseek.com/chat/completions', authorization: 'Bearer fake-direct-deepseek-credential' },
  ]);
});

test('the builder id without a registered Command Code provider would hit the direct key (the #215 defect)', async () => {
  const { resolveModel } = await import('@mastra/code-sdk/agents/model');
  const calls = [];
  const realFetch = globalThis.fetch;
  const saved = process.env.DEEPSEEK_API_KEY;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  process.env.DEEPSEEK_API_KEY = 'fake-direct-deepseek-credential';
  try {
    // The bare builder id #215 stored; it must never be what the builder setting becomes.
    await resolveModel('deepseek/deepseek-v4-pro').doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = saved;
  }
  assert.deepEqual(calls, ['https://api.deepseek.com/chat/completions']);
  assert.ok(builderModel(STARTING).startsWith('command-code/'));
});

test('Command Code reviewer and cheap-memory models are routed to its OpenAI-compatible endpoint', () => {
  const env = { COMMANDCODE_API_KEY: 'fake-key-for-routing-0001', COMMANDCODE_BASE_URL: 'https://commandcode.test/provider/v1' };
  assert.deepEqual(resolveLanguageModel('moonshotai/Kimi-K2.7-Code', env), {
    id: 'commandcode/moonshotai/Kimi-K2.7-Code',
    url: 'https://commandcode.test/provider/v1',
    apiKey: 'fake-key-for-routing-0001',
  });
  assert.equal(resolveLanguageModel('moonshotai/Kimi-K2.7-Code', {}), 'moonshotai/Kimi-K2.7-Code');
  assert.deepEqual(cheapMemoryModel({ ...STARTING, ...env }), {
    id: 'commandcode/deepseek/deepseek-v4-flash',
    url: 'https://commandcode.test/provider/v1',
    apiKey: 'fake-key-for-routing-0001',
  });
  assert.equal(cheapMemoryModel({ ...STARTING, JULIA_CHEAP_MODEL: 'google/gemini-3.7-flash' }), 'google/gemini-3.7-flash');
});

// ---------------------------------------------------------------------------
// Cheap setting reaches the assembled consumer: observational memory
// ---------------------------------------------------------------------------

function loadCheapModelEnvInFreshProcess(settings) {
  const entry = pathToFileURL(join(appDir, 'src/mastra/cheap-model-env.ts')).href;
  const constants = '@mastra/code-sdk/constants';
  const script = `await import(${JSON.stringify(entry)}); const { DEFAULT_OM_MODEL_ID } = await import(${JSON.stringify(constants)}); process.stdout.write(DEFAULT_OM_MODEL_ID);`;
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--import', './register-typescript-esm.mjs', '--input-type=module', '-e', script],
    { cwd: appDir, env: { PATH: process.env.PATH, HOME: isolatedHome, USERPROFILE: isolatedHome, DEFAULT_OM_MODEL_ID: 'stale/server-env-value', ...settings }, encoding: 'utf8' },
  );
}

test('observational memory reads the cheap setting, so a settings-only change reaches it', () => {
  const first = loadCheapModelEnvInFreshProcess(STARTING);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, 'command-code/deepseek/deepseek-v4-flash');

  const second = loadCheapModelEnvInFreshProcess({ ...STARTING, JULIA_CHEAP_MODEL: 'google/gemini-3.7-flash' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, 'google/gemini-3.7-flash');

  const { JULIA_CHEAP_MODEL: _removed, ...noCheap } = STARTING;
  const missing = loadCheapModelEnvInFreshProcess(noCheap);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /JULIA_CHEAP_MODEL is required/);
});

test('startup refuses to run if observational memory is not using the cheap setting', async () => {
  const { assertObservationalMemoryUsesCheapModel } = await import('./src/mastra/cheap-model-env.ts');
  assert.doesNotThrow(() => assertObservationalMemoryUsesCheapModel('command-code/deepseek/deepseek-v4-flash', STARTING));
  assert.throws(
    () => assertObservationalMemoryUsesCheapModel('deepseek/deepseek-flash', STARTING),
    (error) => /observational memory/i.test(error.message) && /JULIA_CHEAP_MODEL/.test(error.message) && !error.message.includes('deepseek-flash'),
  );
  const index = readFileSync(join(appDir, 'src/mastra/index.ts'), 'utf8');
  const firstImport = index.split('\n').find((line) => line.startsWith('import '));
  assert.equal(firstImport, "import './cheap-model-env';", 'the cheap-model env must load before any SDK module reads DEFAULT_OM_MODEL_ID');
});

// ---------------------------------------------------------------------------
// Reviewer keeps its capabilities
// ---------------------------------------------------------------------------

test('the code review agent keeps its GitHub tools and its memory, and memory follows the cheap setting', async () => {
  const agent = createCodeReviewAgent({ ...STARTING, COMMANDCODE_BASE_URL: 'https://commandcode.test/provider/v1' });
  const tools = await agent.listTools();
  assert.deepEqual(
    Object.keys(tools).sort(),
    ['getFileContent', 'getPullRequest', 'getPullRequestDiff', 'getPullRequestFiles', 'parseGitHubPRUrl'],
  );
  const memory = await agent.getMemory();
  assert.ok(memory, 'the code review agent must keep observational memory');
  const observational = memory.getMergedThreadConfig({}).observationalMemory;
  assert.deepEqual(observational.model, {
    id: 'commandcode/deepseek/deepseek-v4-flash',
    url: 'https://commandcode.test/provider/v1',
    apiKey: STARTING.COMMANDCODE_API_KEY,
  });

  const changed = createCodeReviewAgent({ ...STARTING, JULIA_CHEAP_MODEL: 'google/gemini-3.7-flash' });
  const changedMemory = await changed.getMemory();
  assert.equal(changedMemory.getMergedThreadConfig({}).observationalMemory.model, 'google/gemini-3.7-flash');
});

// ---------------------------------------------------------------------------
// Startup sync: scoped to unset projects, keeps explicit choices, stops startup on failure
// ---------------------------------------------------------------------------

async function newStores() {
  const { LibSQLFactoryStorage } = await import('@mastra/libsql');
  const { FactoryProjectsStorage } = await import('@mastra/factory/storage/domains/projects/base');
  const { CustomProvidersStorage } = await import('@mastra/factory/storage/domains/custom-providers/base');
  const { DEFAULT_RETENTION } = await import('@mastra/code-sdk/utils/storage-maintenance');
  const storage = new LibSQLFactoryStorage({ id: `test-sync-${Math.random()}`, url: 'file::memory:', retention: DEFAULT_RETENTION });
  await storage.init();
  const projects = storage.registerDomain(new FactoryProjectsStorage());
  const providers = storage.registerDomain(new CustomProvidersStorage());
  await projects.ensureReady();
  await providers.ensureReady();
  return { storage, projects, providers };
}

function memoryLedger(initial = null) {
  let value = initial;
  return { read: async () => value, write: async (next) => { value = next; }, get value() { return value; } };
}

test('sync registers the Command Code provider for each organisation and sets unset projects to the builder', async () => {
  const { syncFactoryModelSettings, commandCodeProviderRecord } = await import('./src/mastra/factory-model-sync.ts');
  const { storage, projects, providers } = await newStores();
  const a = await projects.create({ orgId: 'org-a', userId: 'user-a', input: { name: 'a' } });
  const b = await projects.create({ orgId: 'org-b', userId: 'user-b', input: { name: 'b' } });

  const result = await syncFactoryModelSettings(storage, STARTING, memoryLedger());
  assert.deepEqual(result, { projectsUpdated: 2, projectsKept: 0, providersWritten: 2 });
  assert.equal((await projects.get({ orgId: 'org-a', id: a.id })).defaultModelId, 'command-code/deepseek/deepseek-v4-pro');
  assert.equal((await projects.get({ orgId: 'org-b', id: b.id })).defaultModelId, 'command-code/deepseek/deepseek-v4-pro');

  const expected = commandCodeProviderRecord(STARTING);
  for (const orgId of ['org-a', 'org-b']) {
    const [row] = await providers.list({ orgId });
    assert.equal(row.providerId, 'command-code');
    assert.equal(row.name, 'Command Code');
    assert.equal(row.url, expected.url);
    assert.equal(row.apiKey, STARTING.COMMANDCODE_API_KEY);
    assert.deepEqual([...row.models].sort(), ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro']);
  }

  // Running again changes nothing.
  assert.deepEqual(await syncFactoryModelSettings(storage, STARTING, memoryLedger('command-code/deepseek/deepseek-v4-pro')), {
    projectsUpdated: 0, projectsKept: 0, providersWritten: 0,
  });
});

test('sync keeps a project that explicitly chose its own model', async () => {
  const { syncFactoryModelSettings } = await import('./src/mastra/factory-model-sync.ts');
  const { storage, projects } = await newStores();
  const explicit = await projects.create({ orgId: 'org-a', userId: 'u', input: { name: 'explicit', defaultModelId: 'anthropic/claude-sonnet-5-5' } });
  const unset = await projects.create({ orgId: 'org-a', userId: 'u', input: { name: 'unset' } });

  const result = await syncFactoryModelSettings(storage, STARTING, memoryLedger());
  assert.equal(result.projectsUpdated, 1);
  assert.equal(result.projectsKept, 1);
  assert.equal((await projects.get({ orgId: 'org-a', id: explicit.id })).defaultModelId, 'anthropic/claude-sonnet-5-5');
  assert.equal((await projects.get({ orgId: 'org-a', id: unset.id })).defaultModelId, 'command-code/deepseek/deepseek-v4-pro');

  // Still kept after the builder setting changes: only values the sync itself wrote are replaced.
  const changed = { ...STARTING, JULIA_BUILDER_MODEL: 'command-code/moonshotai/Kimi-K2.7-Code', JULIA_REVIEWER_MODELS: 'openai/gpt-6-sol' };
  const ledger = memoryLedger('command-code/deepseek/deepseek-v4-pro');
  const second = await syncFactoryModelSettings(storage, changed, ledger);
  assert.equal(second.projectsUpdated, 1);
  assert.equal((await projects.get({ orgId: 'org-a', id: explicit.id })).defaultModelId, 'anthropic/claude-sonnet-5-5');
  assert.equal((await projects.get({ orgId: 'org-a', id: unset.id })).defaultModelId, 'command-code/moonshotai/Kimi-K2.7-Code');
  assert.equal(ledger.value, 'command-code/moonshotai/Kimi-K2.7-Code');
});

test('sync repairs the bare id the earlier release wrote, which would have used the direct key', async () => {
  const { syncFactoryModelSettings } = await import('./src/mastra/factory-model-sync.ts');
  const { storage, projects } = await newStores();
  const legacy = await projects.create({ orgId: 'org-a', userId: 'u', input: { name: 'legacy', defaultModelId: 'deepseek/deepseek-v4-pro' } });
  const result = await syncFactoryModelSettings(storage, STARTING, memoryLedger());
  assert.equal(result.projectsUpdated, 1);
  assert.equal((await projects.get({ orgId: 'org-a', id: legacy.id })).defaultModelId, 'command-code/deepseek/deepseek-v4-pro');
});

test('a sync failure stops startup, is logged with its step, and logs no key', async () => {
  const { runStartupModelSync } = await import('./src/mastra/factory-model-sync.ts');
  const { storage, projects } = await newStores();
  await projects.create({ orgId: 'org-a', userId: 'u', input: { name: 'a' } });
  projects.listAll = async () => { throw new Error(`database refused ${STARTING.COMMANDCODE_API_KEY}`); };

  const lines = [];
  const log = { info: (line) => lines.push(['info', line]), error: (line) => lines.push(['error', line]) };
  await assert.rejects(
    runStartupModelSync(storage, STARTING, memoryLedger(), log),
    (error) => /Model settings sync failed at step "list projects"/.test(error.message) && !error.message.includes(STARTING.COMMANDCODE_API_KEY),
  );
  const logged = JSON.stringify(lines);
  assert.match(logged, /list projects/);
  assert.ok(!logged.includes(STARTING.COMMANDCODE_API_KEY), 'the failure log must not contain the key');

  // Missing storage domains fail loudly rather than being created without encryption.
  const bare = { hasDomain: () => false, getDomain: () => { throw new Error('missing'); } };
  await assert.rejects(runStartupModelSync(bare, STARTING, memoryLedger(), log), /Model settings sync failed at step "open stores"/);

  // Bad settings stop startup before any store is touched.
  const { JULIA_FALLBACK_MODEL: _removed, ...incomplete } = STARTING;
  await assert.rejects(runStartupModelSync(storage, incomplete, memoryLedger(), log), /JULIA_FALLBACK_MODEL is required/);
});

test('the entry point runs the sync before Factory starts work and does not swallow its failure', () => {
  const index = readFileSync(join(appDir, 'src/mastra/index.ts'), 'utf8');
  const syncAt = index.indexOf('await runStartupModelSync(');
  const finalizeAt = index.indexOf('await factory.finalize()');
  assert.ok(syncAt > 0 && finalizeAt > syncAt, 'sync must complete before factory.finalize() starts workers');
  const around = index.slice(Math.max(0, syncAt - 80), syncAt + 160);
  assert.ok(!/\btry\b|\.catch\(/.test(around), 'the startup sync must not be wrapped in a handler that continues');
});

test('the file ledger remembers the last synced builder across restarts', async () => {
  const { createFileLedger } = await import('./src/mastra/factory-model-sync.ts');
  const path = join(mkdtempSync(join(tmpdir(), 'julia-ledger-')), 'ledger.json');
  const ledger = createFileLedger(path);
  assert.equal(await ledger.read(), null);
  await ledger.write('command-code/deepseek/deepseek-v4-pro');
  assert.equal(await createFileLedger(path).read(), 'command-code/deepseek/deepseek-v4-pro');
  writeFileSync(path, '{not json');
  await assert.rejects(createFileLedger(path).read(), /ledger/i);
});

test('pi-models.commandcode.json contains moonshotai/Kimi-K2.7-Code', () => {
  let content;
  try {
    content = readFileSync(new URL('../../service-dropbox/pi-models.commandcode.json', import.meta.url), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return; // standalone installed app directory
    throw error;
  }
  const kimi = (JSON.parse(content).providers?.commandcode?.models ?? []).find((model) => model.id === 'moonshotai/Kimi-K2.7-Code');
  assert.ok(kimi, 'moonshotai/Kimi-K2.7-Code must be defined in pi-models.commandcode.json');
  assert.equal(kimi.contextWindow, 256000);
});
