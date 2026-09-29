import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

for (const script of ['julia-run.mjs', 'ready-queue.mjs']) {
  test(`the retired ${script} CLI refuses new graph work`, () => {
    const result = spawnSync(process.execPath, [`scripts/${script}`, 'JUL-63'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /retired.*Factory/i);
  });
}
