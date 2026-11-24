import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED_MODEL, checkRoleModels } from './check-role-models.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_SCRIPT = join(REPO_ROOT, 'scripts/check-role-models.mjs');

function cloneConfigTree(root) {
  mkdirSync(join(root, 'dashboard', 'config'), { recursive: true });
  mkdirSync(join(root, 'dashboard', 'lib'), { recursive: true });
  cpSync(join(REPO_ROOT, 'dashboard', 'config', 'roles.json'), join(root, 'dashboard', 'config', 'roles.json'));
  cpSync(join(REPO_ROOT, 'dashboard', 'config', 'defaults.json'), join(root, 'dashboard', 'config', 'defaults.json'));
  cpSync(join(REPO_ROOT, 'dashboard', 'lib', 'model-settings.js'), join(root, 'dashboard', 'lib', 'model-settings.js'));
}

test('the repository role models all match the required model', () => {
  assert.deepEqual(checkRoleModels(REPO_ROOT), []);
  const result = spawnSync(process.execPath, [CHECK_SCRIPT, REPO_ROOT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(REQUIRED_MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('planting another model in a role fails the check and names the role', () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-plant-'));
  try {
    cloneConfigTree(root);
    const rolesPath = join(root, 'dashboard', 'config', 'roles.json');
    const roles = JSON.parse(readFileSync(rolesPath, 'utf8'));
    roles.groups[0].roles[0].default = 'openai/gpt-6.1-sol';
    writeFileSync(rolesPath, JSON.stringify(roles, null, 2));

    const failures = checkRoleModels(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /feature-refactoring/);
    assert.match(failures[0], /openai\/gpt-6\.1-sol/);

    const result = spawnSync(process.execPath, [CHECK_SCRIPT, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /feature-refactoring/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('planting another model in defaults.json or LEAD_DEFAULT_MODEL fails the check', () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-defaults-'));
  try {
    cloneConfigTree(root);
    const defaultsPath = join(root, 'dashboard', 'config', 'defaults.json');
    const defaults = JSON.parse(readFileSync(defaultsPath, 'utf8'));
    defaults.shipping = 'anthropic/claude-opus-5-5';
    writeFileSync(defaultsPath, JSON.stringify(defaults, null, 2));

    const settingsPath = join(root, 'dashboard', 'lib', 'model-settings.js');
    const settings = readFileSync(settingsPath, 'utf8').replace(REQUIRED_MODEL, 'openai/gpt-6.1-sol');
    writeFileSync(settingsPath, settings);

    const failures = checkRoleModels(root);
    assert.equal(failures.length, 2);
    assert.match(failures[0], /shipping/);
    assert.match(failures[1], /LEAD_DEFAULT_MODEL/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
