import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MIRROR } from './check-pstack-pin.mjs';
import { checkSkillVersions } from './check-skill-versions.mjs';
import { applyPocockReleaseToTree, applyPstackMirrorToTree } from './update-skills.mjs';

function write(filePath, content) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content);
}

test('applyPstackMirrorToTree and applyPocockReleaseToTree keep PSTACK-SOURCE.md and skills-lock.json in sync', () => {
  const root = mkdtempSync(join(tmpdir(), 'update-skills-test-'));
  const pstackMirror = join(root, 'pstack-mirror');
  const pocockMirror = join(root, 'pocock-mirror');
  const repo = join(root, 'repo');

  try {
    const oldSha = '83a729a182a29b59a2a42fc3d7736b0c376b55d4';
    const newSha = '0d2dc00df47d7686c94324cfe9c3444710d9f16d';

    write(join(repo, '.agents/skills/PSTACK-SOURCE.md'), `Mirror: ${MIRROR}\nCommit: ${oldSha}\nVersion: 0.15.43\nInstalled: 3 November 2026\n`);
    write(join(repo, '.agents/skills/verify-julia/SKILL.md'), 'julia\n');
    write(join(repo, '.claude/skills/triage/SKILL.md'), 'old triage\n');
    write(join(repo, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        how: { source: 'backnotprop/pstack', ref: oldSha, skillPath: 'skills/how/SKILL.md', computedHash: 'old' },
        triage: { source: 'mattpocock/skills', ref: 'v1.3.1', skillPath: 'skills/engineering/triage/SKILL.md', computedHash: 'old' },
      },
    }));

    write(join(pstackMirror, 'skills/how/SKILL.md'), 'new how\n');
    write(join(pstackMirror, 'automations/benny/skills/setup-benny/SKILL.md'), 'benny\n');
    write(join(pstackMirror, 'docs/guide/01.md'), 'guide\n');
    write(join(pstackMirror, 'README.md'), 'readme\n');
    write(join(pstackMirror, 'LICENSE'), 'license\n');

    write(join(pocockMirror, 'skills/engineering/triage/SKILL.md'), 'new triage\n');

    applyPstackMirrorToTree({ root: repo, mirrorDir: pstackMirror, commit: newSha, version: '0.15.44', installedDate: '19 November 2026' });
    applyPocockReleaseToTree({ root: repo, mirrorDir: pocockMirror, tag: 'v1.3.2' });

    const { problems } = checkSkillVersions(repo);
    assert.deepEqual(problems, []);
    assert.equal(readFileSync(join(repo, '.agents/skills/verify-julia/SKILL.md'), 'utf8'), 'julia\n');
    assert.equal(readFileSync(join(repo, '.claude/skills/triage/SKILL.md'), 'utf8'), 'new triage\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applyPocockReleaseToTree preserves Julia retro step when updating retro skill', () => {
  const root = mkdtempSync(join(tmpdir(), 'update-skills-retro-test-'));
  const pocockMirror = join(root, 'pocock-mirror');
  const repo = join(root, 'repo');

  try {
    const oldSha = '83a729a182a29b59a2a42fc3d7736b0c376b55d4';
    const juliaLine =
      "5. Mastra's storage retention prunes old trace rows at the end of every card. There is no list of sessions, no census file, no sweep, and nothing in the retro deletes anything.";

    write(join(repo, '.agents/skills/PSTACK-SOURCE.md'), `Mirror: ${MIRROR}\nCommit: ${oldSha}\nVersion: 0.15.43\nInstalled: 3 November 2026\n`);
    write(
      join(repo, '.claude/skills/retro/SKILL.md'),
      `4. Present these candidates to the user, in order of severity.\n\n${juliaLine}\n\n## Reference\n`,
    );
    write(join(repo, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        retro: { source: 'mattpocock/skills', ref: 'v1.3.1', skillPath: 'skills/engineering/retro/SKILL.md', computedHash: 'old' },
      },
    }));

    write(
      join(pocockMirror, 'skills/engineering/retro/SKILL.md'),
      '4. Present these candidates to the user, in order of severity.\n\n## Reference\n',
    );

    applyPocockReleaseToTree({ root: repo, mirrorDir: pocockMirror, tag: 'v1.3.2' });

    const updated = readFileSync(join(repo, '.claude/skills/retro/SKILL.md'), 'utf8');
    assert.match(updated, /5\. Mastra's storage retention prunes old trace rows at the end of every card\./);
    assert.match(updated, /## Reference/);
    assert.deepEqual(checkSkillVersions(repo).problems, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
