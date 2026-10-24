import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkNoFakes, findFakeOutsideServices } from './check-no-fakes.mjs';

function findings(file, text) {
  return findFakeOutsideServices({ file, text });
}

test('refuses a test that names an outside service and a stand-in together', () => {
  const result = findings('test/linear-sync.test.mjs', "import { fakeLinear } from './fake-linear.mjs';\ntest('syncs', () => fakeLinear());\n");
  assert.equal(result.length, 2);
  assert.match(result[0], /test\/linear-sync\.test\.mjs:1: a test names an outside service and a stand-in together/);
});

test('refuses a local server that stands in for a named outside service', () => {
  const result = findings('test/provider.test.mjs', [
    "import { createServer } from 'node:http';",
    "test('calls the model provider', async () => {",
    '  const server = createServer((request, response) => response.end());',
    '  server.listen(0);',
    '});',
  ].join('\n'));
  assert.equal(result.length, 1);
  assert.match(result[0], /a local server stands in for the outside service named on line 2/);
});

test('refuses replacing global fetch for a named outside service', () => {
  const result = findings('test/github.test.mjs', [
    "test('reads GitHub', () => {",
    '  globalThis.fetch = async () => new Response();',
    '});',
  ].join('\n'));
  assert.equal(result.length, 1);
  assert.match(result[0], /the global fetch is replaced for the outside service named on line 1/);
});

test('refuses a mocking library used for a named outside service', () => {
  const result = findings('test/reviewer.test.mjs', "import nock from 'nock';\ntest('reviews with the provider', () => {});\n");
  assert.equal(result.length, 1);
  assert.match(result[0], /a mocking library stands in for an outside service named on line 2/);
});

test('keeps a local server test that names no outside service', () => {
  assert.deepEqual(findings('test/control-page.test.mjs', "import { createServer } from 'node:http';\ncreateServer().listen(0);\n"), []);
});

test('keeps an outside-service test that uses no stand-in', () => {
  assert.deepEqual(findings('test/linear.test.mjs', "test('reads Linear', async () => fetch('https://api.linear.app'));\n"), []);
});

test('keeps a no-network guard and its restore', () => {
  assert.deepEqual(findings('test/credentials.test.mjs', [
    "test('reads a local credential for the openai-codex service', async () => {",
    '  const originalFetch = globalThis.fetch;',
    '  globalThis.fetch = () => { throw new Error(\'must not use the network\') };',
    '  try { await readLocalCredential(); } finally { globalThis.fetch = originalFetch; }',
    '});',
  ].join('\n')), []);
});

test('keeps plain loopback host strings and synthetic credential names', () => {
  assert.deepEqual(findings('test/host.test.mjs', [
    "test('matches the Tailscale host and loopback', () => {",
    "  assert.equal(isAllowed('127.0.0.1:43123'), true);",
    "  const access = 'openai-codex-synthetic-access';",
    '});',
  ].join('\n')), []);
});

test('keeps retired-name regexes that name an old stand-in file', () => {
  assert.deepEqual(findings('test/retired.test.mjs', [
    "assert.doesNotMatch(suite, /service-dropbox\\.test/);",
    "assert.doesNotMatch(suite, /stand-in-seat\\.test/);",
  ].join('\n')), []);
});

test('ignores a non-test file even when it contains the same words', () => {
  assert.deepEqual(findings('lib/linear-client.mjs', "const fake = 'linear';\ncreateServer().listen(0);\n"), []);
});

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'no-fakes-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  const write = (path, content) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const commit = message => {
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: root });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  };
  return { root, write, commit };
}

test('checks only the tests changed since the base commit', t => {
  const repo = repository(t);
  repo.write('test/old.test.mjs', "import nock from 'nock';\ntest('provider', () => {});\n");
  const base = repo.commit('old test');
  repo.write('test/clean.test.mjs', "test('reads Linear', async () => fetch('https://api.linear.app'));\n");
  repo.commit('clean test');
  assert.deepEqual(checkNoFakes({ root: repo.root, base }), []);
  repo.write('test/new.test.mjs', "import nock from 'nock';\ntest('provider', () => {});\n");
  repo.commit('new fake');
  assert.deepEqual(checkNoFakes({ root: repo.root, base }).map(line => line.split(':')[0]), ['test/new.test.mjs']);
});

test('the command exits nonzero and names the changed test', t => {
  const repo = repository(t);
  repo.write('test/provider.test.mjs', "import nock from 'nock';\ntest('provider', () => {});\n");
  repo.commit('fake provider');
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'check-no-fakes.mjs'), '--all', '--root', repo.root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /test\/provider\.test\.mjs:1: a mocking library stands in for an outside service/);
});
