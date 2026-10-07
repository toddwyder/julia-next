import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, posix, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const installer = resolve(import.meta.dirname, 'install.sh');

// Use Git Bash on Windows so the fixture PATH resolves its command stubs rather
// than WSL's real npm. Git Bash accepts drive-letter paths with slash separators.
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

function bashPath(path) {
  if (process.platform !== 'win32') return path;
  return path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function bashEnvironmentPath(path) {
  if (process.platform !== 'win32') return path;
  return path
    .replaceAll('\\', '/')
    .replace(/([A-Za-z]):\//g, (_, drive) => `/${drive.toLowerCase()}/`)
    .replaceAll(';', ':');
}

function installWithBash(installerPath, target, options = {}) {
  const { systemctl = true, ...spawnOptions } = options;
  if (!systemctl) return spawnSync(bash, [bashPath(installerPath), bashPath(target)], spawnOptions);
  const shim = resolve(dirname(target), 'installer-systemctl-bin');
  mkdirSync(shim, { recursive: true });
  writeFileSync(resolve(shim, 'systemctl'), `#!/bin/sh
case "$1" in
  restart|is-active) exit 0 ;;
  show) pwd ;;
  *) exit 17 ;;
esac
`, { mode: 0o755 });
  const env = spawnOptions.env ?? process.env;
  return spawnSync(bash, [bashPath(installerPath), bashPath(target)], {
    ...spawnOptions,
    env: { ...env, PATH: `${bashPath(shim)}:${bashEnvironmentPath(env.PATH)}` },
  });
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
    'ops/factory/run-psql.mjs',
  ]) {
    assert.equal(readFileSync(resolve(target, file), 'utf8'), readFileSync(resolve(root, 'ops/factory', file.split('/').pop()), 'utf8'), file);
  }
});

test('a clean install carries only the Factory review surface the entry point imports, so check and build resolve it', () => {
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
  // The graph reaches the stock Factory review skill and retention modules;
  // the retired cross-maker route must not remain reachable from the deploy.
  for (const required of [
    'src/mastra/observability-store',
    'src/mastra/observability-retention',
  ]) {
    assert.ok(graph.has(required), `entry point no longer imports ${required}`);
    assert.ok(
      existsSync(resolve(target, `${required}.ts`)),
      `a clean install left ${required}.ts missing; npm run check/build cannot resolve it`,
    );
  }
  assert.ok(!graph.has('src/mastra/reviewer/workflows/cross-maker-review-workflow'));

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
  mkdirSync(resolve(target, 'src/mastra/reviewer'), { recursive: true });
  writeFileSync(resolve(target, 'src/mastra/reviewer/retired-route.ts'), 'retired reviewer');
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
  assert.equal(existsSync(resolve(target, 'src/mastra/reviewer')), false, 'install removes the retired reviewer tree');
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

test('a root-run install hands the Mastra build to the app directory owner', () => {
  // Live installs are authorized through sudo, while the long-running service
  // is julia-factory. The generated .mastra tree must therefore be built by
  // the app owner; otherwise a later service-account rebuild cannot replace it.
  const tmp = mkdtempSync(resolve(tmpdir(), 'julia-factory-root-install-'));
  const target = resolve(tmp, 'target');
  const bin = resolve(tmp, 'bin');
  const log = resolve(tmp, 'commands.log');
  const rootShellEnv = resolve(tmp, 'root-shell-env.sh');
  mkdirSync(target);
  mkdirSync(bin);
  writeFileSync(rootShellEnv, `
id() { echo 0; }
stat() { echo julia-factory; }
chown() { printf 'chown %s\\n' "$*" >> "$STUB_LOG"; }
runuser() {
  test "$1" = -u && test "$2" = julia-factory && test "$3" = -- || return 19
  printf 'runuser %s %s\\n' "$2" "$*" >> "$STUB_LOG"
  shift 3
  SERVICE_OWNER=julia-factory "$@"
}
`);
  writeFileSync(resolve(bin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });
  writeFileSync(resolve(bin, 'stat'), '#!/bin/sh\necho julia-factory\n', { mode: 0o755 });
  writeFileSync(resolve(bin, 'chown'), '#!/bin/sh\nprintf "chown %s\\n" "$*" >> "$STUB_LOG"\n', { mode: 0o755 });
  writeFileSync(resolve(bin, 'runuser'), `#!/bin/sh
test "$1" = -u && test "$2" = julia-factory && test "$3" = -- || exit 19
printf 'runuser %s %s\\n' "$2" "$*" >> "$STUB_LOG"
shift 3
SERVICE_OWNER=julia-factory "$@"
`, { mode: 0o755 });
  writeFileSync(resolve(bin, 'npm'), `#!/bin/sh
printf 'npm %s owner=%s\\n' "$*" "$SERVICE_OWNER" >> "$STUB_LOG"
if [ "$1" = run ] && [ "$2" = build ]; then
  mkdir -p .mastra/output
  printf 'built-by=%s\\n' "$SERVICE_OWNER" > .mastra/output/index.mjs
fi
`, { mode: 0o755 });

  const result = installWithBash(installer, target, {
    cwd: tmp,
    env: { ...process.env, PATH: `${bashPath(bin)}:${process.env.PATH}`, STUB_LOG: log, BASH_ENV: bashPath(rootShellEnv) },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(resolve(target, '.mastra/output/index.mjs'), 'utf8'), 'built-by=julia-factory\n');
  const commands = readFileSync(log, 'utf8');
  assert.match(commands, /chown -R julia-factory:julia-factory/);
  assert.equal((commands.match(/runuser julia-factory/g) ?? []).length, 3);
  assert.match(commands, /npm run build owner=julia-factory/);
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
    'src/mastra/issue-cost-capture.ts', 'src/mastra/model-price-refresh.ts',
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

test('an install marks the deployed commit and verifies the restarted service uses that marked app', () => {
  const tmp = mkdtempSync(resolve(tmpdir(), 'julia-factory-version-marker-'));
  const target = resolve(tmp, 'target');
  const bin = resolve(tmp, 'bin');
  const log = resolve(tmp, 'commands.log');
  mkdirSync(target);
  mkdirSync(bin);
  for (const command of ['npm', 'python3', 'node']) {
    writeFileSync(resolve(bin, command), `#!/bin/sh\nif [ '${command}' = npm ] && [ \"$1\" = build ]; then mkdir -p .mastra/output; fi\n`, { mode: 0o755 });
  }
  writeFileSync(resolve(bin, 'systemctl'), `#!/bin/sh
printf '%s %s\\n' systemctl \"$*\" >> \"$STUB_LOG\"
case \"$1\" in
  restart) exit 0 ;;
  is-active) exit 0 ;;
  show) realpath \"$FACTORY_APP_DIR\" ;;
  *) exit 17 ;;
esac
`, { mode: 0o755 });

  const result = installWithBash(installer, target, {
    cwd: tmp,
    env: {
      ...process.env,
      PATH: `${bashPath(bin)}:${process.env.PATH}`,
      STUB_LOG: log,
      FACTORY_APP_DIR: bashPath(target),
    },
    encoding: 'utf8',
    systemctl: false,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(resolve(target, 'BUILD_COMMIT'), 'utf8').trim(),
    execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  );
  assert.match(readFileSync(log, 'utf8'), /systemctl restart julia-factory-trial\.service/);
  assert.match(readFileSync(log, 'utf8'), /systemctl is-active --quiet julia-factory-trial\.service/);
  assert.match(readFileSync(log, 'utf8'), /systemctl show julia-factory-trial\.service --property=WorkingDirectory --value/);
});

test('a failed post-restart version check restores the previous app and restarts it', () => {
  const tmp = mkdtempSync(resolve(tmpdir(), 'julia-factory-version-rollback-'));
  const target = resolve(tmp, 'target');
  const bin = resolve(tmp, 'bin');
  const log = resolve(tmp, 'commands.log');
  mkdirSync(target);
  const originalMode = statSync(target).mode & 0o777;
  mkdirSync(bin);
  writeFileSync(resolve(target, 'BUILD_COMMIT'), 'previous-commit\n');
  writeFileSync(resolve(target, 'keep-after-rollback'), 'previous app bytes\n');
  for (const command of ['npm', 'python3', 'node']) {
    writeFileSync(resolve(bin, command), `#!/bin/sh\nif [ '${command}' = npm ] && [ \"$1\" = build ]; then mkdir -p .mastra/output; fi\n`, { mode: 0o755 });
  }
  writeFileSync(resolve(bin, 'systemctl'), `#!/bin/sh
printf '%s %s\\n' systemctl \"$*\" >> \"$STUB_LOG\"
case \"$1\" in
  restart) exit 0 ;;
  is-active) exit 0 ;;
  show) printf '%s\\n' /wrong/app ;;
  *) exit 17 ;;
esac
`, { mode: 0o755 });

  const result = installWithBash(installer, target, {
    cwd: tmp,
    env: { ...process.env, PATH: `${bashPath(bin)}:${process.env.PATH}`, STUB_LOG: log },
    encoding: 'utf8',
    systemctl: false,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Factory install verification failed: service working directory/);
  assert.equal(readFileSync(resolve(target, 'BUILD_COMMIT'), 'utf8'), 'previous-commit\n');
  assert.equal(readFileSync(resolve(target, 'keep-after-rollback'), 'utf8'), 'previous app bytes\n');
  assert.equal(statSync(target).mode & 0o777, originalMode, 'rollback preserves the previous app directory mode');
  assert.equal((readFileSync(log, 'utf8').match(/systemctl restart julia-factory-trial\.service/g) ?? []).length, 2);
});
