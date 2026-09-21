// test-wrappers.test.mjs -- JUL-98 gap 7. GitHub's automatic run only executes
// `node --test scripts/*.test.mjs`, and the publisher App deliberately cannot
// edit ci.yml (JUL-61 decision). A test file anywhere else therefore reaches
// GitHub only through a wrapper in scripts/ that imports it. A file with no
// wrapper passes locally and never runs on GitHub -- graph/board-spec.test.mjs
// was exactly that until this guard existed. This test fails, and names the
// file, whenever a `*.test.mjs` outside scripts/ has no wrapper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), found);
    } else if (entry.name.endsWith('.test.mjs')) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

// Every test file, as an absolute path, outside scripts/ (the only directory
// CI's glob already covers).
export function testFilesOutsideScripts(repoRoot = REPO_ROOT, scriptsDir = SCRIPTS_DIR) {
  return walk(repoRoot).filter((file) => dirname(file) !== scriptsDir);
}

const IMPORT_SPECIFIER = /\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

// Every file a wrapper directly under scripts/ imports, resolved to an absolute path.
export function importedByWrappers(scriptsDir = SCRIPTS_DIR) {
  const imported = new Set();
  for (const name of readdirSync(scriptsDir)) {
    if (!name.endsWith('.test.mjs')) continue;
    const text = readFileSync(join(scriptsDir, name), 'utf8');
    for (const match of text.matchAll(IMPORT_SPECIFIER)) {
      if (match[1].startsWith('.')) imported.add(resolve(scriptsDir, match[1]));
    }
  }
  return imported;
}

export function unwrappedTestFiles(repoRoot = REPO_ROOT, scriptsDir = SCRIPTS_DIR) {
  const imported = importedByWrappers(scriptsDir);
  return testFilesOutsideScripts(repoRoot, scriptsDir)
    .filter((file) => !imported.has(file))
    .map((file) => relative(repoRoot, file).split(sep).join('/'));
}

test('every *.test.mjs outside scripts/ is imported by a scripts/*.test.mjs wrapper, so GitHub runs it', () => {
  const missing = unwrappedTestFiles();
  assert.deepEqual(
    missing,
    [],
    `no wrapper in scripts/ imports: ${missing.join(', ')} -- add scripts/<name>.test.mjs containing \`import '../<path>';\` or GitHub never runs it`,
  );
  assert.ok(testFilesOutsideScripts().length > 0, 'the walk found the test files it is meant to guard');
});

test('the guard names a test file that has no wrapper (a scratch tree with one wrapped and one unwrapped file)', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'wrappers-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'graph'));
    writeFileSync(join(root, 'graph', 'wrapped.test.mjs'), '');
    writeFileSync(join(root, 'graph', 'lonely.test.mjs'), '');
    writeFileSync(join(root, 'scripts', 'wrapped.test.mjs'), "import '../graph/wrapped.test.mjs';\n");
    assert.deepEqual(unwrappedTestFiles(root, join(root, 'scripts')), ['graph/lonely.test.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
