import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { findPersonalPaths, PERSONAL_PATH } from './personal-paths.mjs';

test('a fixture file that contains the escaped form C:\\\\Users\\\\name is flagged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'personal-paths-fixture-'));
  const fixturePath = path.join(dir, 'fixture.mjs');
  try {
    writeFileSync(fixturePath, "const runnerPath = 'C:\\\\Users\\\\toddw\\\\julia-minimal-runner.mjs';\n");
    const contents = readFileSync(fixturePath, 'utf8');
    const paths = findPersonalPaths(contents);
    assert.deepEqual(paths, ['C:\\\\Users\\\\toddw']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findPersonalPaths flags single-backslash form C:\\Users\\name', () => {
  const paths = findPersonalPaths('Path: C:\\Users\\toddw\\bin\\orca.exe');
  assert.deepEqual(paths, ['C:\\Users\\toddw']);
});

test('findPersonalPaths flags escaped double-backslash form C:\\\\Users\\\\name', () => {
  const paths = findPersonalPaths("const orca = 'C:\\\\Users\\\\toddw\\\\bin\\\\orca.exe';");
  assert.deepEqual(paths, ['C:\\\\Users\\\\toddw']);
});

test('findPersonalPaths flags forward-slash form C:/Users/name', () => {
  const paths = findPersonalPaths('const orca = "C:/Users/toddw/bin/orca";');
  assert.deepEqual(paths, ['C:/Users/toddw']);
});

test('findPersonalPaths matches case-insensitively', () => {
  assert.deepEqual(findPersonalPaths('c:\\users\\alice'), ['c:\\users\\alice']);
  assert.deepEqual(findPersonalPaths('C:\\users\\bob'), ['C:\\users\\bob']);
  assert.deepEqual(findPersonalPaths('c:/users/charlie'), ['c:/users/charlie']);
});

test('findPersonalPaths finds multiple paths in text', () => {
  const text = 'Paths: C:\\Users\\alice and C:\\\\Users\\\\bob and C:/Users/charlie';
  const paths = findPersonalPaths(text);
  assert.deepEqual(paths, ['C:\\Users\\alice', 'C:\\\\Users\\\\bob', 'C:/Users/charlie']);
});

test('findPersonalPaths returns empty array when no personal-machine paths exist', () => {
  assert.deepEqual(findPersonalPaths(''), []);
  assert.deepEqual(findPersonalPaths('C:\\Dev\\julia-next'), []);
  assert.deepEqual(findPersonalPaths('/home/runner/julia-next'), []);
  assert.deepEqual(findPersonalPaths('/opt/Orca/orca-ide'), []);
  assert.deepEqual(findPersonalPaths('const x = 42;'), []);
});

test('findPersonalPaths handles non-string inputs safely', () => {
  assert.deepEqual(findPersonalPaths(null), []);
  assert.deepEqual(findPersonalPaths(undefined), []);
  assert.deepEqual(findPersonalPaths(123), []);
});

test('findPersonalPaths handles usernames with dots, hyphens, and underscores', () => {
  assert.deepEqual(findPersonalPaths('C:\\Users\\john.doe-123_test'), ['C:\\Users\\john.doe-123_test']);
});

test('PERSONAL_PATH regex pattern is exported and matches personal paths', () => {
  assert.ok(PERSONAL_PATH.test('C:\\Users\\toddw'));
  assert.ok(PERSONAL_PATH.test('C:\\\\Users\\\\toddw'));
  assert.ok(PERSONAL_PATH.test('C:/Users/toddw'));
  assert.ok(!PERSONAL_PATH.test('C:\\Dev\\julia-next'));
});
