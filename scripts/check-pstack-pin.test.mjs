import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MIRROR, checkPstackPin, compareSkillTrees, compareTree, readPin, sdkPinProblems } from './check-pstack-pin.mjs';

function workspace(body) {
  const root = mkdtempSync(join(tmpdir(), 'pstack-pin-test-'));
  try { return body(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function write(path, text) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

const commit = 'fad8d01588a1b1ae803f87c8a1e0de79e28cffec';

test('readPin needs the mirror and a full commit', () => {
  workspace(root => {
    write(join(root, '.agents/skills/PSTACK-SOURCE.md'), `Mirror: ${MIRROR}\nCommit: ${commit}\n`);
    assert.deepEqual(readPin(root), { mirror: MIRROR, commit });
    write(join(root, '.agents/skills/PSTACK-SOURCE.md'), `Mirror: ${MIRROR}\nCommit: fad8d01\n`);
    assert.throws(() => readPin(root), /40-character commit/);
    write(join(root, '.agents/skills/PSTACK-SOURCE.md'), 'Mirror: https://example.invalid/x\nCommit: ' + commit + '\n');
    assert.throws(() => readPin(root), /must name/);
  });
});

test('compareSkillTrees fails on drift, missing files, extras, symlinks and unknown skills', () => {
  workspace(root => {
    const mirror = join(root, 'mirror');
    const installed = join(root, 'installed');
    write(join(mirror, 'how/SKILL.md'), 'how\n');
    write(join(mirror, 'how/references/explorer.md'), 'explorer\n');
    write(join(installed, 'how/SKILL.md'), 'how\n');
    write(join(installed, 'how/references/explorer.md'), 'explorer\n');
    write(join(installed, 'verify-julia/SKILL.md'), 'julia\n');
    assert.deepEqual(compareSkillTrees(mirror, installed), []);

    write(join(installed, 'how/references/explorer.md'), 'changed\n');
    assert.deepEqual(compareSkillTrees(mirror, installed), ['pstack file differs from the mirror: how/references/explorer.md']);
    write(join(installed, 'how/references/explorer.md'), 'explorer\n');

    write(join(installed, 'how/references/extra.md'), 'extra\n');
    assert.deepEqual(compareSkillTrees(mirror, installed), ['unexpected pstack file: how/references/extra.md']);
    rmSync(join(installed, 'how/references/extra.md'));

    rmSync(join(installed, 'how/references/explorer.md'));
    assert.deepEqual(compareSkillTrees(mirror, installed), ['missing pstack file: how/references/explorer.md']);
    write(join(installed, 'how/references/explorer.md'), 'explorer\n');

    write(join(installed, 'other/SKILL.md'), 'other\n');
    assert.deepEqual(compareSkillTrees(mirror, installed), ['installed skill is not in the pstack mirror or Julia\'s own set: other']);
    rmSync(join(installed, 'other'), { recursive: true });

    rmSync(join(installed, 'how/references/explorer.md'));
    symlinkSync(join(mirror, 'how/references/explorer.md'), join(installed, 'how/references/explorer.md'));
    assert.deepEqual(compareSkillTrees(mirror, installed), ['pstack file is a symlink, not a copy: how/references/explorer.md']);
  });
});

test('compareSkillTrees accepts several mirror roots, and compareTree covers docs and single files', () => {
  workspace(root => {
    const main = join(root, 'mirror/skills');
    const benny = join(root, 'mirror/automations/benny/skills');
    const installed = join(root, 'installed');
    write(join(main, 'how/SKILL.md'), 'how\n');
    write(join(benny, 'setup-benny/SKILL.md'), 'benny\n');
    write(join(installed, 'how/SKILL.md'), 'how\n');
    write(join(installed, 'setup-benny/SKILL.md'), 'benny\n');
    assert.deepEqual(compareSkillTrees([main, benny], installed), []);

    write(join(root, 'mirror/docs/guide/01.md'), 'guide\n');
    write(join(root, 'installed-docs/guide/01.md'), 'guide\n');
    assert.deepEqual(compareTree(join(root, 'mirror/docs'), join(root, 'installed-docs'), 'docs'), []);
    write(join(root, 'installed-docs/guide/01.md'), 'changed\n');
    assert.deepEqual(compareTree(join(root, 'mirror/docs'), join(root, 'installed-docs'), 'docs'), ['pstack file differs from the mirror: docs/guide/01.md']);

    write(join(root, 'mirror/README.md'), 'readme\n');
    write(join(root, 'installed-README.md'), 'readme\n');
    assert.deepEqual(compareTree(join(root, 'mirror/README.md'), join(root, 'installed-README.md'), 'README.md'), []);
    write(join(root, 'installed-README.md'), 'changed\n');
    assert.deepEqual(compareTree(join(root, 'mirror/README.md'), join(root, 'installed-README.md'), 'README.md'), ['README.md differs from the mirror']);
  });
});

test('the checked-in pstack install matches the mirror and the SDK pin', () => {
  const { pin, problems } = checkPstackPin(resolve(import.meta.dirname, '..'));
  assert.deepEqual(problems, []);
  assert.equal(pin.mirror, MIRROR);
  assert.equal(pin.commit, commit);
});

test('sdkPinProblems accepts one exact registry install and rejects ranges, mismatch and patches', () => {
  const manifest = { dependencies: { '@mastra/code-sdk': '1.14.0' } };
  const lock = {
    packages: {
      '': { dependencies: { '@mastra/code-sdk': '1.14.0' } },
      'node_modules/@mastra/code-sdk': {
        version: '1.14.0',
        resolved: 'https://registry.npmjs.org/@mastra/code-sdk/-/code-sdk-1.14.0.tgz',
        integrity: 'sha512-example',
      },
    },
  };
  const clean = { manifest, lock, installedVersion: '1.14.0', patchesExist: false, packageIsSymlink: false, patchesMentionSdk: false };
  assert.deepEqual(sdkPinProblems(clean), []);
  assert.match(sdkPinProblems({ ...clean, manifest: { dependencies: { '@mastra/code-sdk': '^1.14.0' } } }).join('\n'), /exact version/);
  assert.match(sdkPinProblems({ ...clean, installedVersion: '1.15.0' }).join('\n'), /lockfile has 1.14.0, install has 1.15.0/);
  assert.match(sdkPinProblems({ ...clean, patchesExist: true }).join('\n'), /must not carry local patches/);
  assert.match(sdkPinProblems({ ...clean, packageIsSymlink: true }).join('\n'), /is a symlink/);
  assert.match(sdkPinProblems({ ...clean, lock: { packages: { ...lock.packages, 'node_modules/@mastra/code-sdk': { ...lock.packages['node_modules/@mastra/code-sdk'], resolved: 'file:../code-sdk' } } } }).join('\n'), /public npm registry/);
  assert.match(sdkPinProblems({ ...clean, manifest: { ...manifest, overrides: { '@mastra/code-sdk': '1.14.0' } } }).join('\n'), /overrides rewrites/);
});
