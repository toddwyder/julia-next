import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the Windows reviewer entry point reads a piped request before the paid-execution gate', () => {
  const reviewer = fileURLToPath(new URL('../src/reviewer.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [reviewer], {
    input: JSON.stringify({ issueId: 'JUL-84' }),
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /paid execution is disabled until the JUL-224 trust test passes/);
  assert.doesNotMatch(result.stderr, /path.*argument.*number|Received type number \(0\)/i);
});
