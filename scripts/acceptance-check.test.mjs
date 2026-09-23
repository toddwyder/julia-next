// acceptance-check.test.mjs -- JUL-81's acceptance check, a plain script (Todd,
// 23 Sep, after JUL-92 reached UAT with none of the evidence its UAT plan
// promised). The card fixture is JUL-92's real description.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseAcceptanceCriteria, parseUatPlan, checkEvidence, checkCardForUat, tickCriteria, evidenceCommentBody,
  evidenceListsForBrief, namesCriterion, EVIDENCE_MARKER,
} from './acceptance-check.mjs';

const JUL_92 = readFileSync(new URL('../graph/fixtures/cards/jul-92.description.md', import.meta.url), 'utf8');
const AC1 = 'A fresh session following only the runbook finds no instruction contradicted by the live server (cold-reader check).';
const AC2 = 'No reference to the old runbook name remains (test).';

const fullBuilder = {
  outcome: 'done',
  summary: 'done',
  acceptance: [
    { id: 'AC1', criterion: AC1, evidence: 'a fresh agent read only the runbook: 77 claims, 0 contradicted' },
    { id: 'AC2', criterion: AC2, evidence: 'git grep for the old name: 0 hits' },
  ],
  uat: [
    { id: 'UAT1', text: 'Each stale item, old vs new.' },
    { id: 'UAT2', text: 'The fresh reader found nothing contradicted.' },
    { id: 'UAT3', text: 'server-runbook.md; 0 hits for the old name.' },
  ],
};
const fullReviewer = {
  verdict: 'approve',
  summary: 'ok',
  criteria: [
    { id: 'AC1', criterion: AC1, verdict: 'met', how: 'read the fresh reader\'s report and re-checked 5 claims' },
    { id: 'AC2', criterion: AC2, verdict: 'met', how: 'ran git grep myself' },
  ],
};

test('JUL-92\'s real card: two criteria (the struck-through one is not a criterion) and three UAT-plan items', () => {
  const criteria = parseAcceptanceCriteria(JUL_92);
  assert.deepEqual(criteria.map((c) => [c.id, c.text, c.ticked]), [['AC1', AC1, false], ['AC2', AC2, false]]);
  assert.deepEqual(parseUatPlan(JUL_92).map((u) => [u.id, u.name]), [
    ['UAT1', 'What was wrong and what it says now'],
    ['UAT2', 'The fresh-reader check'],
    ['UAT3', 'The rename'],
  ]);
  assert.match(evidenceListsForBrief(JUL_92), /- AC2: No reference to the old runbook name remains \(test\)\.\n\n## UAT plan items, by id\n\n- UAT1: What was wrong/);
});

test('JUL-92 on 23 Sep, replayed: the hand-in that reached UAT had no per-item evidence and is refused on all seven gaps', () => {
  const result = checkEvidence({ description: JUL_92, builder: { outcome: 'done', summary: 'a long free-text hand-in' }, reviewer: { verdict: 'approve', summary: 'approve' } });
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 7);
});

test('everything present, by id and by name: PASS', () => {
  const result = checkEvidence({ description: JUL_92, builder: fullBuilder, reviewer: fullReviewer });
  assert.equal(result.ok, true, result.missing.join('\n'));
});

test('A CARD WITH A MISSING ITEM IS REFUSED, and the refusal names it', () => {
  const noUat2 = { ...fullBuilder, uat: fullBuilder.uat.filter((u) => u.id !== 'UAT2') };
  let result = checkEvidence({ description: JUL_92, builder: noUat2, reviewer: fullReviewer });
  assert.deepEqual(result.missing, ['UAT2 ("The fresh-reader check"): the UAT plan promises it and the builder wrote nothing for it']);

  const emptyEvidence = { ...fullBuilder, acceptance: [{ ...fullBuilder.acceptance[0], evidence: '  ' }, fullBuilder.acceptance[1]] };
  result = checkEvidence({ description: JUL_92, builder: emptyEvidence, reviewer: fullReviewer });
  assert.match(result.missing[0], /^AC1 .*: the builder named it but gave no evidence$/);

  const notMet = { ...fullReviewer, criteria: [{ ...fullReviewer.criteria[0], verdict: 'not_met', how: '6 contradictions found' }, fullReviewer.criteria[1]] };
  result = checkEvidence({ description: JUL_92, builder: fullBuilder, reviewer: notMet });
  assert.match(result.missing[0], /^AC1 .*: the reviewer found it "not_met", not "met" -- 6 contradictions found$/);

  const noHow = { ...fullReviewer, criteria: [fullReviewer.criteria[0], { ...fullReviewer.criteria[1], how: '' }] };
  result = checkEvidence({ description: JUL_92, builder: fullBuilder, reviewer: noHow });
  assert.match(result.missing[0], /^AC2 .*: the reviewer said "met" but not how it checked$/);
});

test('BY NAME: the right id on the wrong criterion does not count, a small copy difference does', () => {
  const criterion = { id: 'AC2', text: AC2 };
  assert.equal(namesCriterion({ id: 'AC2', criterion: AC2 }, criterion), true);
  assert.equal(namesCriterion({ id: 'ac2', criterion: '**No reference to the old runbook name remains** (test)' }, criterion), true, 'markdown and case are not the name');
  assert.equal(namesCriterion({ id: 'AC2', criterion: AC1 }, criterion), false, 'a different criterion under the right id');
  assert.equal(namesCriterion({ id: 'AC1', criterion: AC2 }, criterion), false, 'the right words under the wrong id');
  assert.equal(namesCriterion({ id: 'AC2' }, criterion), false, 'an id alone is not checking it by name');
});

test('a card with no criteria or no UAT items can never pass', () => {
  const result = checkEvidence({ description: '## UAT plan\n\nlook at it\n', builder: fullBuilder, reviewer: fullReviewer });
  assert.deepEqual(result.missing, [
    'the card lists no acceptance criteria, so there is nothing to accept against',
    'the card\'s UAT plan lists no numbered items, so there is nothing to hand Todd',
  ]);
});

test('ticking touches only the open criterion boxes -- not the struck line, not boxes in other sections', () => {
  const description = `${JUL_92}\n## Steps\n\n- [ ] a step box, not a criterion\n`;
  const ticked = tickCriteria(description);
  assert.match(ticked, /- \[x\] A fresh session/);
  assert.match(ticked, /- \[x\] No reference to the old runbook/);
  assert.match(ticked, /- \[ \] a step box, not a criterion/);
  assert.match(ticked, /- ~~The global settings block/);
  assert.equal(ticked.split('\n').length, description.split('\n').length);
});

test('THE GUARD on the live card: every box ticked AND every UAT item in the evidence comment, or no UAT', () => {
  const check = checkEvidence({ description: JUL_92, builder: fullBuilder, reviewer: fullReviewer });
  const body = evidenceCommentBody({ card: { identifier: 'JUL-92' }, check, builder: fullBuilder, reviewer: fullReviewer });
  assert.ok(body.includes(EVIDENCE_MARKER));
  assert.deepEqual(checkCardForUat({ description: tickCriteria(JUL_92), comments: [{ body }] }), { ok: true, missing: [] });

  let guard = checkCardForUat({ description: JUL_92, comments: [{ body }] });
  assert.deepEqual(guard.missing.map((m) => m.split(' ')[0]), ['AC1', 'AC2'], 'unticked boxes refuse');
  guard = checkCardForUat({ description: tickCriteria(JUL_92), comments: [] });
  assert.deepEqual(guard.missing, ['no evidence comment is on the card']);
  guard = checkCardForUat({ description: tickCriteria(JUL_92), comments: [{ body: body.replace('**UAT3. The rename**', '') }] });
  assert.deepEqual(guard.missing, ['the evidence comment has nothing for UAT3 ("The rename")']);
});

test('the CLI: PASS and exit 0, or one MISSING line per gap and exit 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acceptance-'));
  try {
    const script = new URL('./acceptance-check.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const descriptionPath = join(dir, 'd.md');
    const evidencePath = join(dir, 'e.json');
    writeFileSync(descriptionPath, JUL_92);
    writeFileSync(evidencePath, JSON.stringify({ builder: fullBuilder, reviewer: fullReviewer }));
    assert.equal(execFileSync(process.execPath, [script, '--description', descriptionPath, '--evidence', evidencePath], { encoding: 'utf8' }).trim(), 'PASS');
    writeFileSync(evidencePath, JSON.stringify({ builder: { ...fullBuilder, uat: [] }, reviewer: fullReviewer }));
    let failed = null;
    try { execFileSync(process.execPath, [script, '--description', descriptionPath, '--evidence', evidencePath], { encoding: 'utf8' }); } catch (error) { failed = error; }
    assert.equal(failed?.status, 1);
    assert.equal(failed.stdout.trim().split('\n').filter((l) => l.startsWith('MISSING: ')).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
