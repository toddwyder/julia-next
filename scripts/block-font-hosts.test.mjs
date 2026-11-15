import assert from 'node:assert/strict';
import test from 'node:test';

import { isBlocked, missingEntries } from './block-font-hosts.mjs';
import { FONT_HOSTS } from './font-hosts.mjs';

test('asks for one blocking line per font host when none is blocked', () => {
  assert.deepEqual(missingEntries('127.0.0.1 localhost\n'), FONT_HOSTS.map(host => `0.0.0.0 ${host}`));
});

test('asks for nothing when every font host is already blocked', () => {
  assert.deepEqual(missingEntries(`127.0.0.1 localhost\n0.0.0.0 ${FONT_HOSTS.join(' ')}\n`), []);
});

test('asks only for the hosts still open, and ignores a comment or another address', () => {
  const text = `# 0.0.0.0 ${FONT_HOSTS[1]}\n0.0.0.0 ${FONT_HOSTS[0]}\n127.0.0.1 ${FONT_HOSTS[2]}\n`;
  assert.deepEqual(missingEntries(text), FONT_HOSTS.slice(1).map(host => `0.0.0.0 ${host}`));
});

test('counts only 0.0.0.0 as blocked', () => {
  assert.equal(isBlocked('0.0.0.0'), true);
  assert.equal(isBlocked('142.250.80.46'), false);
  assert.equal(isBlocked('127.0.0.1'), false);
});
