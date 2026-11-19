import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDocModels } from './check-doc-models.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_SCRIPT = join(REPO_ROOT, 'scripts/check-doc-models.mjs');

test('clean agent-facing docs mentioning only free or paid models pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'doc-models-clean-'));
  try {
    mkdirSync(join(root, 'docs', 'agents'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), 'Use a paid model for builds and a free model for checks.\n');
    writeFileSync(join(root, 'docs', 'agents', 'guide.md'), 'Claude Code reads AGENTS.md.\n');
    assert.deepEqual(checkDocModels(root), []);
    const result = spawnSync(process.execPath, [CHECK_SCRIPT, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('planting a specific model name in an agent-facing doc fails the check', () => {
  const root = mkdtempSync(join(tmpdir(), 'doc-models-plant-'));
  try {
    mkdirSync(join(root, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(root, 'docs', 'plans', 'plan.md'),
      'Use deepseek/deepseek-v4.1-flash for everyday coding.\n',
    );
    const failures = checkDocModels(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /docs\/plans\/plan\.md:1:/);
    assert.match(failures[0], /deepseek/i);

    const result = spawnSync(process.execPath, [CHECK_SCRIPT, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'a specific model name in an agent-facing doc must fail');
    assert.match(result.stderr, /docs\/plans\/plan\.md:1:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dated records under docs/agents subdirectories are ignored by the check', () => {
  const root = mkdtempSync(join(tmpdir(), 'doc-models-evidence-'));
  try {
    mkdirSync(join(root, 'docs', 'agents', 'jul-362'), { recursive: true });
    writeFileSync(join(root, 'docs', 'agents', 'jul-362', 'record.md'), 'Ran on Opus 5.5.\n');
    assert.deepEqual(checkDocModels(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the repository agent-facing docs pass with no specific model names', () => {
  assert.deepEqual(checkDocModels(REPO_ROOT), []);
});
