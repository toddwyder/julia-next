import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const installer = resolve(import.meta.dirname, 'install.sh');

test('the installer copies the issue #140 Monday note and retention programs into the app', () => {
  const tmp = mkdtempSync(resolve(tmpdir(), 'julia-factory-install-140-'));
  const target = resolve(tmp, 'target');
  const bin = resolve(tmp, 'bin');
  mkdirSync(target);
  mkdirSync(bin);
  for (const command of ['npm', 'python3', 'node']) {
    const stub = resolve(bin, command);
    writeFileSync(stub, `#!/bin/sh\nif [ '${command}' = npm ] && [ "$1" = build ]; then mkdir -p .mastra/output; fi\n`);
    spawnSync('chmod', ['+x', stub]);
  }
  const result = spawnSync('bash', [installer, target], {
    cwd: tmp,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  for (const file of [
    'ops/factory/monday-note.mjs',
    'ops/factory/monday-note-run.mjs',
    'ops/factory/monday-note-adapters.mjs',
    'ops/factory/mastra-traces.mjs',
    'ops/factory/trace-retention.mjs',
    'ops/factory/factory-cards.mjs',
    'ops/factory/factory-cards.sql',
  ]) {
    assert.equal(readFileSync(resolve(target, file), 'utf8'), readFileSync(resolve(root, 'ops/factory', file.split('/').pop()), 'utf8'), file);
  }
});

test('a repo-sourced install preserves service secrets and applies the WorkOS patch before and after build', () => {
  const tmp = mkdtempSync(resolve(tmpdir(), 'julia-factory-install-'));
  const target = resolve(tmp, 'target');
  const bin = resolve(tmp, 'bin');
  const log = resolve(tmp, 'commands.log');
  mkdirSync(target);
  mkdirSync(bin);
  writeFileSync(resolve(target, '.env'), 'KEEP_THIS_SECRET=fixture\n');
  writeFileSync(resolve(target, 'runtime.db'), 'existing state');
  for (const command of ['npm', 'python3', 'node']) {
    const stub = resolve(bin, command);
    writeFileSync(stub, `#!/bin/sh\nprintf '%s %s\\n' '${command}' "$*" >> "$STUB_LOG"\nif [ '${command}' = npm ] && [ "$1" = build ]; then mkdir -p .mastra/output; fi\n`);
    spawnSync('chmod', ['+x', stub]);
  }
  const result = spawnSync('bash', [installer, target], {
    cwd: tmp,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  for (const file of [
    'package.json', 'package-lock.json', 'tsconfig.json', 'src/mastra/index.ts', 'src/mastra/local-sandbox.ts',
    'src/mastra/public/factory-skills/factory-plan/SKILL.md',
    'src/mastra/public/factory-skills/factory-review/SKILL.md',
  ]) {
    assert.equal(readFileSync(resolve(target, file), 'utf8'), readFileSync(resolve(root, 'ops/factory/app', file), 'utf8'), file);
  }
  assert.equal(readFileSync(resolve(target, '.env'), 'utf8'), 'KEEP_THIS_SECRET=fixture\n');
  assert.equal(readFileSync(resolve(target, 'runtime.db'), 'utf8'), 'existing state');
  assert.equal(readFileSync(log, 'utf8').trim(), [
    'npm ci',
    `python3 ${resolve(import.meta.dirname, 'apply-install-patches.py')} ${target}`,
    `node ${resolve(import.meta.dirname, 'workos-cookie-identity.check.mjs')} ${target}`,
    'npm run check',
    'npm run build',
    `python3 ${resolve(import.meta.dirname, 'apply-install-patches.py')} ${target}`,
    `node ${resolve(import.meta.dirname, 'workos-cookie-identity.check.mjs')} ${target}/.mastra/output`,
  ].join('\n'));
  const plan = resolve(target, 'src/mastra/public/factory-skills/factory-plan/SKILL.md');
  writeFileSync(plan, 'stale plan');  const repeated = spawnSync('bash', [installer, target], {
    cwd: tmp,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log },
    encoding: 'utf8',
  });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(readFileSync(plan, 'utf8'), readFileSync(resolve(root, 'ops/factory/app/src/mastra/public/factory-skills/factory-plan/SKILL.md'), 'utf8'));
  assert.equal(readFileSync(resolve(target, '.env'), 'utf8'), 'KEEP_THIS_SECRET=fixture\n');
  assert.equal(readFileSync(resolve(target, 'runtime.db'), 'utf8'), 'existing state');
});

test('a missing required skill leaves an existing install untouched', () => {
  const tmp = mkdtempSync(resolve(tmpdir(), 'julia-factory-missing-skill-'));
  const target = resolve(tmp, 'target');
  const source = resolve(tmp, 'app');
  mkdirSync(target);
  writeFileSync(resolve(target, 'package.json'), 'existing manifest');
  for (const file of [
    'package.json', 'package-lock.json', 'tsconfig.json', 'src/mastra/index.ts', 'src/mastra/local-sandbox.ts',
    'src/mastra/public/factory-skills/factory-plan/SKILL.md',
  ]) {
    const destination = resolve(source, file);
    mkdirSync(resolve(destination, '..'), { recursive: true });
    copyFileSync(resolve(root, 'ops/factory/app', file), destination);
  }
  copyFileSync(installer, resolve(tmp, 'install.sh'));
  const bin = resolve(tmp, 'bin');
  mkdirSync(bin);
  writeFileSync(resolve(bin, 'npm'), '#!/bin/sh\nexit 9\n', { mode: 0o755 });
  const result = spawnSync('bash', [resolve(tmp, 'install.sh'), target], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing Factory source.*factory-review\/SKILL\.md/i);
  assert.equal(readFileSync(resolve(target, 'package.json'), 'utf8'), 'existing manifest');
});

test('an incomplete repository source leaves an existing install untouched', () => {
  const tmp = mkdtempSync(resolve(tmpdir(), 'julia-factory-incomplete-'));
  const target = resolve(tmp, 'target');
  mkdirSync(target);
  writeFileSync(resolve(target, 'package.json'), 'existing manifest');
  copyFileSync(installer, resolve(tmp, 'install.sh'));
  const result = spawnSync('bash', [resolve(tmp, 'install.sh'), target], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing Factory source/i);
  assert.equal(readFileSync(resolve(target, 'package.json'), 'utf8'), 'existing manifest');
});
