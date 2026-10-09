import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('coding standards seed reflects the framework-first rules and is linked from AGENTS.md', () => {
  const standards = read('CODING_STANDARDS.md');
  assert.match(standards, /official (framework )?docs/i);
  assert.match(standards, /framework map/i);
  assert.match(standards, /framework.*example/i);
  assert.match(standards, /npm run lint:framework/);
  assert.match(standards, /progress files/i);
  assert.match(standards, /retry or wait loops/i);
  assert.match(standards, /controller code over 400 lines/i);
  assert.match(standards, /built-in feature/i);
  assert.match(read('AGENTS.md'), /\[CODING_STANDARDS\.md\]\(CODING_STANDARDS\.md\)/);
});

test('agent instructions use the Linear delivery route and mark Factory retired', () => {
  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    const text = read(path);
    assert.match(text, /GitHub/);
    assert.match(text, /RETIRED/);
    assert.match(text, /Todd/);
    assert.doesNotMatch(text, /Tick as you go|Finish the card/);
    if (path === 'AGENTS.md') {
      assert.match(text, /\.claude\/skills\/tdd\/SKILL\.md/);
    }
  }
  assert.match(read('AGENTS.md'), /ordinary signed-in GitHub access/);
  assert.match(read('docs/agents/work-execution.md'), /historical evidence only/);
});

test('post-build reviewer checks and the plan-answers/park policy replace stop-and-ask builder gates', () => {
  const standards = read('CODING_STANDARDS.md');
  const checks = [
    'unit tests',
    'integration tests at affected boundaries',
    'end-to-end for the changed journey',
    'a clean browser console',
    'logging good enough to find a root cause',
  ];
  for (const name of checks) {
    assert.ok(standards.includes(name), `CODING_STANDARDS.md must name the reviewer check: "${name}"`);
  }
  const we = read('docs/agents/work-execution.md');
  assert.match(we, /approved plan|plan supplies|agreed seams/i);
  assert.match(we, /park the card|park.*with one line/i);
  assert.match(we, /Never ask Todd for an exception/i);
});

test('the repository-owned pre-plan skill survives Pocock skill upgrades', () => {
  assert.ok(
    existsSync(new URL('../.claude/skills/pre-plan/SKILL.md', import.meta.url)),
    'repository-owned pre-plan skill must not be removed by a Pocock skill upgrade',
  );
  assert.deepEqual(JSON.parse(read('skills-lock.json')).skills['pre-plan'], {
    source: 'toddwyder/julia-next',
    sourceType: 'github',
    ref: 'd250fb51',
    skillPath: '.claude/skills/pre-plan/SKILL.md',
    computedHash: 'cea366558d5fe6218f37a685d8bafccb2400362ea58dfe9f6ecf87b73e432f48',
  });
});
