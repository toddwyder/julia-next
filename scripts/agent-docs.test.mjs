import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('coding standards retain framework rules and the trial retains learning tests', () => {
  const standards = read('CODING_STANDARDS.md');
  assert.match(standards, /official (framework )?docs/i);
  assert.match(standards, /framework map/i);
  assert.match(standards, /framework.*example/i);
  assert.match(standards, /npm run lint:framework/);
  assert.match(standards, /progress files/i);
  assert.match(standards, /retry or wait loops/i);
  assert.match(standards, /controller code over 400 lines/i);
  assert.match(standards, /built-in feature/i);
  assert.match(standards, /\.agents\/skills\/tdd\/SKILL\.md/);
});

test('CLAUDE.md loads AGENTS.md as the one rulebook', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /^@AGENTS\.md$/m);
  assert.ok(claude.split('\n').filter(Boolean).length <= 5, 'CLAUDE.md keeps no rules of its own');
});

test('agent instructions use the trial rulebook and the runbook marks Factory retired', () => {
  const runbook = read('docs/agents/server-runbook.md');
  assert.match(runbook, /GitHub/);
  assert.match(runbook, /retired/i);
  assert.match(runbook, /Todd/);
  assert.doesNotMatch(runbook, /Tick as you go|Finish the card/);
  const trial = read('AGENTS.md');
  assert.match(trial, /poteto-mode skill/);
  assert.match(trial, /one \$2 total model budget/);
  assert.doesNotMatch(trial, /Spending is \$0|cost readback above \$0 stops/);
  assert.match(trial, /Linear holds cards and requirements\. GitHub holds code/);
  assert.match(trial, /node scripts\/julia-agents\.mjs/);
  assert.match(trial, /open PR to main/);
  assert.match(read('docs/agents/work-execution.md'), /historical evidence only/);
  const tracker = read('docs/agents/issue-tracker.md');
  assert.match(tracker, /New Julia and machine cards live.*Linear/i);
  assert.match(tracker, /change status to `Ready` only after Todd says `settled` and launcher admission passes/);
  assert.doesNotMatch(tracker, /Factory's Intake.*current|GitHub issues.*current/i);
});

test('post-build reviewer checks and the plan-answers policy replace stop-and-ask builder gates', () => {
  const standards = read('CODING_STANDARDS.md');
  const checks = [
    'unit tests',
    'integration tests at affected boundaries',
    'end-to-end for the changed journey',
    'a clean browser console',
    'logging good enough to find a root cause',
  ];
  for (const name of checks) assert.ok(standards.includes(name), `CODING_STANDARDS.md must name the reviewer check: "${name}"`);
  const workExecution = read('docs/agents/work-execution.md');
  assert.match(workExecution, /approved plan|plan supplies|agreed seams/i);
  assert.match(workExecution, /park the card|park.*with one line/i);
  assert.match(workExecution, /Never ask Todd for an exception/i);
});

test('retired skills stay retired and pstack owns tdd and teach', () => {
  assert.equal(existsSync(new URL('../.claude/skills/pre-plan/SKILL.md', import.meta.url)), false);
  assert.equal(existsSync(new URL('../.claude/skills/tdd/SKILL.md', import.meta.url)), false);
  assert.equal(existsSync(new URL('../.claude/skills/teach/SKILL.md', import.meta.url)), false);
  assert.ok(existsSync(new URL('../.agents/skills/tdd/SKILL.md', import.meta.url)));
  assert.ok(existsSync(new URL('../.agents/skills/teach/SKILL.md', import.meta.url)));
  const locked = JSON.parse(read('skills-lock.json')).skills;
  assert.equal(locked['pre-plan'], undefined);
  assert.equal(locked.tdd, undefined);
  assert.equal(locked.teach, undefined);
});

test('Todd\'s 19 October process vocabulary and restart stop are explicit', () => {
  const glossary = read('GLOSSARY.md');
  assert.match(glossary, /\*\*Acceptance criterion\*\*:\s*\nWhat must be true when the card is done\./);
  assert.match(glossary, /\*\*Proof\*\*:\s*\nThe process: a real pstack verification run against the real thing\./);
  assert.match(glossary, /\*\*Proof\*\*:[^\n]*\n[^\n]*tied to the exact candidate commit and dirty-tree digest\./);
  assert.match(glossary, /\*\*Evidence\*\*:\s*\nWhat Proof produces, showing that every acceptance criterion was met\. No Evidence means not done\./);
  assert.doesNotMatch(glossary, /_Avoid_: Pstack verification/);
});

test('formal verification skills retain exact pinned hashes under the trial mirror', () => {
  const pstackSource = read('.agents/skills/PSTACK-SOURCE.md');
  assert.match(pstackSource, /github\.com\/backnotprop\/pstack/);
  assert.match(pstackSource, /e44668c2aad92eacf4e84df47984121fefb11b82/);
  const expectedSkills = [
    { file: '.agents/skills/create-formal-verification-skill/SKILL.md', blob: 'b97609fd2649e95ea2960e720b3b581a6c2cb75a', sha: '6c934cd15a9583533ff9b7a9cad62775d7e80402d26d3ba7f74f79ea21a1d8eb' },
    { file: '.agents/skills/maintain-formal-verification-skill/SKILL.md', blob: '5d2f7f2228a3b771ca5b03124fc265ddfc53c5fc', sha: '0c96f54293542d3818b68754562b338073958781a9684454611dca37592e2d2c' },
  ];
  for (const skill of expectedSkills) {
    assert.ok(existsSync(new URL(`../${skill.file}`, import.meta.url)), `${skill.file} must exist`);
    const raw = readFileSync(new URL(`../${skill.file}`, import.meta.url));
    const sha = createHash('sha256').update(raw).digest('hex');
    const blob = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${raw.length}\0`), raw])).digest('hex');
    assert.equal(sha, skill.sha, `SHA-256 of ${skill.file} must match pinned hash`);
    assert.equal(blob, skill.blob, `Git blob of ${skill.file} must match pinned blob`);
  }
});
