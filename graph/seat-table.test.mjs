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
    builder: { primary: 'claude', backup: 'pi-deepseek' },
    reviewer: { primary: 'pi-deepseek', backup: 'codex' },
    'feature-builder': { primary: 'claude', backup: 'pi-deepseek' },
    'defect-fixer': { primary: 'claude', backup: 'pi-deepseek' },
    refactor: { primary: 'claude', backup: 'pi-deepseek' },
    'adversarial-reviewer': { primary: 'pi-deepseek', backup: 'codex' },
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
  assert.deepEqual(SEAT_TABLE.builder, { primary: 'claude', backup: 'pi-deepseek' });
  assert.deepEqual(SEAT_TABLE.reviewer, { primary: 'pi-deepseek', backup: 'codex' });
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

// JUL-98 (Todd's 21 Sep decision): DeepSeek is the reviewer's first choice and
// Codex its backup, to protect the weekly Codex and Claude quotas. Neither is
// the builder's default family, so a resolved pair always obeys the family rule.
test('the reviewer seats default to DeepSeek and back up to Codex, never to the builder family', () => {
  for (const seat of ['reviewer', 'adversarial-reviewer']) {
    assert.deepEqual(SEAT_TABLE[seat], { primary: 'pi-deepseek', backup: 'codex' }, seat);
    assert.notEqual(FAMILY_OF[SEAT_TABLE[seat].primary], FAMILY_OF[SEAT_TABLE.builder.primary], `${seat} primary`);
    assert.notEqual(FAMILY_OF[SEAT_TABLE[seat].backup], FAMILY_OF[SEAT_TABLE.builder.primary], `${seat} backup`);
  }
  assert.equal(SEAT_TABLE.builder.primary, 'claude', 'the builder stays Claude');
});
