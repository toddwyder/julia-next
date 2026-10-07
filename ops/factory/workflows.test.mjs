import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

const workflows = resolve(import.meta.dirname, '../../.github/workflows');
const ci = readFileSync(resolve(workflows, 'ci.yml'), 'utf8');

test('CI checks the current app but does not run retired graph tests', () => {
  for (const file of ['health-route', 'dynamic-route', 'web-app', 'agent-docs', 'line-endings', 'no-personal-paths', 'framework-lint', 'merge-pr', 'publish-pr', 'publish-pr.real-git', 'publish-via-github-app']) {
    assert.ok(ci.includes(`scripts/${file}.test.mjs`), `missing ${file}`);
  }
  assert.doesNotMatch(ci, /node --test scripts\/\*\.test\.mjs|graph\/pydantic\/requirements\.txt|scripts\/independent-review\.test\.mjs/);
  assert.match(ci, /run: npm run build/);
});

test('CI retains the trace retention tests but not retired Monday-note tests', () => {
  assert.ok(ci.includes('ops/factory/trace-retention.test.mjs'));
  assert.doesNotMatch(ci, /ops\/factory\/monday-note/);
});


test('CI runs the app DuckDB observability retention tests the repo-standard way', () => {
  // The app's TypeScript tests are runnable with Node's built-in type stripping
  // plus the repo's `.js` -> `.ts` resolve hook, the same mechanism CI already
  // uses for local-sandbox.test.mjs -- no extra tooling dependency (e.g. tsx) is
  // added just to run a test.
  assert.match(ci, /--experimental-strip-types/);
  assert.match(ci, /--import .\/register-typescript-esm\.mjs/);
  assert.match(ci, /observability-retention\.test\.mjs/);
  assert.match(ci, /observability-retention-schedule\.test\.mjs/);
  assert.doesNotMatch(ci, /--import tsx/);
});

test('CI cancels superseded runs and retains its required job for docs-only PRs', () => {
  assert.match(ci, /cancel-in-progress: true/);
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
