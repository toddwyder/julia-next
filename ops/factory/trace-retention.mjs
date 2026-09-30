// trace-retention.mjs -- issue #140, blocker 4: keep observability storage
// bounded, measured honestly.
//
// The change log records the DuckDB trace store at 1.7 GB after about ten
// hours (docs/agents/factory-platform-auth-change-log.md). The supported,
// installed way to bound it is Mastra's own opt-in retention:
//
//   new DuckDBStore({ path, retention: DEFAULT_RETENTION })
//   await store.prune()          // from your own scheduler
//
// (`@mastra/duckdb` `storage/index.d.ts` `DuckDBStoreConfig.retention` and
// `prune()`; bundled `reference-storage-retention.md`: DuckDB prunes
// observability spans, metrics, logs, scores and feedback, and "Mastra never
// runs it for you".) `DEFAULT_RETENTION` keeps `observability.spans` for 14
// days (`@mastra/code-sdk` utils/storage-maintenance).
//
// What this module does NOT do: it never deletes rows, and it never claims a
// bounded store from a config that cannot bound it. The repository entry today
// passes `DEFAULT_RETENTION` only to the Pg and LibSQL backends; nothing here
// configures the DuckDB observability store, so that config provably does not
// bound the DuckDB file. The check therefore does the one thing verifiable on
// the server -- stat the real DuckDB file and its WAL, and fail visibly when it
// is over budget or when supported DuckDB retention is not configured -- rather
// than reporting a false all-clear from the wrong backend's config.
import { statSync } from 'node:fs';

/** The DuckDB file Factory's observability exporter writes (change log, 2026-09-28). */
export const OBSERVABILITY_DUCKDB_PATH = '/var/lib/julia-factory/.local/share/mastracode/observability.duckdb';

/** How long a trace is kept: the `observability.spans` window in DEFAULT_RETENTION. */
export const DEFAULT_TRACE_RETENTION_DAYS = 14;

/** Bytes the observability store may occupy before a cleanup has not done its job. */
export const DEFAULT_TRACE_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;

function sizeOf(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Measure the real DuckDB store: the database file plus its `-wal` sidecar, the
 * same pair Mastra's own maintenance code weighs (`fileSizeWithWal` in
 * `@mastra/code-sdk` utils/storage-maintenance). `oldestAgeMs` is the age of
 * the file's last write; a store that has not been written in a long time while
 * still over budget is a different signal from a live, growing one.
 */
export function measureStore(dbPath = OBSERVABILITY_DUCKDB_PATH, now = Date.now()) {
  let exists = true;
  let mtimeMs = null;
  try {
    mtimeMs = statSync(dbPath).mtimeMs;
  } catch {
    exists = false;
  }
  const bytes = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`);
  return {
    path: dbPath,
    exists,
    bytes,
    oldestAgeMs: mtimeMs === null ? null : Math.max(0, now - mtimeMs),
  };
}

/**
 * The verdict for one measurement. `duckdbRetentionConfigured` must be true only
 * when supported DuckDB retention is actually wired (see the module header);
 * otherwise a small file today is not evidence of a bounded store.
 */
export function checkTraceStore({ measured, budgetBytes = DEFAULT_TRACE_BUDGET_BYTES, duckdbRetentionConfigured }) {
  const overBudget = measured.bytes > budgetBytes;
  const bounded = !overBudget && duckdbRetentionConfigured === true;

  let message;
  if (overBudget) {
    message = `observability store is over budget: ${measured.bytes} bytes > ${budgetBytes} bytes`;
  } else if (duckdbRetentionConfigured !== true) {
    message =
      'observability store size is under budget, but no supported DuckDB retention is configured; ' +
      'size alone is not proof the store is bounded';
  } else {
    message = `observability store is bounded: ${measured.bytes} bytes <= ${budgetBytes} bytes`;
  }

  return {
    ...measured,
    budgetBytes,
    overBudget,
    retentionConfigured: duckdbRetentionConfigured === true,
    ok: bounded,
    message,
  };
}

/**
 * One scheduled check: measure, verdict, print, and fail visibly when not ok.
 * Returning a non-zero exit from `main()` is what makes the systemd run show
 * up red in the journal; nothing is retried or deleted here.
 */
export function runTraceRetentionCheck({
  dbPath = OBSERVABILITY_DUCKDB_PATH,
  budgetBytes = DEFAULT_TRACE_BUDGET_BYTES,
  duckdbRetentionConfigured = false,
  now = Date.now(),
  log = console.log,
} = {}) {
  const result = checkTraceStore({ measured: measureStore(dbPath, now), budgetBytes, duckdbRetentionConfigured });
  log(
    `trace-retention path=${result.path} exists=${result.exists} bytes=${result.bytes} ` +
      `over_budget=${result.overBudget} retention_configured=${result.retentionConfigured} ok=${result.ok}`,
  );
  log(result.message);
  return result;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // The scheduled check fails visibly until the supported DuckDB retention is
  // configured (MASTRACODE_DUCKDB_RETENTION=1 is set by the same change that
  // wires it). Over budget always fails.
  const configured = process.env.MASTRACODE_DUCKDB_RETENTION === '1';
  const result = runTraceRetentionCheck({ duckdbRetentionConfigured: configured });
  process.exit(result.ok ? 0 : 1);
}
