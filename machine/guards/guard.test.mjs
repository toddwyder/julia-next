// The guards on the machine workflow folder. Each plant is a file that a change could add;
// the test proves the stock ESLint and dependency-cruiser settings catch it and name the rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import flowConfig from '../../eslint.config.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURES = join(REPO_ROOT, 'machine/guards/fixtures');
const DEPCRUISE = join(REPO_ROOT, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const CRUISE_CONFIG = join(REPO_ROOT, '.dependency-cruiser.mjs');

const lintFixture = async (kind) => {
  const cwd = join(FIXTURES, 'eslint', kind);
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: flowConfig });
  const [result] = await eslint.lintFiles(['machine/flow']);
  return result;
};

const cruise = (cwd) =>
  spawnSync(process.execPath, [DEPCRUISE, '--config', CRUISE_CONFIG, 'machine/flow', 'machine/flow/run.mjs'], {
    cwd,
    encoding: 'utf8',
  });

const cruiseFixture = (kind) => {
  const result = cruise(join(FIXTURES, 'depcruise', kind));
  return { ...result, report: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

test('a plain timer fails the folder guard and names no-restricted-globals', async () => {
  const result = await lintFixture('timer');
  const hits = result.messages.filter((message) => message.ruleId === 'no-restricted-globals');
  assert.equal(hits.length, 1, 'the plant fails once');
  assert.match(hits[0].message, /setTimeout/);
});

test('a timer scheduled through setImmediate fails the folder guard too', async () => {
  const result = await lintFixture('set-immediate');
  const hits = result.messages.filter((message) => message.ruleId === 'no-restricted-globals');
  assert.equal(hits.length, 1, 'the plant fails once');
  assert.match(hits[0].message, /setImmediate/);
});

test('a retry loop controlled by a variable fails the folder guard and names no-restricted-syntax', async () => {
  const result = await lintFixture('variable-loop');
  const hits = result.messages.filter((message) => message.ruleId === 'no-restricted-syntax');
  assert.equal(hits.length, 1, 'the plant fails once');
  assert.match(hits[0].message, /while loops/);
});

test('a clock aliased into a variable still fails the folder guard', async () => {
  const result = await lintFixture('aliased-clock');
  const hits = result.messages.filter((message) => message.ruleId === 'no-restricted-globals');
  assert.equal(hits.length, 1, 'the plant fails once');
  assert.match(hits[0].message, /setTimeout/);
});

test('a comment that switches a guard off fails the folder guard under noInlineConfig', async () => {
  const result = await lintFixture('disable-comment');
  const hits = result.messages.filter((message) => message.message.includes('noInlineConfig'));
  assert.equal(hits.length, 1, 'the plant fails once');
  assert.equal(result.errorCount + result.warningCount > 0, true, 'the run fails because no warning is allowed');
});

test('a hand-built progress file fails the folder guard and names no-restricted-imports', async () => {
  const result = await lintFixture('file-write');
  const hits = result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
  assert.equal(hits.length, 1, 'the plant fails once');
  assert.match(hits[0].message, /writeFileSync/);
});

test('the clean plant passes the folder guard with no message', async () => {
  const result = await lintFixture('clean');
  assert.deepEqual(result.messages, []);
});

test('the folder guard covers the flow definitions and leaves the runner files alone', async () => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  assert.equal(await eslint.isPathIgnored('machine/flow/workflow.mjs'), false);
  assert.equal(await eslint.isPathIgnored('machine/flow/steps.mjs'), false);
  assert.equal(await eslint.isPathIgnored('machine/flow/agents.mjs'), false);
  assert.equal(await eslint.isPathIgnored('machine/flow/schema.mjs'), false);
  assert.equal(await eslint.isPathIgnored('machine/flow/mastra.mjs'), false);
  assert.equal(await eslint.isPathIgnored('machine/flow/run.mjs'), true);
  assert.equal(await eslint.isPathIgnored('machine/flow/start.mjs'), true);
  assert.equal(await eslint.isPathIgnored('machine/flow/scratch.mjs'), true);
  assert.equal(await eslint.isPathIgnored('machine/flow/trace.mjs'), true);
  assert.equal(await eslint.isPathIgnored('machine/flow/workflow.test.mjs'), true);
});

test('a missing or empty workflow folder fails the ESLint step', () => {
  for (const folders of [['machine/flow'], []]) {
    const root = mkdtempSync(join(tmpdir(), 'flow-guard-eslint-'));
    try {
      writeFileSync(join(root, 'eslint.config.mjs'), `export { default } from '${join(REPO_ROOT, 'eslint.config.mjs')}';\n`);
      for (const folder of folders) mkdirSync(join(root, folder), { recursive: true });
      const output = spawnSync(
        process.execPath,
        [join(REPO_ROOT, 'node_modules/eslint/bin/eslint.js'), 'machine/flow', '--max-warnings', '0'],
        { cwd: root, encoding: 'utf8' },
      );
      assert.notEqual(output.status, 0, `the folder ${folders.length ? 'empty of code' : 'missing'} cannot pass`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a piece that reaches an old stage fails the dependency check and names flow-reaches-no-old-stage', () => {
  const result = cruiseFixture('old-stage');
  assert.notEqual(result.status, 0);
  const hits = result.report.match(/flow-reaches-no-old-stage/g) ?? [];
  assert.equal(hits.length, 1, 'the plant fails once');
  assert.match(result.report, /machine\/merge\/gate\.mjs/);
});

test('a library outside the allowed set fails the dependency check and names flow-imports-only-allowed-packages', () => {
  const result = cruiseFixture('disallowed-package');
  assert.notEqual(result.status, 0);
  const hits = result.report.match(/flow-imports-only-allowed-packages/g) ?? [];
  assert.equal(hits.length, 1, 'the plant fails once');
  assert.match(result.report, /node_modules\/next/);
});

test('a piece the entry cannot reach fails the dependency check and names flow-piece-reachable-from-entry', () => {
  const result = cruiseFixture('unreachable');
  assert.notEqual(result.status, 0);
  const hits = result.report.match(/flow-piece-reachable-from-entry/g) ?? [];
  assert.equal(hits.length, 1, 'the plant fails once');
  assert.match(result.report, /machine\/flow\/orphan\.mjs/);
});

test('the clean tree passes the dependency check', () => {
  const result = cruiseFixture('clean');
  assert.equal(result.status, 0, result.report);
});

test('a missing entry or an empty workflow folder fails the dependency check', () => {
  for (const [label, files] of [
    ['without the entry', { 'machine/flow/piece.mjs': 'export const piece = true;\n' }],
    ['empty of code', { 'machine/flow': null }],
  ]) {
    const root = mkdtempSync(join(tmpdir(), 'flow-guard-cruise-'));
    try {
      for (const [path, text] of Object.entries(files)) {
        if (text === null) mkdirSync(join(root, path), { recursive: true });
        else {
          mkdirSync(join(root, 'machine/flow'), { recursive: true });
          writeFileSync(join(root, path), text);
        }
      }
      const result = cruise(root);
      assert.notEqual(result.status, 0, `${label} cannot pass`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('the stock ChatGPT subscription provider passes the dependency check', () => {
  const result = cruiseFixture('codex-provider');
  assert.equal(result.status, 0, result.report);
});

test('the subscription provider exception keeps the rest of Mastra Code forbidden', () => {
  for (const kind of ['code-sdk-root', 'code-sdk-auth']) {
    const result = cruiseFixture(kind);
    assert.notEqual(result.status, 0, result.report);
    assert.match(result.report, /flow-denies-mastra-code-sdk/);
  }
});
