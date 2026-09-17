import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readSecret, secretAuthHeader, KNOWN_FIELDS } from './read-secret.mjs';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'read-secret-test-'));
}

test('readSecret returns a raw (non-KEY=VALUE) token file\'s exact content, trimmed of one trailing newline', () => {
  const dir = tmpDir();
  writeFileSync(join(dir, 'sentry.env'), 'sntsyu_abcDEF1234567890tokenvalue\n');
  assert.equal(readSecret('sentry', { dir }), 'sntsyu_abcDEF1234567890tokenvalue');
});

test('readSecret never shells out, even when the value looks like a shell command -- the original incident', () => {
  const dir = tmpDir();
  // The exact failure mode from JUL-72's incident: `source`-ing this file
  // would have bash try to execute this string as a command ("command not
  // found", echoing it back). readSecret must return it as inert text.
  const dangerous = 'not-a-real-command-but-looks-like-one-1234567890abcdef';
  writeFileSync(join(dir, 'axiom.env'), `${dangerous}\n`);
  assert.equal(readSecret('axiom', { dir }), dangerous);
});

test('readSecret refuses an unknown field name rather than reading an arbitrary path', () => {
  assert.throws(() => readSecret('not-a-real-field'), /unknown field/);
});

test('secretAuthHeader wraps the value as a Bearer header, built in-process', () => {
  const dir = tmpDir();
  writeFileSync(join(dir, 'supabase.env'), 'sbp_token_value_1234567890\n');
  assert.equal(secretAuthHeader('supabase', { dir }), 'Bearer sbp_token_value_1234567890');
});

test('KNOWN_FIELDS is exactly the four services this ticket names', () => {
  assert.deepEqual([...KNOWN_FIELDS].sort(), ['axiom', 'powersync', 'sentry', 'supabase']);
});

test('read-secret.mjs never imports node:child_process -- a static guard against ever shelling out to read a secret', () => {
  const path = new URL('./read-secret.mjs', import.meta.url);
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(text, /child_process/, 'read-secret.mjs must never import or reference node:child_process');
  assert.doesNotMatch(text, /\bexecFile\b|\bexec\(|\bspawn\(/, 'read-secret.mjs must never shell out');
});
