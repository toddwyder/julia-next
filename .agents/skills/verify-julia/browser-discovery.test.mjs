import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const repository = resolve(import.meta.dirname, '../../..');
test('a sibling skill browser test runs without changing Playwright ownership configuration', t => {
  const root = mkdtempSync(join(tmpdir(), 'skill-browser-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT' && !key.startsWith('GIT_')));
  env.JULIA_VERIFY_URL = 'http://127.0.0.1:9';
  execFileSync('git', ['init', '-q', root], { env });
  function write(path, text) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'junction');
  write('package.json', '{"type":"module"}');
  write('playwright.config.mjs', readFileSync(join(repository, 'playwright.config.mjs'), 'utf8'));
  write('.gitignore', 'ignored/\nnode_modules/\n');
  const spec = name => `import { expect, test } from '@playwright/test'; test('${name}', () => expect(42).toBe(42));`;
  write('.agents/skills/verify-julia/tests/existing.spec.mjs', spec('existing skill runs'));
  write('.agents/skills/new-sibling/tests/new.spec.mjs', spec('sibling skill runs'));
  write('ignored/ignored.spec.mjs', "throw new Error('Git-ignored artifacts must not execute');");
  write('scripts/node-owner.test.mjs', "throw new Error('Node tests must not execute as Playwright tests');");
  const cli = join(repository, 'node_modules/playwright/cli.js');
  const targeted = spawnSync(process.execPath, [cli, 'test', '.agents/skills/new-sibling/tests/new.spec.mjs', '--reporter=line'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(targeted.status, 0, targeted.stdout + targeted.stderr);
  assert.match(targeted.stdout, /1 passed/);
  const all = spawnSync(process.execPath, [cli, 'test', '--reporter=line'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(all.status, 0, all.stdout + all.stderr);
  assert.match(all.stdout, /2 passed/);
});
