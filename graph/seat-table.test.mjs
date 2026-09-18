import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEAT_TABLE, FAMILY_OF, assertNoSharedFamily } from './seat-table.mjs';

test('the default seat table has the three seats this ticket names, each with a primary and a backup', () => {
  for (const seat of ['orchestrator', 'builder', 'reviewer']) {
    assert.ok(SEAT_TABLE[seat], `missing seat: ${seat}`);
    assert.ok(SEAT_TABLE[seat].primary, `${seat} has no primary`);
    assert.ok(SEAT_TABLE[seat].backup, `${seat} has no backup`);
  }
});

test('builder and reviewer never share a model family, for every combination the default table allows', () => {
  // Must not throw -- the real, shipped table.
  assertNoSharedFamily(SEAT_TABLE);
});

test('a table where builder and reviewer share a family fails the check', () => {
  const badTable = {
    ...SEAT_TABLE,
    builder: { primary: 'claude', backup: 'claude' },
    reviewer: { primary: 'claude', backup: 'codex' },
  };
  assert.throws(
    () => assertNoSharedFamily(badTable),
    /builder and reviewer share a model family/,
  );
});

test('every table entry used by builder or reviewer has a known model family', () => {
  for (const seat of ['builder', 'reviewer']) {
    for (const entry of [SEAT_TABLE[seat].primary, SEAT_TABLE[seat].backup]) {
      assert.ok(FAMILY_OF[entry], `no family known for '${entry}' (seat: ${seat})`);
    }
  }
});
