import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

const workflows = resolve(import.meta.dirname, '../../.github/workflows');
const publisher = readFileSync(resolve(workflows, 'publisher-only-pr.yml'), 'utf8');
const ci = readFileSync(resolve(workflows, 'ci.yml'), 'utf8');

test('publisher gate schedules on GitHub and checks both allowed authors without checkout', () => {
  assert.match(publisher, /check:\s*\n\s+runs-on: ubuntu-latest/);
  assert.match(publisher, /julia-graph-publisher\[bot\]/);
  assert.match(publisher, /julia-factory-todd-wyder\[bot\]/);
  assert.match(publisher, /exit 1/);
  assert.doesNotMatch(publisher, /- uses: actions\/checkout@/);
});

test('CI checks the current app but does not run retired graph tests', () => {
  for (const file of ['health-route', 'dynamic-route', 'web-app', 'agent-docs', 'line-endings', 'no-personal-paths', 'framework-lint', 'merge-pr', 'publish-pr', 'publish-pr.real-git', 'publish-via-github-app']) {
    assert.ok(ci.includes(`scripts/${file}.test.mjs`), `missing ${file}`);
  }
  assert.doesNotMatch(ci, /node --test scripts\/\*\.test\.mjs|graph\/pydantic\/requirements\.txt|scripts\/independent-review\.test\.mjs/);
  assert.match(ci, /run: npm run build/);
});

test('CI runs the Monday note and trace retention tests that issue #140 adds', () => {
  for (const file of ['monday-note', 'trace-retention']) {
    assert.ok(ci.includes(`ops/factory/${file}.test.mjs`), `CI does not run ops/factory/${file}.test.mjs`);
  }
});

test('both workflows cancel superseded runs; CI retains its required job for docs-only PRs', () => {
  for (const workflow of [publisher, ci]) {
    assert.match(workflow, /cancel-in-progress: true/);
  }
  assert.doesNotMatch(ci, /\n\s+paths(?:-ignore)?:/);
  assert.match(ci, /checks:\s*\n(?:\s*#[^\n]*\n)*\s+runs-on: ubuntu-22\.04/);
  assert.match(ci, /docs\//);
  assert.match(ci, /if: steps\.changes\.outputs\.docs_only != 'true'/);
});

test('documentation-only detection skips heavy steps only for nonempty Markdown-only changes', () => {
  const script = ci.match(/      - name: Detect documentation-only PR\n[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - uses:)/)?.[1]
    .replace(/^          /gm, '');
  assert.ok(script);
  const dir = mkdtempSync(resolve(tmpdir(), 'factory-ci-changes-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'Fixture');
  mkdirSync(resolve(dir, 'docs'));
  writeFileSync(resolve(dir, 'docs', 'setup.md'), 'before\n');
  git('add', '.');
  git('commit', '-qm', 'baseline');
  const base = git('rev-parse', 'HEAD');
  const detect = (head) => {
    const output = resolve(dir, '.git', 'output');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-c', script], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(output, 'utf8').trim();
  };
  assert.equal(detect(base), 'docs_only=false');
  writeFileSync(resolve(dir, 'docs', 'setup.md'), 'after\n');
  git('add', '.');
  git('commit', '-qm', 'docs change');
  assert.equal(detect(git('rev-parse', 'HEAD')), 'docs_only=true');
  writeFileSync(resolve(dir, 'app.js'), 'export const value = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'code change');
  assert.equal(detect(git('rev-parse', 'HEAD')), 'docs_only=false');
  git('rm', 'docs/setup.md');
  git('commit', '-qm', 'delete docs');
  assert.equal(detect(git('rev-parse', 'HEAD')), 'docs_only=false');
});
