import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadDeliveryToolSettings, validateDeliveryToolSettings } from './delivery-tool-settings.mjs';

const nativeConnection = {
  route: 'native',
  provider: null,
  endpoint: null,
  protocol: null,
  authReference: null,
};

const apiConnection = {
  route: 'api',
  provider: 'Command Code',
  endpoint: 'https://models.example.invalid/v1',
  protocol: 'openai-compatible',
  authReference: 'COMMAND_CODE_API_KEY',
};

const catalog = [
  {
    id: 'anthropic-builder',
    displayName: 'Anthropic builder placeholder',
    executableModelId: 'placeholder-anthropic-builder',
    maker: 'Anthropic',
    harness: 'claude-code',
    thinking: { supported: ['low', 'high'], default: 'high' },
    connection: nativeConnection,
  },
  {
    id: 'openai-reviewer',
    displayName: 'OpenAI reviewer placeholder',
    executableModelId: 'placeholder-openai-reviewer',
    maker: 'OpenAI',
    harness: 'codex',
    thinking: { supported: false, default: null },
    connection: nativeConnection,
  },
];

const valid = {
  catalog,
  builder: { model: 'anthropic-builder', thinking: 'low' },
  reviewer: { model: 'OpenAI reviewer placeholder', thinking: null },
};

async function settingsFile(settings) {
  const directory = await mkdtemp(join(tmpdir(), 'julia-delivery-tools-'));
  const path = join(directory, 'settings.json');
  await writeFile(path, `${JSON.stringify(settings)}\n`);
  return { directory, path };
}

test('loads complete effective configurations by exact catalog ID and display name', async (t) => {
  const file = await settingsFile(valid);
  t.after(() => rm(file.directory, { recursive: true, force: true }));

  const settings = await loadDeliveryToolSettings(file.path);

  assert.deepEqual(settings.builder, { role: 'builder', model: catalog[0], thinking: 'low' });
  assert.deepEqual(settings.reviewer, { role: 'reviewer', model: catalog[1], thinking: null });
});

test('loads the checked-in placeholder catalog without a worker launch', async () => {
  const settings = await loadDeliveryToolSettings(new URL('../delivery-tools.json', import.meta.url));

  assert.equal(settings.builder.model.id, 'anthropic-builder');
  assert.equal(settings.reviewer.model.id, 'openai-reviewer');
  assert.equal(settings.reviewer.thinking, null);
});

test('accepts an API-routed OMP catalog model with a Command Code provider', () => {
  const settings = validateDeliveryToolSettings({
    catalog: [
      ...catalog,
      {
        id: 'deepseek-omp',
        displayName: 'DeepSeek OMP placeholder',
        executableModelId: 'placeholder-deepseek-omp',
        maker: 'DeepSeek',
        harness: 'omp',
        thinking: { supported: ['medium'], default: 'medium' },
        connection: apiConnection,
      },
    ],
    builder: { model: 'deepseek-omp', thinking: 'medium' },
    reviewer: valid.reviewer,
  });

  assert.equal(settings.builder.model.harness, 'omp');
  assert.equal(settings.builder.model.connection.provider, 'Command Code');
});

test('rejects exact display-name and ID ambiguity without guessing', () => {
  assert.throws(
    () => validateDeliveryToolSettings({
      ...valid,
      catalog: [...catalog, { ...catalog[1], id: 'another-openai-reviewer', displayName: 'openai-reviewer' }],
      reviewer: { model: 'openai-reviewer', thinking: null },
    }),
    /catalog reference "openai-reviewer" is ambiguous/,
  );
});

test('rejects duplicate catalog IDs and unknown model references', () => {
  assert.throws(() => validateDeliveryToolSettings({ ...valid, catalog: [...catalog, { ...catalog[0] }] }), /duplicate catalog ID "anthropic-builder"/);
  assert.throws(() => validateDeliveryToolSettings({ ...valid, builder: { model: 'missing', thinking: 'low' } }), /builder model reference "missing" is unknown/);
});

test('rejects unknown harnesses, including Command Code as a harness', () => {
  assert.throws(
    () => validateDeliveryToolSettings({ ...valid, catalog: [{ ...catalog[0], harness: 'command-code' }, catalog[1]] }),
    /catalog entry "anthropic-builder" has unknown harness "command-code"/,
  );
});

test('rejects unsupported thinking and invalid thinking defaults', () => {
  assert.throws(() => validateDeliveryToolSettings({ ...valid, builder: { model: 'anthropic-builder', thinking: 'medium' } }), /builder thinking "medium" is not supported by catalog entry "anthropic-builder"/);
  assert.throws(
    () => validateDeliveryToolSettings({ ...valid, catalog: [{ ...catalog[0], thinking: { supported: ['low'], default: 'high' } }, catalog[1]] }),
    /catalog entry "anthropic-builder" has a default thinking level that is not supported/,
  );
});

test('rejects incomplete API connections and native routes with applicable fields', () => {
  assert.throws(
    () => validateDeliveryToolSettings({ ...valid, catalog: [{ ...catalog[0], connection: { ...apiConnection, authReference: '' } }, catalog[1]] }),
    /catalog entry "anthropic-builder" API connection requires authReference/,
  );
  assert.throws(
    () => validateDeliveryToolSettings({ ...valid, catalog: [{ ...catalog[0], connection: { ...nativeConnection, provider: 'Command Code' } }, catalog[1]] }),
    /catalog entry "anthropic-builder" native connection must explicitly use null for provider/,
  );
  assert.throws(
    () => validateDeliveryToolSettings({ ...valid, catalog: [{ ...catalog[0], connection: { ...apiConnection, endpoint: 'not-an-endpoint' } }, catalog[1]] }),
    /catalog entry "anthropic-builder" API connection endpoint must be an absolute HTTP\(S\) URL/,
  );
});

test('rejects builder and reviewer models from the same maker', () => {
  assert.throws(
    () => validateDeliveryToolSettings({ ...valid, reviewer: { model: 'anthropic-builder', thinking: 'high' } }),
    /builder and reviewer both resolve to maker "Anthropic"/,
  );
});

test('accepts a compatible catalog addition without validator changes', () => {
  const added = {
    id: 'openai-builder', displayName: 'OpenAI builder placeholder', executableModelId: 'placeholder-openai-builder', maker: 'OpenAI', harness: 'codex',
    thinking: { supported: ['minimal'], default: 'minimal' }, connection: nativeConnection,
  };
  const settings = validateDeliveryToolSettings({
    catalog: [...catalog, added], builder: { model: 'openai-builder', thinking: 'minimal' }, reviewer: valid.builder,
  });

  assert.equal(settings.builder.model, added);
});

test('reports invalid configuration without leaking an auth reference', () => {
  const secretLookingReference = 'never-show-this-value';
  assert.throws(
    () => validateDeliveryToolSettings({ ...valid, catalog: [{ ...catalog[0], connection: { ...apiConnection, endpoint: '', authReference: secretLookingReference } }, catalog[1]] }),
    (error) => {
      assert.match(error.message, /API connection requires endpoint/);
      assert.doesNotMatch(error.message, new RegExp(secretLookingReference));
      return true;
    },
  );
});
