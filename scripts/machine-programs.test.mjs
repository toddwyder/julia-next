// The program list stays honest: it passes when it matches, and it fails both
// when a listed program changes and when a new program joins the machine
// without being named.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { checkPrograms, LIST_FILE, PROGRAMS, renderList } = await import('./machine-programs.mjs');

function plant() {
  const root = mkdtempSync(join(tmpdir(), 'programs-'));
  for (const { path } of PROGRAMS) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), `${path}\n`);
  }
  mkdirSync(join(root, 'docs/agents'), { recursive: true });
  writeFileSync(join(root, LIST_FILE), renderList(root));
  return root;
}

test('a list that matches the programs passes', () => {
  const root = plant();
  assert.deepEqual(checkPrograms(root), []);
  rmSync(root, { recursive: true, force: true });
});

test('a listed program that changes fails until the list is written again', () => {
  const root = plant();
  writeFileSync(join(root, 'machine/flow/steps.mjs'), 'changed\n');
  const failures = checkPrograms(root);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /machine\/flow\/steps\.mjs changed/);
  assert.match(failures[0], /--write/);
  rmSync(root, { recursive: true, force: true });
});

test('a new program in the workflow folder fails until the list names it', () => {
  const root = plant();
  writeFileSync(join(root, 'machine/flow/extra.mjs'), 'new\n');
  const failures = checkPrograms(root);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /never names machine\/flow\/extra\.mjs/);
  rmSync(root, { recursive: true, force: true });
});

test('a listed program that is gone fails', () => {
  const root = plant();
  rmSync(join(root, 'machine/flow/trace.mjs'));
  const failures = checkPrograms(root);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /machine\/flow\/trace\.mjs, which no longer exists/);
  rmSync(root, { recursive: true, force: true });
});
