import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadDeliveryToolSettings, startDeliveryWorkers } from './delivery-tool-settings.mjs';

const valid = {
  builder: { tool: 'Claude Code', model: 'claude-opus-4-6', maker: 'Anthropic' },
  reviewer: { tool: 'Codex', model: 'gpt-5.5', maker: 'OpenAI' },
};

async function settingsFile(settings) {
  const directory = await mkdtemp(join(tmpdir(), 'julia-delivery-tools-'));
  const path = join(directory, 'settings.json');
  await writeFile(path, `${JSON.stringify(settings)}\n`);
  return { directory, path };
}

test('loads only the builder and reviewer selections from the settings file', async (t) => {
  const file = await settingsFile(valid);
  t.after(() => rm(file.directory, { recursive: true, force: true }));

  assert.deepEqual(await loadDeliveryToolSettings(file.path), valid);
});

test('accepts Command Code with its selected model maker and passes both selections to launch', async (t) => {
  const commandCode = {
    builder: { tool: 'Command Code', model: 'deepseek-v4-pro', maker: 'DeepSeek' },
    reviewer: valid.reviewer,
  };
  const file = await settingsFile(commandCode);
  t.after(() => rm(file.directory, { recursive: true, force: true }));
  const launched = [];

  await startDeliveryWorkers(file.path, async (role, choice) => launched.push({ role, choice }));

  assert.deepEqual(launched, [
    { role: 'builder', choice: commandCode.builder },
    { role: 'reviewer', choice: commandCode.reviewer },
  ]);
});

test('rejects an unknown tool before a delivery worker can launch', async (t) => {
  const file = await settingsFile({
    ...valid,
    builder: { tool: 'Unattended Wizard', model: 'wizard-1', maker: 'Example' },
  });
  t.after(() => rm(file.directory, { recursive: true, force: true }));
  let launches = 0;

  await assert.rejects(
    () => startDeliveryWorkers(file.path, async () => { launches += 1; }),
    /builder tool "Unattended Wizard" is not supported/,
  );
  assert.equal(launches, 0);
});

test('rejects a pair from the same maker before a delivery worker can launch', async (t) => {
  const file = await settingsFile({
    builder: { tool: 'Claude Code', model: 'claude-opus-4-6', maker: 'Anthropic' },
    reviewer: { tool: 'Claude Code', model: 'claude-sonnet-4-6', maker: 'Anthropic' },
  });
  t.after(() => rm(file.directory, { recursive: true, force: true }));
  let launches = 0;

  await assert.rejects(
    () => startDeliveryWorkers(file.path, async () => { launches += 1; }),
    /builder and reviewer both name maker "Anthropic"/,
  );
  assert.equal(launches, 0);
});
