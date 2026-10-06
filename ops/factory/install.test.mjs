import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, posix, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const installer = resolve(import.meta.dirname, 'install.sh');

// Node passes native Windows paths to a child process verbatim. This machine's
// `bash` is WSL, so translate fixture paths to WSL notation before asking Bash
// to execute the installer. On Unix this is intentionally a no-op.
function bashPath(path) {
  if (process.platform !== 'win32') return path;
  return path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
}

function installWithBash(installerPath, target, options = {}) {
  return spawnSync('bash', [bashPath(installerPath), bashPath(target)], options);
}

/**
 * Every local (`./`) import in a TypeScript/JavaScript module, as the bare
 * module specifier without its extension: `./observability-store.js` ->
 * `./observability-store`. TypeScript resolves `.js` to the sibling `.ts`, so
 * the copied install has to carry the `.ts` source or `npm run check`/`build`
 * cannot resolve the import.
 */
function localImports(source) {
  const found = new Set();
  const pattern = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    found.add(match[1].replace(/\.(js|ts|mjs)$/, ''));
  }
  return [...found];
}

/**
 * Walk the local import graph from an app source file, resolving each `./x` to
 * the `.ts` file that exists in `appDir`, and return every file the compiler
 * (and the Mastra build) must be able to read. This is the set a clean install
 * has to copy: a missing one is an unresolved import at `npm run check`.
 */
function resolveLocalGraph(appDir, entryRel) {
  const seen = new Set();
  const queue = [entryRel];
  while (queue.length > 0) {
    const rel = queue.pop().replace(/\.(js|ts|mjs)$/, '');
    if (seen.has(rel)) continue;
    seen.add(rel);
    const candidates = [`${rel}.ts`, `${rel}/index.ts`];
    const file = candidates.find((candidate) => existsSync(resolve(appDir, candidate)));
    if (!file) continue;
    const source = readFileSync(resolve(appDir, file), 'utf8');
    for (const specifier of localImports(source)) {
      // Keep the graph relative (`resolve` anchors to the process cwd) and
      // normalise `./` / `../` so a module is visited once.
      queue.push(posix.normalize(`${dirname(rel)}/${specifier}`).replace(/^\.\//, ''));
    }
  }
  return seen;
}

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
  const result = installWithBash(installer, target, {
    cwd: tmp,
    env: { ...process.env, PATH: `${bashPath(bin)}:${process.env.PATH}` },
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

test('a clean install carries every app module the entry point imports, so check and build resolve them', () => {
  // The install copies a fixed file list, then runs `npm run check` and
  // `npm run build` in the app. The entry point imports local app modules
  // (the DuckDB observability store and the retention workflow); if any of
  // those is not in the list, a clean install fails to type-check and build.
  // This walks the entry's local import graph and asserts the installed tree
  // contains all of it -- and that check/build run after the copies.
  const tmp = mkdtempSync(resolve(tmpdir(), 'julia-factory-install-graph-'));
  const target = resolve(tmp, 'target');
  const bin = resolve(tmp, 'bin');
  const log = resolve(tmp, 'commands.log');
  mkdirSync(target);
  mkdirSync(bin);
  for (const command of ['npm', 'python3', 'node']) {
    const stub = resolve(bin, command);
    writeFileSync(stub, `#!/bin/sh\nprintf '%s %s\\n' '${command}' "$*" >> "$STUB_LOG"\nif [ '${command}' = npm ] && [ "$1" = build ]; then mkdir -p .mastra/output; fi\n`);
    spawnSync('chmod', ['+x', stub]);
  }
  const result = installWithBash(installer, target, {
    cwd: tmp,
    env: { ...process.env, PATH: `${bashPath(bin)}:${process.env.PATH}`, STUB_LOG: log },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const sourceApp = resolve(root, 'ops/factory/app');
  const graph = resolveLocalGraph(sourceApp, 'src/mastra/index.ts');
  // The graph actually reached the new retention modules; otherwise the test
  // could pass on an install that silently lost them.
  for (const required of [
    'src/mastra/observability-store',
    'src/mastra/observability-retention',
    'src/mastra/reviewer/workflows/cross-maker-review-workflow',
  ]) {
    assert.ok(graph.has(required), `entry point no longer imports ${required}`);
    assert.ok(
      existsSync(resolve(target, `${required}.ts`)),
      `a clean install left ${required}.ts missing; npm run check/build cannot resolve it`,
    );
  }

  // Every resolved local module is present in the install, so tsc/mastra build
  // have no unresolved local import.
  for (const rel of graph) {
    if (!existsSync(resolve(sourceApp, `${rel}.ts`))) continue;
    assert.ok(existsSync(resolve(target, `${rel}.ts`)), `install is missing ${rel}.ts`);
  }

  // check and build run against the copied sources, not before them.
  const commands = readFileSync(log, 'utf8');
  const checkAt = commands.indexOf('npm run check');
  const buildAt = commands.indexOf('npm run build');
  assert.ok(checkAt >= 0 && buildAt > checkAt, 'check/build must run after the sources are copied');
});

test('a repo-sourced install preserves service secrets and builds stock WorkOS auth', () => {
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
  const result = installWithBash(installer, target, {
    cwd: tmp,
    env: { ...process.env, PATH: `${bashPath(bin)}:${process.env.PATH}`, STUB_LOG: log },
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
    'npm run check',
    'npm run build',
  ].join('\n'));
  const plan = resolve(target, 'src/mastra/public/factory-skills/factory-plan/SKILL.md');
  writeFileSync(plan, 'stale plan');  const repeated = installWithBash(installer, target, {
    cwd: tmp,
    env: { ...process.env, PATH: `${bashPath(bin)}:${process.env.PATH}`, STUB_LOG: log },
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
    'src/mastra/observability-store.ts', 'src/mastra/observability-retention.ts',
    'src/mastra/reviewer/workflows/cross-maker-review-workflow.ts',
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
  const result = installWithBash(resolve(tmp, 'install.sh'), target, {
    encoding: 'utf8', env: { ...process.env, PATH: `${bashPath(bin)}:${process.env.PATH}` },
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
  const result = installWithBash(resolve(tmp, 'install.sh'), target, { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing Factory source/i);
  assert.equal(readFileSync(resolve(target, 'package.json'), 'utf8'), 'existing manifest');
});
