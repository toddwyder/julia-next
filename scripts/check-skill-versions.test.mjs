import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { MIRROR } from './check-pstack-pin.mjs';
import { checkSkillVersions } from './check-skill-versions.mjs';

function withWorkspace(fn) {
  const root = mkdtempSync(join(tmpdir(), 'skill-versions-test-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('checkSkillVersions fails on planted pstack or Pocock version disagreements and passes once fixed', () => {
  const commitA = '83a729a182a29b59a2a42fc3d7736b0c376b55d4';
  const commitB = '6c75f4e67546c2ddbf9634734c1e3ebbea34861a';

  withWorkspace(root => {
    mkdirSync(join(root, '.agents/skills'), { recursive: true });
    writeFileSync(join(root, '.agents/skills/PSTACK-SOURCE.md'), `Mirror: ${MIRROR}\nCommit: ${commitA}\n`);

    // Planted disagreement: skills-lock.json has commitB while PSTACK-SOURCE.md has commitA.
    writeFileSync(join(root, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        how: { source: 'backnotprop/pstack', ref: commitB },
        'ask-matt': { source: 'mattpocock/skills', ref: 'v1.3.1' },
        triage: { source: 'mattpocock/skills', ref: 'v1.3.1' },
      },
    }));
    const mismatch = checkSkillVersions(root);
    assert.ok(mismatch.problems.some(p => p.includes(commitB) && p.includes(commitA)));

    // Planted disagreement between two Pocock skills.
    writeFileSync(join(root, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        how: { source: 'backnotprop/pstack', ref: commitA },
        'ask-matt': { source: 'mattpocock/skills', ref: 'v1.3.1' },
        triage: { source: 'mattpocock/skills', ref: 'v1.3.2' },
      },
    }));
    const pocockMismatch = checkSkillVersions(root);
    assert.ok(pocockMismatch.problems.some(p => p.includes('mattpocock/skills') && p.includes('v1.3.1') && p.includes('v1.3.2')));

    // Fixed: all records agree.
    writeFileSync(join(root, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        how: { source: 'backnotprop/pstack', ref: commitA },
        'ask-matt': { source: 'mattpocock/skills', ref: 'v1.3.2' },
        triage: { source: 'mattpocock/skills', ref: 'v1.3.2' },
      },
    }));
    const clean = checkSkillVersions(root);
    assert.deepEqual(clean.problems, []);
  });
});

test('the repository skill version records agree', () => {
  const { problems } = checkSkillVersions(resolve(import.meta.dirname, '..'));
  assert.deepEqual(problems, []);
});
