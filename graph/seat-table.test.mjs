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
    reviewer: { primary: 'codex', backup: 'claude' },
    'feature-builder': { primary: 'claude', backup: 'pi-deepseek' },
    'defect-fixer': { primary: 'claude', backup: 'pi-deepseek' },
    refactor: { primary: 'claude', backup: 'pi-deepseek' },
    'adversarial-reviewer': { primary: 'codex', backup: 'claude' },
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
  assert.deepEqual(SEAT_TABLE.reviewer, { primary: 'codex', backup: 'claude' });
});

test('GLM stays defined in FAMILY_OF and selectable, but is never a seat default or backup', () => {
  assert.equal(FAMILY_OF['pi-glm'], 'zhipu');
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
