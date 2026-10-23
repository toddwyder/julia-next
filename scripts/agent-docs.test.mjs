import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

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
  assert.match(read('AGENTS.md'), /learning tests under framework\//);
});

test('agent instructions use the trial rulebook and the runbook marks Factory retired', () => {
  for (const path of ['CLAUDE.md', 'docs/agents/server-runbook.md']) {
    const text = read(path);
    assert.match(text, /GitHub/);
    assert.match(text, /retired/i);
    assert.match(text, /Todd/);
    assert.doesNotMatch(text, /Tick as you go|Finish the card/);
  }
  const trial = read('AGENTS.md');
  assert.match(trial, /poteto-mode skill/);
  assert.match(trial, /Spending is \$0/);
  assert.match(trial, /Linear holds cards and requirements\. GitHub holds code/);
  assert.match(trial, /node scripts\/julia-agents\.mjs/);
  assert.match(trial, /open PR to main/);
  assert.match(read('docs/agents/work-execution.md'), /historical evidence only/);
  const tracker = read('docs/agents/issue-tracker.md');
  assert.match(tracker, /New Julia and machine cards live.*Linear/i);
  assert.match(tracker, /change status to `Ready` only after Todd says `settled` and launcher admission passes/);
  assert.doesNotMatch(tracker, /Factory's Intake.*current|GitHub issues.*current/i);
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
  const prePlan = read('.claude/skills/pre-plan/SKILL.md');
  assert.ok(
    existsSync(new URL('../.claude/skills/pre-plan/SKILL.md', import.meta.url)),
    'repository-owned pre-plan skill must not be removed by a Pocock skill upgrade',
  );
  const stages = ['## 1. Shape', '## 2. Triage', '## 3. Confirm and Admission', '## 4. For Todd'];
  for (let index = 1; index < stages.length; index += 1) {
    assert.ok(prePlan.indexOf(stages[index - 1]) < prePlan.indexOf(stages[index]), `${stages[index]} must follow ${stages[index - 1]}`);
  }
  assert.match(prePlan, /invoke Pocock's installed `triage` skill/);
  assert.match(prePlan, /card-admission-check\.ts/);
  assert.match(prePlan, /write.*filled blanks?.*Todd's answers.*card text itself/i);
  assert.match(prePlan, /Read the Framework Map comment before building\./);
  assert.match(prePlan, /Confirm comment.*record of what changed/i);
  assert.match(prePlan, /full official, version-matched documentation index/i);
  assert.match(prePlan, /cheap sub-agents, one per tool or settling question/i);
  assert.match(prePlan, /Pocock's installed `domain-modeling` skill/);
  assert.match(prePlan, /Open every cited link/i);
  assert.match(prePlan, /private files instead of an official interface does not go to Ready/i);
  assert.match(prePlan, /Each acceptance criterion lists every case Proof must cover/i);
  assert.match(prePlan, /every mockup element a numbered callout/i);
  assert.doesNotMatch(prePlan, /finish condition/i);
  assert.match(prePlan, /one `For Todd:` summary covering every card/);
  assert.match(prePlan, /move only the settled cards with passing admission results to Ready/);
  assert.match(prePlan, /rule about the order of events \(concurrency, retries, restarts, state machines, “only once”\)/);
  assert.match(prePlan, /create-formal-verification-skill.*maintain-formal-verification-skill/);
  assert.match(prePlan, /Stops follow the stop rule in AGENTS\.md/);
  assert.deepEqual(JSON.parse(read('skills-lock.json')).skills['pre-plan'], {
    source: 'toddwyder/julia-next',
    sourceType: 'github',
    ref: 'd250fb51',
    skillPath: '.claude/skills/pre-plan/SKILL.md',
    computedHash: 'cd3323d8edef8b8add285b239f57aa01c3d8e0b1cc5cdf0bb2e1c39032ca7aec',
  });
});

test('Todd\'s 19 October process vocabulary and restart stop are explicit', () => {
  const glossary = read('GLOSSARY.md');
  const agents = read('AGENTS.md');

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
    {
      file: '.agents/skills/create-formal-verification-skill/SKILL.md',
      blob: 'b97609fd2649e95ea2960e720b3b581a6c2cb75a',
      sha: '6c934cd15a9583533ff9b7a9cad62775d7e80402d26d3ba7f74f79ea21a1d8eb',
    },
    {
      file: '.agents/skills/maintain-formal-verification-skill/SKILL.md',
      blob: '5d2f7f2228a3b771ca5b03124fc265ddfc53c5fc',
      sha: '0c96f54293542d3818b68754562b338073958781a9684454611dca37592e2d2c',
    },
  ];

  for (const skill of expectedSkills) {
    assert.ok(existsSync(new URL(`../${skill.file}`, import.meta.url)), `${skill.file} must exist`);

    const raw = readFileSync(new URL(`../${skill.file}`, import.meta.url));
    const sha = createHash('sha256').update(raw).digest('hex');
    const blob = createHash('sha1').update(Buffer.concat([
      Buffer.from(`blob ${raw.length}\0`),
      raw,
    ])).digest('hex');
    assert.equal(sha, skill.sha, `SHA-256 of ${skill.file} must match pinned hash`);
    assert.equal(blob, skill.blob, `Git blob of ${skill.file} must match pinned blob`);
  }
});
