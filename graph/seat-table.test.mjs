import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEAT_TABLE, FAMILY_OF, assertNoSharedFamily, assertCanPickDifferentFamilies,
} from './seat-table.mjs';

test('the default seat table has the three seats this ticket names, each with a primary and a backup', () => {
  for (const seat of ['orchestrator', 'builder', 'reviewer']) {
    assert.ok(SEAT_TABLE[seat], `missing seat: ${seat}`);
    assert.ok(SEAT_TABLE[seat].primary, `${seat} has no primary`);
    assert.ok(SEAT_TABLE[seat].backup, `${seat} has no backup`);
  }
});

test("the default table is exactly Todd's instruction: GLM is no seat default or backup", () => {
  assert.deepEqual(SEAT_TABLE, {
    orchestrator: { primary: 'claude', backup: 'pi-deepseek' },
    builder: { primary: 'gemini', backup: 'claude' },
    reviewer: { primary: 'claude', backup: 'codex' },
    'feature-builder': { primary: 'gemini', backup: 'claude' },
    'defect-fixer': { primary: 'claude', backup: 'pi-deepseek' },
    refactor: { primary: 'claude', backup: 'pi-deepseek' },
    'adversarial-reviewer': { primary: 'claude', backup: 'codex' },
    'evidence-reviewer': { primary: 'codex', backup: 'claude' },
    consultant: { primary: 'claude', backup: 'pi-deepseek' },
  });
});

test('the six JUL-97 graph-agent seats have a primary and a backup, and the original three are unchanged', () => {
  for (const seat of [
    'feature-builder', 'defect-fixer', 'refactor',
    'adversarial-reviewer', 'evidence-reviewer', 'consultant',
  ]) {
    assert.ok(SEAT_TABLE[seat], `missing seat: ${seat}`);
    assert.ok(SEAT_TABLE[seat].primary, `${seat} has no primary`);
    assert.ok(SEAT_TABLE[seat].backup, `${seat} has no backup`);
  }
  // The original three remain exactly what the coordinator and the
  // builder/reviewer family rule already depended on.
  assert.deepEqual(SEAT_TABLE.orchestrator, { primary: 'claude', backup: 'pi-deepseek' });
  // The two DISPATCHED seats are what JUL-98 step 6 moved; the dispatch name
  // and its agent key must never disagree, or a card would show one seat and
  // run another.
  assert.deepEqual(SEAT_TABLE.builder, SEAT_TABLE['feature-builder']);
  assert.deepEqual(SEAT_TABLE.reviewer, SEAT_TABLE['adversarial-reviewer']);
});

test('GLM is gone: no family, and never a seat default or backup (JUL-93)', () => {
  assert.ok(!Object.hasOwn(FAMILY_OF, 'pi-glm'));
  assert.ok(!Object.values(FAMILY_OF).includes('zhipu'));
  for (const [name, seat] of Object.entries(SEAT_TABLE)) {
    assert.notEqual(seat.primary, 'pi-glm', `${name} primary must not be GLM`);
    assert.notEqual(seat.backup, 'pi-glm', `${name} backup must not be GLM`);
  }
});

test('the real table allows a different-family builder/reviewer pair for every entry', () => {
  assertCanPickDifferentFamilies(SEAT_TABLE);
  // The old name stays an alias for anything that still imports it.
  assert.equal(assertNoSharedFamily, assertCanPickDifferentFamilies);
});

test('a table where a builder entry has no differing-family reviewer partner throws', () => {
  const badTable = {
    ...SEAT_TABLE,
    builder: { primary: 'claude', backup: 'claude' },
    reviewer: { primary: 'claude', backup: 'claude' },
  };
  assert.throws(
    () => assertCanPickDifferentFamilies(badTable),
    /no reviewer entry from a different family/,
  );
});

test('a table where a reviewer entry has no differing-family builder partner throws', () => {
  const badTable = {
    ...SEAT_TABLE,
    builder: { primary: 'claude', backup: 'claude' },
    reviewer: { primary: 'claude', backup: 'codex' },
  };
  assert.throws(
    () => assertCanPickDifferentFamilies(badTable),
    /no builder entry from a different family/,
  );
});

test('every table entry used by builder or reviewer has a known model family', () => {
  for (const seat of ['builder', 'reviewer']) {
    for (const entry of [SEAT_TABLE[seat].primary, SEAT_TABLE[seat].backup]) {
      assert.ok(FAMILY_OF[entry], `no family known for '${entry}' (seat: ${seat})`);
    }
  }
});

// JUL-98 step 6: THE READING OF THE TABLE, in one test. Gemini builds; Claude
// reviews; and Codex reviews whenever Claude builds -- which is not a fourth
// rule but what the family guard already does when the builder falls back to
// its Claude backup and collides with the Claude reviewer.
test('the seat table reads Gemini builds, Claude reviews, Codex reviews whenever Claude builds', () => {
  for (const seat of ['builder', 'feature-builder']) {
    assert.deepEqual(SEAT_TABLE[seat], { primary: 'gemini', backup: 'claude' }, seat);
  }
  for (const seat of ['reviewer', 'adversarial-reviewer']) {
    assert.deepEqual(SEAT_TABLE[seat], { primary: 'claude', backup: 'codex' }, seat);
  }
  // Gemini builds and Claude reviews: a legal pair with no move at all.
  assert.notEqual(FAMILY_OF[SEAT_TABLE.builder.primary], FAMILY_OF[SEAT_TABLE.reviewer.primary]);
  // Claude builds (the builder's backup): the Claude reviewer is then the same
  // family, so the reviewer's own backup, Codex, is the only legal partner.
  assert.equal(FAMILY_OF[SEAT_TABLE.builder.backup], FAMILY_OF[SEAT_TABLE.reviewer.primary]);
  assert.notEqual(FAMILY_OF[SEAT_TABLE.builder.backup], FAMILY_OF[SEAT_TABLE.reviewer.backup]);
});

test('Gemini is a model family of its own, so it can never review its own work', () => {
  assert.equal(FAMILY_OF.gemini, 'google');
  for (const [entry, family] of Object.entries(FAMILY_OF)) {
    if (entry !== 'gemini') assert.notEqual(family, 'google', `${entry} must not share Gemini's family`);
  }
});
