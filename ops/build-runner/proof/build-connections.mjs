import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRunner } from '../adapter.mjs';

const [model, settingsPath = 'ops/build-runner/machine-settings.json'] = process.argv.slice(2);
const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
if (!settings.models[model]) throw Error('Configured exact model ID required');
settings.roles = { proof: model };
settings.memory = false;
const stateDir = await mkdtemp(join(tmpdir(), 'jul253-connection-'));
const cwd = join(stateDir, 'workspace');
await mkdir(cwd);
const config = join(stateDir, 'settings.json');
await writeFile(config, JSON.stringify(settings));
let runner;
try {
  runner = await openRunner({ card: 'JUL-253', role: 'proof', cwd, stateDir: join(stateDir, 'state'), settingsPath: config });
  const before = runner.snapshot();
  const receipt = await runner.run({ prompt: 'Use the workspace write-file tool to create connection-proof.txt containing exactly JUL253_BUILD_OK followed by one newline. Then reply JUL253_CONNECTION_OK only. Do not run shell commands, use other tools, or create other files.', maxTurns: 6, timeoutMs: 120000 });
  const result = {
    model, status: receipt.result.status,
    artifact: await readFile(join(cwd, 'connection-proof.txt'), 'utf8').catch(() => null),
    text: receipt.result.text,
    error: receipt.result.error?.message,
    requestsAdded: receipt.account.requests.length - before.requests.length,
    costNano: Number(receipt.account.spentNano) - Number(before.spentNano),
    account: receipt.account,
  };
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.artifact, 'JUL253_BUILD_OK\n');
  assert.equal(result.status, 'completed');
  assert.equal(result.text.trim(), 'JUL253_CONNECTION_OK');
  assert.ok(result.requestsAdded > 0);
} finally {
  await runner?.close();
  await rm(stateDir, { recursive: true, force: true });
}
