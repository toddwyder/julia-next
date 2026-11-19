import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkGraphSources } from './check-graph-sources.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_SCRIPT = join(REPO_ROOT, 'scripts/check-graph-sources.mjs');

function initRepo(root) {
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'graphify-out'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { next: '16.0.0' } }));
  writeFileSync(join(root, 'src', 'app.js'), 'export const app = 1;\n');
  execFileSync('git', ['add', 'package.json', 'src/app.js'], { cwd: root, stdio: 'ignore' });
}

test('a graph whose entries come from tracked files and installed packages passes', () => {
  const root = mkdtempSync(join(tmpdir(), 'graph-sources-clean-'));
  try {
    initRepo(root);
    writeFileSync(
      join(root, 'graphify-out', 'graph.json'),
      JSON.stringify({
        nodes: [
          { id: 'app', source_file: 'src/app.js' },
          { id: 'next_pkg', source_file: 'next' },
        ],
        links: [{ source: 'app', target: 'next_pkg', source_file: 'src/app.js' }],
        hyperedges: [{ id: 'h1', nodes: ['app'], source_file: 'src/app.js' }],
      }),
    );
    assert.deepEqual(checkGraphSources(root), []);
    const result = spawnSync(process.execPath, [CHECK_SCRIPT, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('planting a graph entry whose source is outside the repository fails the check', () => {
  const root = mkdtempSync(join(tmpdir(), 'graph-sources-plant-'));
  try {
    initRepo(root);
    writeFileSync(
      join(root, 'graphify-out', 'graph.json'),
      JSON.stringify({
        nodes: [
          { id: 'app', source_file: 'src/app.js' },
          { id: 'leaked', source_file: 'advisor-notes/secret.md' },
        ],
        links: [],
        hyperedges: [],
      }),
    );
    const failures = checkGraphSources(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /advisor-notes\/secret\.md/);

    const result = spawnSync(process.execPath, [CHECK_SCRIPT, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'a graph entry from an outside path must fail the CLI check');
    assert.match(result.stderr, /advisor-notes\/secret\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the repository graph contains only tracked paths and installed packages', () => {
  assert.deepEqual(checkGraphSources(REPO_ROOT), []);
});
