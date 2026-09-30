// trace-retention.test.mjs -- issue #140, seam 3: bounded observability
// storage. Sample inventory only; the storage adapter is a fake, so this
// proves the plan, the measured-size verdict and the single adapter call, not
// a live DuckDB outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_TRACE_RETENTION_DAYS,
  selectExpiredSpans,
  runTraceCleanup,
} from './trace-retention.mjs';

// The supported way the store stays bounded: Factory hands Mastra's own
// DEFAULT_RETENTION to both storage backends. This guard proves the check in
// this file is paired with real, configured retention; delete the config and
// it fails, so a "bounded" report can never describe an unbounded store.
test('the Factory entry passes the supported DEFAULT_RETENTION to both storage backends', () => {
  const entry = readFileSync(new URL('./app/src/mastra/index.ts', import.meta.url), 'utf8');
  assert.match(entry, /import \{ DEFAULT_RETENTION \} from '@mastra\/code-sdk\/utils\/storage-maintenance'/);
  const storageConfigs = entry.match(/retention:\s*DEFAULT_RETENTION/g) ?? [];
  assert.equal(storageConfigs.length, 2, 'both Pg and LibSQL Factory storage must set DEFAULT_RETENTION');
});

const NOW = '2026-09-30T00:00:00Z';

// 20 days of one span a day, newest last. 1 GB each: the store the change log
// describes, scaled to a fixture.
const spans = Array.from({ length: 20 }, (_, index) => {
  const day = 20 - index;
  return {
    id: `span-${day}`,
    startedAt: new Date(Date.parse(NOW) - day * 24 * 60 * 60 * 1000).toISOString(),
    bytes: 1024 * 1024 * 1024,
  };
});

function fakeStorage(result) {
  const calls = [];
  return { calls, enforceRetention: async (request) => { calls.push(request); return result; } };
}

test('the default window keeps two working weeks', () => {
  assert.equal(DEFAULT_TRACE_RETENTION_DAYS, 14);
});

test('exactly the spans outside the window are expired', () => {
  const expired = selectExpiredSpans({ spans, now: NOW, retentionDays: 14 });
  assert.deepEqual(expired.map((span) => span.id), [
    'span-20', 'span-19', 'span-18', 'span-17', 'span-16', 'span-15',
  ]);
});

test('cleanup hands the cutoff to the backend once and reports a bounded store', async () => {
  const storage = fakeStorage({ remainingBytes: 4 * 1024 * 1024 * 1024 });
  const result = await runTraceCleanup({ spans, now: NOW, storage });

  assert.equal(storage.calls.length, 1);
  assert.deepEqual(storage.calls[0], { retentionDays: 14, cutoff: '2026-09-16T00:00:00.000Z' });
  assert.equal(result.expiredCount, 6);
  assert.equal(result.bytesBefore, 20 * 1024 * 1024 * 1024);
  assert.equal(result.bytesAfter, 4 * 1024 * 1024 * 1024);
  assert.equal(result.overBudget, false);
});

test('a store still over budget after cleanup is reported, not retried', async () => {
  const storage = fakeStorage({ remainingBytes: 9 * 1024 * 1024 * 1024 });
  const result = await runTraceCleanup({ spans, now: NOW, storage });

  assert.equal(storage.calls.length, 1);
  assert.equal(result.overBudget, true);
});

test('the measured store size wins over an inventory that does not add up to it', async () => {
  // The backend can measure the real store: pages the read-only inventory does
  // not list (metrics, half-written rows). A bounded verdict must never come
  // from a smaller inventory when the backend has weighed the store itself.
  const storage = fakeStorage({ storeBytes: 9 * 1024 * 1024 * 1024 });
  const result = await runTraceCleanup({ spans: [spans.at(-1)], now: NOW, storage });

  assert.equal(result.bytesAfter, 9 * 1024 * 1024 * 1024);
  assert.equal(result.overBudget, true);
});

test('a store that never reports back is measured by what was expired', async () => {
  const storage = fakeStorage(undefined);
  // A budget wider than the 14 GiB left after cleanup, so this test is about
  // the fallback measurement, not about the default budget (the test below
  // covers a store that stays over the default).
  const result = await runTraceCleanup({
    spans,
    now: NOW,
    budgetBytes: 16 * 1024 * 1024 * 1024,
    storage,
  });

  assert.equal(result.bytesAfter, 14 * 1024 * 1024 * 1024);
  assert.equal(result.overBudget, false);
});
