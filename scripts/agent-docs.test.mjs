import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  assert.match(prePlan, /Every brief must state what happens to code already built for the card that doesn’t meet its acceptance criteria/);
  assert.match(prePlan, /removed from the repo and from the machines it was installed or configured on/);
  assert.match(prePlan, /Delete exactly that piece and everything belonging to it; the reviewer confirms a search finds no trace/);
  assert.match(prePlan, /never worked around/);
  assert.match(prePlan, /Undoing \(a revert, or restarting from main and carrying over only what meets the criteria\) is offered before patching/);
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
  assert.match(glossary, /\*\*Evidence\*\*:\s*\nWhat Proof produces, showing that every acceptance criterion was met\. No Evidence means not done\./);
  assert.doesNotMatch(glossary, /_Avoid_: Pstack verification/);
  assert.match(agents, /Whenever a card stops for any reason: two rounds without closing, a spend cap or a time cap, the agent writes a root-cause report that proposes no fix, then a restart plan, and nothing is rebuilt until Todd approves the restart plan\./);
  assert.match(agents, /Every restart plan and brief must state what happens to code already built for the card that doesn’t meet its acceptance criteria/);
  assert.match(agents, /removed from the repo and from the machines it was installed or configured on/);
  assert.match(agents, /Delete exactly that piece and everything belonging to it; the reviewer confirms a search finds no trace/);
  assert.match(agents, /never worked around/);
  assert.match(agents, /Undoing \(a revert, or restarting from main and carrying over only what meets the criteria\) is offered before patching/);
});

test('formal verification skills are installed and pinned to exact hashes in PSTACK-SOURCE.md', () => {
  const pstackSource = read('.agents/skills/PSTACK-SOURCE.md');
  assert.match(pstackSource, /github\.com\/cursor\/plugins/);
  assert.match(pstackSource, /88d47514b82e7c44f00f2b2a72ff6dd12158038c/);

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
    assert.ok(pstackSource.includes(skill.file), `PSTACK-SOURCE.md must mention ${skill.file}`);
    assert.ok(pstackSource.includes(skill.blob), `PSTACK-SOURCE.md must record git blob ${skill.blob}`);
    assert.ok(pstackSource.includes(skill.sha), `PSTACK-SOURCE.md must record sha-256 ${skill.sha}`);

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
