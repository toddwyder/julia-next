import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const cli = join(import.meta.dirname, 'test-owners.mjs');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'test-owners-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env }; delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.NODE_TEST_CONTEXT;
  execFileSync('git', ['init', '-q', root], { env });
  function write(path, content) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  function owner(path) {
    write(`${path}/package.json`, '{"type":"module"}');
    write(`${path}/package-lock.json`, '{"lockfileVersion":3,"packages":{}}');
  }
  owner('.');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env });
  return { root, write, owner, run };
}

test('new tests inherit the nearest locked dependency owner and server execution from their folder', t => {
  const f = fixture(t);
  f.owner('ops/new-owner');
  f.write('ops/new-owner/test/unlisted.test.mjs', '');
  f.write('ops/new-owner/test/server/live.test.mjs', '');
  f.write('.agents/skills/example/own.test.mjs', '');
  let result = f.run('--plan');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).owners, [
    { directory: '.', lockfile: 'package-lock.json', runtime: 'node', tests: { local: ['.agents/skills/example/own.test.mjs'], server: [], browser: [] } },
    { directory: 'ops/new-owner', lockfile: 'ops/new-owner/package-lock.json', runtime: 'node', tests: { local: ['ops/new-owner/test/unlisted.test.mjs'], server: ['ops/new-owner/test/server/live.test.mjs'], browser: [] } },
  ]);
  rmSync(join(f.root, '.agents/skills/example'), { recursive: true });
  result = f.run('--plan');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).owners[0].tests.local, []);
});

test('new tests execute with their owner dependencies and isolated Git process state', t => {
  const f = fixture(t);
  f.owner('ops/feature');
  f.write('ops/feature/node_modules/owner-dependency/package.json', '{"type":"module","exports":"./index.mjs"}');
  f.write('ops/feature/node_modules/owner-dependency/index.mjs', 'export default 42;');
  f.write('.gitignore', 'node_modules/\n');
  f.write('ops/feature/test/brand-new.test.mjs', `import assert from 'node:assert/strict';
import test from 'node:test';
import value from 'owner-dependency';
import { writeFileSync } from 'node:fs';
test('newly introduced test executes', () => {
  assert.equal(value, 42);
  assert.equal(process.env.GIT_DIR, undefined);
  writeFileSync('new-test-ran', '42');
});`);
  const env = { ...process.env, GIT_DIR: join(f.root, '.git') }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [cli, '--run', 'local'], { cwd: f.root, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(readFileSync(join(f.root, 'new-test-ran'), 'utf8'), '42');
});

test('server tests are absent from local execution and execute on the server route', t => {
  const f = fixture(t);
  f.write('test/server/new-live.test.mjs', `import test from 'node:test';
import { writeFileSync } from 'node:fs';
test('server-only behavior', () => writeFileSync('server-test-ran', 'server'));`);
  let result = f.run('--run', 'local');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(f.root, 'server-test-ran')), false);
  result = f.run('--run', 'server');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.root, 'server-test-ran'), 'utf8'), 'server');
});

test('a nested browser suite uses its owner executable, configuration, and relative test paths', t => {
  const f = fixture(t);
  f.owner('packages/browser-owner');
  f.write('.gitignore', 'node_modules/\n');
  f.write('node_modules/.bin/playwright', '#!/usr/bin/env node\nprocess.exit(73);\n');
  f.write('packages/browser-owner/node_modules/.bin/playwright', `#!/usr/bin/env node
const fs = require('node:fs');
const config = fs.readFileSync('playwright.config.marker', 'utf8');
fs.writeFileSync('browser-result.json', JSON.stringify({ config, args: process.argv.slice(2) }));
`);
  chmodSync(join(f.root, 'node_modules/.bin/playwright'), 0o755);
  chmodSync(join(f.root, 'packages/browser-owner/node_modules/.bin/playwright'), 0o755);
  f.write('packages/browser-owner/playwright.config.marker', 'nested owner configuration');
  f.write('packages/browser-owner/test/new.spec.mjs', '');
  const result = f.run('--run', 'browser');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'packages/browser-owner/browser-result.json'), 'utf8')), {
    config: 'nested owner configuration', args: ['test', 'test/new.spec.mjs'],
  });
  assert.equal(existsSync(join(f.root, 'browser-result.json')), false);
  const install = f.run('--install-browsers');
  assert.equal(install.status, 0, install.stderr + install.stdout);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'packages/browser-owner/browser-result.json'), 'utf8')), {
    config: 'nested owner configuration', args: ['install', '--with-deps', 'chromium'],
  });
});

test('browser installation installs locked browser owners and leaves other owners untouched', t => {
  const f = fixture(t);
  f.owner('packages/new-browser');
  f.write('.gitignore', 'node_modules/\n');
  f.write('node_modules/untouched.marker', 'root dependencies');
  f.write('packages/new-browser/node_modules/stale.marker', 'replace on clean install');
  f.write('packages/new-browser/test/new.spec.mjs', '');
  const result = f.run('--install', 'browser');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(readFileSync(join(f.root, 'node_modules/untouched.marker'), 'utf8'), 'root dependencies');
  assert.equal(existsSync(join(f.root, 'packages/new-browser/node_modules/stale.marker')), false);
});

test('a Node test owner declaring Playwright gets its browser runtime without a test-name entry', t => {
  const f = fixture(t);
  f.owner('packages/node-browser');
  f.write('.gitignore', 'node_modules/\n');
  f.write('packages/node-browser/package.json', JSON.stringify({ name: 'node-browser', type: 'module', devDependencies: { playwright: '1.63.0' } }));
  f.write('packages/node-browser/test/surface.test.mjs', '');
  f.write('packages/node-browser/node_modules/.bin/playwright', `#!/usr/bin/env node
require('node:fs').writeFileSync('runtime-installed.json',JSON.stringify(process.argv.slice(2)));
`);
  chmodSync(join(f.root, 'packages/node-browser/node_modules/.bin/playwright'), 0o755);
  const result = f.run('--install-browsers', 'local');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'packages/node-browser/runtime-installed.json'), 'utf8')), ['install', '--with-deps', 'chromium']);
});
