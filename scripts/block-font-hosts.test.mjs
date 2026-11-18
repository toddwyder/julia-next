import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FONT_HOSTS } from './font-hosts.mjs';
import { MARKER, assertHostsBlocked, blockedText, missingBlocks, unblockedText } from './block-font-hosts.mjs';

const SCRIPT = fileURLToPath(new URL('./block-font-hosts.mjs', import.meta.url));

const dirs = [];
after(() => dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })));

function hostsFile(text) {
  const dir = mkdtempSync(join(tmpdir(), 'font-hosts-'));
  dirs.push(dir);
  const path = join(dir, 'hosts');
  writeFileSync(path, text);
  return path;
}

test('every font host is pointed at loopback over IPv4 and IPv6', () => {
  const text = blockedText('127.0.0.1 localhost\n');
  for (const host of FONT_HOSTS) {
    assert.match(text, new RegExp(`^0\\.0\\.0\\.0 ${host.replaceAll('.', '\\.')} `, 'm'));
    assert.match(text, new RegExp(`^:: ${host.replaceAll('.', '\\.')} `, 'm'));
  }
});

test('blocking twice changes nothing the second time', () => {
  const once = blockedText('127.0.0.1 localhost\n');
  assert.equal(blockedText(once), once);
});

test('blocking keeps the hosts entries it did not write', () => {
  const text = blockedText('127.0.0.1 localhost\n10.0.0.5 julia.lan\n');
  assert.match(text, /^127\.0\.0\.1 localhost$/m);
  assert.match(text, /^10\.0\.0\.5 julia\.lan$/m);
});

test('unblocking leaves the hosts file as it was', () => {
  const before = '127.0.0.1 localhost\n10.0.0.5 julia.lan\n';
  assert.equal(unblockedText(blockedText(before)), before);
});

test('a hosts file with no block reports every missing line', () => {
  assert.equal(missingBlocks('127.0.0.1 localhost\n').length, FONT_HOSTS.length * 2);
  assert.deepEqual(missingBlocks(blockedText('127.0.0.1 localhost\n')), []);
});

test('a host that still answers fails the check and is named', async () => {
  await assert.rejects(
    assertHostsBlocked({ hosts: ['fonts.googleapis.com'], probe: async () => true }),
    /fonts\.googleapis\.com accepted a connection/,
  );
});

test('hosts that refuse a connection pass', async () => {
  await assertHostsBlocked({ hosts: FONT_HOSTS, probe: async () => false });
});

test('--check fails on a hosts file that was never blocked', () => {
  const path = hostsFile('127.0.0.1 localhost\n');
  const result = spawnSync(process.execPath, [SCRIPT, '--check', '--hosts', path], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing 8 font host lines/);
});

test('--unblock removes only the lines this script wrote', () => {
  const path = hostsFile(blockedText('127.0.0.1 localhost\n'));
  const result = spawnSync(process.execPath, [SCRIPT, '--unblock', '--hosts', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path, 'utf8'), '127.0.0.1 localhost\n');
  assert.doesNotMatch(readFileSync(path, 'utf8'), new RegExp(MARKER));
});
