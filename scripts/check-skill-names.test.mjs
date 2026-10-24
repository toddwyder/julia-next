import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkSkillNames } from './check-skill-names.mjs';

function writeSkill(root, skillRoot, folder, name) {
  const directory = join(root, skillRoot, folder);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`);
}

test('duplicate skill names report every declaring file', t => {
  const root = mkdtempSync(join(tmpdir(), 'skill-names-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  writeSkill(root, '.agents/skills', 'pstack-tdd', 'tdd');
  writeSkill(root, '.claude/skills', 'pocock-tdd', 'tdd');

  assert.deepEqual(checkSkillNames(root), [
    'duplicate skill name "tdd": .agents/skills/pstack-tdd/SKILL.md, .claude/skills/pocock-tdd/SKILL.md',
  ]);
});

test('the repository has one declaration for each skill name', () => {
  assert.deepEqual(checkSkillNames(join(import.meta.dirname, '..')), []);
});
