import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkBrief, checkCriterion, findCopiedText, parseCriteria } from './check-agent-brief.mjs';

function root(t, doc = '') {
  const directory = mkdtempSync(join(tmpdir(), 'agent-brief-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  if (doc) writeFileSync(join(directory, 'AGENTS.md'), doc);
  return directory;
}

test('reads criteria under the section heading', () => {
  const criteria = parseCriteria('## Outcome\n\nOne outcome.\n\n## Acceptance criteria\n\n- [ ] The dashboard shows each finished step.\n- [x] Each skipped step has its own count.\n\n## Proof\n');
  assert.deepEqual(criteria.map(criterion => criterion.text), [
    'The dashboard shows each finished step.',
    'Each skipped step has its own count.',
  ]);
});

test('reads plain bullets in the current triage shape', () => {
  const criteria = parseCriteria('## Acceptance criteria\n\n* The dashboard displays the checklist.\n* Each step is marked finished.\n');
  assert.deepEqual(criteria.map(criterion => criterion.text), [
    'The dashboard displays the checklist.',
    'Each step is marked finished.',
  ]);
});

test('reads criteria under the Agent Brief field', () => {
  const criteria = parseCriteria('## Agent Brief\n\n**Acceptance criteria:**\n\n- [ ] The card is admitted.\n- [ ] The build starts.\n\n**Out of scope:**\n\n- Another card.\n');
  assert.deepEqual(criteria.map(criterion => criterion.text), ['The card is admitted.', 'The build starts.']);
});

test('refuses text copied from a repository doc', () => {
  const copied = 'The dashboard shows the running build checklist and ticks off every step as the build finishes.';
  const findings = findCopiedText({ text: copied, docs: [{ file: 'AGENTS.md', text: `Rule: ${copied}` }] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /copies text from AGENTS\.md/);
});

test('refuses a procedural criterion', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'Add a checklist to the dashboard.' }), [
    'AC1 is procedural ("add ..."); write the observed outcome instead',
  ]);
});

test('refuses an implementation word in a criterion', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'The dashboard renders the JSON payload.' }), [
    'AC1 uses the implementation word "JSON"; describe what Todd sees instead',
  ]);
});

test('refuses a negation in a criterion', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'The dashboard does not show pending steps.' }), [
    'AC1 uses the negation "not"; state the positive behavior instead',
  ]);
});

test('accepts an outcome criterion with no implementation words or negations', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'Each skipped step shows its own count.' }), []);
});

test('accepts any number of criteria; pstack slices large cards', t => {
  const directory = root(t, '# Rules\n\nWrite the observed behavior.\n');
  const six = '## Outcome\n\nOne outcome.\n\n## Acceptance criteria\n\n- One.\n- Two.\n- Three.\n- Four.\n- Five.\n- Six.\n';
  assert.deepEqual(checkBrief({ text: six, file: 'brief.md', root: directory }), []);
});

test('accepts a clean brief and refuses one with no criteria', t => {
  const directory = root(t, '# Rules\n\nWrite the observed behavior.\n');
  const clean = '## Outcome\n\nThe dashboard shows the live checklist.\n\n## Acceptance criteria\n\n- [ ] The dashboard shows each finished step.\n- [ ] Each skipped step has its own count.\n';
  assert.deepEqual(checkBrief({ text: clean, file: 'brief.md', root: directory }), []);
  assert.deepEqual(checkBrief({ text: '## Outcome\n\nOne outcome.\n', file: 'brief.md', root: directory }), [
    'brief.md:1: no acceptance criteria found; a brief needs testable criteria',
  ]);
});

test('the command exits nonzero and names the failing criterion', t => {
  const directory = root(t, '# Rules\n');
  const result = spawnSync(process.execPath, [
    join(import.meta.dirname, 'check-agent-brief.mjs'),
    '--text', '## Acceptance criteria\n\n- [ ] Update the API endpoint.\n',
    '--root', directory,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /brief\.md:3: AC1 is procedural/);
  assert.match(result.stderr, /brief\.md:3: AC1 uses the implementation word "API"/);
});
