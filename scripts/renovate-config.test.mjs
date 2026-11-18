import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const workflowsDir = join(root, '.github/workflows');
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const PINNED_ACTION_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+\s*$/;

function assertPinnedActions(workflowText, workflowName) {
  const usesLines = [...workflowText.matchAll(/^\s*(?:-\s*)?uses:\s*(.+)$/gm)];
  assert.ok(usesLines.length > 0, `${workflowName} should contain at least one uses: reference`);
  for (const [, target] of usesLines) {
    assert.match(
      target.trim(),
      PINNED_ACTION_RE,
      `${workflowName} has unpinned or untagged Action reference: ${target.trim()}`,
    );
  }
}

function assertUsesNvmrc(workflowText, workflowName) {
  assert.doesNotMatch(
    workflowText,
    /^\s*node-version\s*:/m,
    `${workflowName} must not set a literal node-version; use node-version-file: .nvmrc`,
  );
  if (workflowText.includes('actions/setup-node')) {
    assert.match(
      workflowText,
      /^\s*node-version-file:\s*\.nvmrc\s*$/m,
      `${workflowName} must configure actions/setup-node with node-version-file: .nvmrc`,
    );
  }
}

function assertRenovateConfig(config) {
  assert.ok(Array.isArray(config.extends), 'renovate.json must define extends');
  assert.ok(config.extends.includes('config:best-practices'), 'renovate.json must extend config:best-practices');
  assert.ok(config.extends.includes('schedule:weekly'), 'renovate.json must extend schedule:weekly');

  assert.ok(Array.isArray(config.ignorePaths), 'renovate.json must define ignorePaths');
  assert.ok(
    config.ignorePaths.includes('**/node_modules/**'),
    'renovate.json must ignore **/node_modules/**',
  );
  assert.ok(
    config.ignorePaths.includes('.agents/skills/**'),
    'renovate.json must ignore .agents/skills/**',
  );

  assert.notEqual(config.automerge, true, 'renovate.json must not enable top-level automerge');
  assert.equal(config.automergeType, 'pr', 'renovate.json must set automergeType to "pr"');
  assert.equal(config.platformAutomerge, false, 'renovate.json must set platformAutomerge to false');
  assert.equal(config.lockFileMaintenance?.enabled, true, 'renovate.json must enable lockFileMaintenance');
  assert.equal(config.lockFileMaintenance?.automerge, true, 'renovate.json must enable lockFileMaintenance.automerge');

  assert.ok(Array.isArray(config.packageRules), 'renovate.json must define packageRules');
  const minorPatchIndex = config.packageRules.findIndex(
    (rule) =>
      rule.groupName === 'minor and patch updates' &&
      Array.isArray(rule.matchUpdateTypes) &&
      rule.matchUpdateTypes.includes('minor') &&
      rule.matchUpdateTypes.includes('patch') &&
      !rule.matchUpdateTypes.includes('major'),
  );
  assert.ok(
    minorPatchIndex !== -1,
    'renovate.json must group minor and patch updates as "minor and patch updates" without grouping majors',
  );

  const mastraRuleIndex = config.packageRules.findIndex(
    (rule) =>
      rule.groupName === 'mastra packages' &&
      Array.isArray(rule.matchPackageNames) &&
      rule.matchPackageNames.includes('@mastra/**'),
  );
  assert.ok(
    mastraRuleIndex > minorPatchIndex,
    'renovate.json must group @mastra/** packages as "mastra packages" after "minor and patch updates"',
  );

  const lowRiskTypes = ['minor', 'patch', 'pin', 'digest'];
  const hasLowRiskAutomerge = config.packageRules.some(
    (rule) =>
      rule.automerge === true &&
      Array.isArray(rule.matchUpdateTypes) &&
      lowRiskTypes.every((type) => rule.matchUpdateTypes.includes(type)),
  );
  assert.ok(
    hasLowRiskAutomerge,
    'renovate.json must automerge minor, patch, pin, and digest updates',
  );

  for (const rule of config.packageRules) {
    if (rule.automerge === true) {
      assert.ok(
        Array.isArray(rule.matchUpdateTypes) &&
          rule.matchUpdateTypes.length > 0 &&
          !rule.matchUpdateTypes.includes('major'),
        'renovate.json automerge rules must specify non-empty matchUpdateTypes without major',
      );
    }
  }
}

test('every workflow Action reference is pinned to a full commit SHA with a version comment', () => {
  for (const name of workflowFiles) {
    assertPinnedActions(readFileSync(join(workflowsDir, name), 'utf8'), name);
  }
});

test('every workflow uses node-version-file: .nvmrc instead of a literal node-version', () => {
  const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
  assert.match(nvmrc, /^\d+\.\d+\.\d+$/, '.nvmrc must pin a concrete Node.js version');
  for (const name of workflowFiles) {
    assertUsesNvmrc(readFileSync(join(workflowsDir, name), 'utf8'), name);
  }
});

test('renovate.json extends best-practices weekly and groups minor and patch updates', () => {
  const config = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
  assertRenovateConfig(config);
});

test('planted violation: unpinned tag or short SHA fails assertPinnedActions', () => {
  assert.throws(
    () => assertPinnedActions('steps:\n  - uses: actions/checkout@v4\n', 'planted-tag.yml'),
    /unpinned or untagged Action reference/,
  );
  assert.throws(
    () => assertPinnedActions('steps:\n  - uses: actions/checkout@3d3c42e # v7.0.1\n', 'planted-short-sha.yml'),
    /unpinned or untagged Action reference/,
  );
});

test('planted violation: literal node-version fails assertUsesNvmrc', () => {
  assert.throws(
    () =>
      assertUsesNvmrc(
        'steps:\n  - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n    with:\n      node-version: 24.14.1\n',
        'planted-node-version.yml',
      ),
    /must not set a literal node-version/,
  );
});

test('planted violation: changed minor/patch grouping fails assertRenovateConfig', () => {
  const base = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        packageRules: [{ matchUpdateTypes: ['minor'], groupName: 'minor and patch updates' }],
      }),
    /must group minor and patch updates/,
  );
  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        packageRules: [{ matchUpdateTypes: ['major', 'minor', 'patch'], groupName: 'minor and patch updates' }],
      }),
    /must group minor and patch updates/,
  );
  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        packageRules: [{ matchUpdateTypes: ['minor', 'patch'], groupName: 'all updates' }],
      }),
    /must group minor and patch updates/,
  );
});

test('planted violation: missing or misordered @mastra/** group fails assertRenovateConfig', () => {
  const base = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
  const minorPatchRule = { matchUpdateTypes: ['minor', 'patch'], groupName: 'minor and patch updates' };
  const mastraRule = { matchPackageNames: ['@mastra/**'], groupName: 'mastra packages' };

  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        packageRules: [minorPatchRule],
      }),
    /must group @mastra\/\*\* packages/,
  );
  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        packageRules: [mastraRule, minorPatchRule],
      }),
    /must group @mastra\/\*\* packages/,
  );
});

test('planted violation: unsafe automerge config fails assertRenovateConfig', () => {
  const base = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));

  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        automerge: true,
      }),
    /must not enable top-level automerge/,
  );
  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        packageRules: [...base.packageRules, { matchUpdateTypes: ['major'], automerge: true }],
      }),
    /non-empty matchUpdateTypes without major/,
  );
  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        packageRules: [...base.packageRules, { matchPackageNames: ['lodash'], automerge: true }],
      }),
    /non-empty matchUpdateTypes without major/,
  );
});

test('planted violation: missing or incomplete ignorePaths fails assertRenovateConfig', () => {
  const base = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
  const { ignorePaths: _ignorePaths, ...withoutIgnorePaths } = base;

  assert.throws(
    () => assertRenovateConfig(withoutIgnorePaths),
    /must define ignorePaths/,
  );
  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        ignorePaths: ['**/node_modules/**'],
      }),
    /must ignore \.agents\/skills\/\*\*/,
  );
  assert.throws(
    () =>
      assertRenovateConfig({
        ...base,
        ignorePaths: ['.agents/skills/**'],
      }),
    /must ignore \*\*\/node_modules\/\*\*/,
  );
});
