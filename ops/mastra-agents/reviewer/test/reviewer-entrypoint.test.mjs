import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('the Windows reviewer entry point reads a piped request and records the pre-provider paid gate', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reviewer-entrypoint-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const verdictPath = join(directory, 'verdict.json');
  const reviewer = fileURLToPath(new URL('../src/reviewer.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [reviewer], {
    input: JSON.stringify({ issueId: 'JUL-84', verdictPath }),
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /paid execution is disabled until the JUL-224 trust test passes/);
  assert.doesNotMatch(result.stderr, /path.*argument.*number|Received type number \(0\)/i);
  const failure = JSON.parse(await readFile(`${verdictPath}.failure.json`, 'utf8'));
  assert.equal(failure.plannedGate, 'paid-reviewer-disabled');
  assert.equal(failure.providerAcceptance, 'not-accepted');
  assert.equal(failure.costUsd, 0);
});
