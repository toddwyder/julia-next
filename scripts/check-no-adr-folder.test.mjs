import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkNoAdrFolder } from './check-no-adr-folder.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_SCRIPT = join(REPO_ROOT, 'scripts/check-no-adr-folder.mjs');

test('a clean tree without docs/adr passes the check', () => {
  const root = mkdtempSync(join(tmpdir(), 'no-adr-clean-'));
  try {
    assert.deepEqual(checkNoAdrFolder(root), []);
    const result = spawnSync(process.execPath, [CHECK_SCRIPT, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('planting a document in docs/adr fails the check and names the planted file', () => {
  const root = mkdtempSync(join(tmpdir(), 'no-adr-plant-'));
  try {
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
    writeFileSync(join(root, 'docs', 'adr', '0031-planted-decision.md'), '# Planted ADR\n');
    const failures = checkNoAdrFolder(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /docs\/adr/);
    assert.match(failures[0], /0031-planted-decision\.md/);

    const result = spawnSync(process.execPath, [CHECK_SCRIPT, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'the planted ADR document must fail the CLI check');
    assert.match(result.stderr, /0031-planted-decision\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the repository itself has no docs/adr folder', () => {
  assert.deepEqual(checkNoAdrFolder(REPO_ROOT), []);
});
