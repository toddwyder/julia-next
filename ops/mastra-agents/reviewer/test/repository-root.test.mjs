import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('the reviewer locates its enclosing Git repository', () => {
  const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = resolve(spikeRoot, '..', '..', '..');
  assert.equal(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repoRoot, encoding: 'utf8' }).trim(), repoRoot.replaceAll('\\', '/'));
});
