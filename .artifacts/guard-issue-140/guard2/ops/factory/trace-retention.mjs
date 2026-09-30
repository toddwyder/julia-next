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
// bounded store from a config that cannot bound it. The repository entry now
// composes the DuckDB observability domain with `retention: DEFAULT_RETENTION`
// (`app/src/mastra/observability-store.ts`) and prunes it on a schedule
// (`app/src/mastra/observability-retention.ts`), which is the supported path.
// Whether that code has been deployed is a separate question from what this
// repository holds, so the scheduled check still does the one thing verifiable
// on the server -- stat the real DuckDB file and its WAL and fail visibly when
// it is over budget or when the deployed process has not declared the supported
// DuckDB retention in place -- rather than reporting a false all-clear from
// config alone.
import { statSync, statfsSync } from 'node:fs';

/** The DuckDB file Factory's observability exporter writes (change log, 2026-09-28). */
export const OBSERVABILITY_DUCKDB_PATH = '/var/lib/julia-factory/.local/share/mastracode/observability.duckdb';

/** How long a trace is kept: the `observability.spans` window in DEFAULT_RETENTION. */
export const DEFAULT_TRACE_RETENTION_DAYS = 14;

/**
 * The tightened window the size guard applies when the store is over budget.
 * `prune()` is age-based and cannot promise a byte cap, so the guard escalates
 * to a supported, tighter `maxAge` (via `PruneOptions.retention`) plus the
 * documented DuckDB `CHECKPOINT`, and fails closed when it still cannot get
 * under budget.
 */
export const EMERGENCY_TRACE_RETENTION_DAYS = 1;

/** Bytes the observability store may occupy before a cleanup has not done its job. */
export const DEFAULT_TRACE_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Free bytes needed before a DuckDB `CHECKPOINT` can safely reclaim space. The
 * same headroom formula the installed `@mastra/code-sdk` uses before compacting
 * a local store (`utils/storage-maintenance`: `requiredFreeBytes`), so the app
 * and the operator check agree on what "enough room" means.
 */
export function requiredFreeBytes(liveBytes) {
  return Math.ceil(liveBytes * 1.2) + 256 * 1024 * 1024;
}

function sizeOf(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Free bytes on the volume holding `path`. Returns `null` when the volume
 * cannot be measured; a `null` free-space reading always fails closed rather
 * than assuming there is room.
 */
export function measureFreeBytes(path = OBSERVABILITY_DUCKDB_PATH) {
  try {
    const { bsize, bavail } = statfsSync(path);
    return bsize * bavail;
  } catch {
    // The file may not exist yet; measure the nearest existing parent.
    let dir = path;
    for (let i = 0; i < 16; i += 1) {
      dir = dir.replace(/\/[^/]+$/, '') || '/';
      try {
        const { bsize, bavail } = statfsSync(dir);
        return bsize * bavail;
      } catch {
        if (dir === '/') break;
      }
    }
    return null;
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
  const bounded = measured.exists === true && !overBudget && duckdbRetentionConfigured === true;

  let message;
  if (!measured.exists) {
    message = `observability store not found at ${measured.path}; no store to have bounded`;
  } else if (overBudget) {
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
 * The safe action for one measurement. The store is kept physically bounded by
 * Mastra's own supported retention, never by a direct delete:
 *
 *   - `none`           -- no store to prune;
 *   - `routine-prune`  -- under budget; apply the supported age retention;
 *   - `emergency-prune`-- over budget with room to checkpoint; apply the
 *                         tightened supported age retention, then CHECKPOINT;
 *   - `fail-low-disk`  -- over budget with too little free disk to checkpoint
 *                         safely; stop before the disk fills and alert.
 *
 * `prune()` itself can never enforce a byte budget (it deletes by age and
 * never reclaims disk), so this is the explicit size-budget guard around it.
 * A `null` free-space reading fails closed.
 */
export function planRetentionAction({
  measured,
  budgetBytes = DEFAULT_TRACE_BUDGET_BYTES,
  freeBytes,
}) {
  if (!measured.exists) {
    return {
      action: 'none',
      ok: false,
      overBudget: false,
      emergencyRetentionDays: null,
      message: `observability store not found at ${measured.path ?? OBSERVABILITY_DUCKDB_PATH}; nothing to prune`,
    };
  }
  if (measured.bytes <= budgetBytes) {
    return {
      action: 'routine-prune',
      ok: true,
      overBudget: false,
      emergencyRetentionDays: null,
      message: `observability store is under budget: ${measured.bytes} bytes <= ${budgetBytes} bytes; applying supported age retention`,
    };
  }
  const need = requiredFreeBytes(measured.bytes);
  if (freeBytes === null || freeBytes === undefined || freeBytes < need) {
    return {
      action: 'fail-low-disk',
      ok: false,
      overBudget: true,
      emergencyRetentionDays: null,
      requiredFreeBytes: need,
      message:
        `observability store is over budget (${measured.bytes} bytes > ${budgetBytes}) and there is not ` +
        `enough free disk to reclaim it safely (need ${need} bytes, have ${freeBytes ?? 'unknown'}); ` +
        'refusing to prune so the disk cannot fill — free space or move the store, then re-run',
    };
  }
  return {
    action: 'emergency-prune',
    ok: true,
    overBudget: true,
    emergencyRetentionDays: EMERGENCY_TRACE_RETENTION_DAYS,
    requiredFreeBytes: need,
    message:
      `observability store is over budget (${measured.bytes} bytes > ${budgetBytes}); applying the supported ` +
      `${EMERGENCY_TRACE_RETENTION_DAYS}d retention, then a DuckDB CHECKPOINT to reclaim the freed rows`,
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
  // The scheduled check fails visibly until the deployed process declares the
  // supported DuckDB retention is in place (the shipped
  // `julia-factory-trace-retention.service` sets MASTRACODE_DUCKDB_RETENTION=1;
  // a deploy that has not shipped the retention code sets it back to 0). Over
  // budget always fails.
  const configured = process.env.MASTRACODE_DUCKDB_RETENTION === '1';
  const result = runTraceRetentionCheck({ duckdbRetentionConfigured: configured });
  process.exit(result.ok ? 0 : 1);
}
