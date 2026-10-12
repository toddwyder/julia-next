import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('the retained minimal-runner CLI refuses new graph work', () => {
  const result = spawnSync(process.execPath, ['scripts/julia-minimal-runner.mjs', 'JUL-63', '--base', 'deadbeef'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /retired.*Factory/i);
});
