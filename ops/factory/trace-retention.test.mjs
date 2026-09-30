// trace-retention.test.mjs -- issue #140, blocker 4: bounded observability
// storage, measured honestly.
//
// What is true (verified from the installed, pinned sources):
//   - Mastra's supported bound is an opt-in `retention` config plus
//     `store.prune()`. The DuckDB adapter supports it for the observability
//     domain (`@mastra/duckdb` storage/index.d.ts; bundled
//     `reference-storage-retention.md`: "DuckDB | prune() | Observability
//     spans, metrics, logs, scores, and feedback").
//   - `DEFAULT_RETENTION` sets `observability.spans: { maxAge: '14d' }`
//     (`@mastra/code-sdk` utils/storage-maintenance).
//   - The Factory entry in this repo passes `DEFAULT_RETENTION` only to the Pg
//     and LibSQL backends. Nothing in the repo configures the DuckDB
//     observability store or its retention, so that config provably does NOT
//     bound the DuckDB file. Reporting "bounded" from it would be deceptive.
//
// So the module does the one thing that can be honestly measured -- stat the
// real DuckDB file and its WAL -- and fails visibly when the store is over
// budget or when no supported DuckDB retention is configured. It never deletes
// rows itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_TRACE_BUDGET_BYTES,
  DEFAULT_TRACE_RETENTION_DAYS,
  OBSERVABILITY_DUCKDB_PATH,
  measureStore,
  checkTraceStore,
} from './trace-retention.mjs';

test('the default budget and window match the supported retention', () => {
  assert.equal(DEFAULT_TRACE_RETENTION_DAYS, 14);
  assert.equal(DEFAULT_TRACE_BUDGET_BYTES, 5 * 1024 * 1024 * 1024);
  assert.equal(OBSERVABILITY_DUCKDB_PATH, '/var/lib/julia-factory/.local/share/mastracode/observability.duckdb');
});

test('measureStore stats the database file and its WAL together', () => {
  const dir = mkdtempSync(join(tmpdir(), 'duckdb-measure-'));
  try {
    const db = join(dir, 'observability.duckdb');
    writeFileSync(db, Buffer.alloc(1024 * 1024));
    writeFileSync(`${db}-wal`, Buffer.alloc(512 * 1024));

    const measured = measureStore(db);

    assert.equal(measured.exists, true);
    assert.equal(measured.bytes, 1024 * 1024 + 512 * 1024);
    assert.ok(measured.oldestAgeMs !== null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('measureStore reports a missing store as absent, not as zero bytes present', () => {
  const measured = measureStore('/nonexistent/observability.duckdb');

  assert.equal(measured.exists, false);
  assert.equal(measured.bytes, 0);
});

test('a store over budget fails visibly', () => {
  const result = checkTraceStore({
    measured: { exists: true, bytes: 6 * 1024 * 1024 * 1024, oldestAgeMs: 60 * 60 * 1000 },
    budgetBytes: DEFAULT_TRACE_BUDGET_BYTES,
  });

  assert.equal(result.overBudget, true);
  assert.equal(result.ok, false);
  assert.match(result.message, /over budget/i);
});

test('a bounded, configured store is the only thing reported ok', () => {
  const result = checkTraceStore({
    measured: { exists: true, bytes: 1024 * 1024, oldestAgeMs: 60 * 60 * 1000 },
    budgetBytes: DEFAULT_TRACE_BUDGET_BYTES,
    duckdbRetentionConfigured: true,
  });

  assert.equal(result.overBudget, false);
  assert.equal(result.ok, true);
});

test('a small store with no supported DuckDB retention configured is not reported ok', () => {
  // The false all-clear this replaces: the Pg/LibSQL DEFAULT_RETENTION cannot
  // bound the DuckDB file, so a small file today is not evidence the store is
  // bounded.
  const result = checkTraceStore({
    measured: { exists: true, bytes: 1024 * 1024, oldestAgeMs: 60 * 60 * 1000 },
    budgetBytes: DEFAULT_TRACE_BUDGET_BYTES,
    duckdbRetentionConfigured: false,
  });

  assert.equal(result.overBudget, false);
  assert.equal(result.ok, false);
  assert.match(result.message, /DuckDB.*retention|retention.*DuckDB|not configured/i);
});

test('the repo entry does not configure DuckDB retention, so the check must not treat it as configured', () => {
  // This is the proved fact: `DEFAULT_RETENTION` reaches only the Pg and LibSQL
  // Factory storage constructors in the entry, and no DuckDBStore/observability
  // retention is configured anywhere in ops/factory/app/src/mastra.
  const entry = readFileSync(new URL('./app/src/mastra/index.ts', import.meta.url), 'utf8');

  const pglibRetention = entry.match(/retention:\s*DEFAULT_RETENTION/g) ?? [];
  assert.equal(pglibRetention.length, 2, 'DEFAULT_RETENTION is set on the Pg and LibSQL stores');
  assert.doesNotMatch(entry, /DuckDBStore/);
  assert.doesNotMatch(entry, /observability[^\n]*retention|retention[^\n]*observability/i);
});
