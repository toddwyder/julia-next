// trace-retention.mjs -- issue #140, seam 3 (addendum): keep observability
// storage bounded.
//
// The change log records the DuckDB trace store at 1.7 GB after about ten
// hours with 30 GB free (docs/agents/factory-platform-auth-change-log.md:124).
// Factory already hands its storage backends Mastra's own `DEFAULT_RETENTION`
// (ops/factory/app/src/mastra/index.ts:344,349); this program is the supported
// check around it: plan what falls outside the window, hand the cutoff to the
// backend's own retention, and report whether the store came back inside its
// budget. It never deletes rows itself -- a hand-built deleter is exactly the
// custom machinery the exceptions list exists to refuse.

/** How long a trace is kept. Two working weeks: long enough for one Monday note either side. */
export const DEFAULT_TRACE_RETENTION_DAYS = 14;

/** Bytes the observability store may occupy before a cleanup has not done its job. */
export const DEFAULT_TRACE_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;

function cutoffFor(now, retentionDays) {
  return new Date(Date.parse(now) - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The spans outside the retention window, oldest first. Pure: the same
 * inventory and clock always give the same answer, so this is the seam a
 * retention defect is reproduced at.
 */
export function selectExpiredSpans({ spans = [], now, retentionDays = DEFAULT_TRACE_RETENTION_DAYS }) {
  const cutoff = cutoffFor(now, retentionDays);
  return spans.filter((span) => Date.parse(span.startedAt) < Date.parse(cutoff));
}

/**
 * Ask the storage backend to run its retention, then report the result.
 *
 * Enforcement itself is the supported `DEFAULT_RETENTION` already passed to
 * the storage backends in `app/src/mastra/index.ts`; this program only plans
 * and reports. The injected `storage` adapter is ours: the operator connects
 * it to the supported backend, tests pass a fake, and no adapter method is
 * claimed to be a Mastra API. The verdict uses the size the backend measured
 * (`storeBytes`), falling back to the bytes it removed (`remainingBytes`) and
 * only then to the inventory, so a partial read-only inventory cannot produce
 * a false all-clear. A store still over budget after cleanup is reported,
 * never retried: retrying would hide the misconfiguration that let it grow.
 */
export async function runTraceCleanup({
  spans = [],
  now,
  retentionDays = DEFAULT_TRACE_RETENTION_DAYS,
  budgetBytes = DEFAULT_TRACE_BUDGET_BYTES,
  storage,
}) {
  const cutoff = cutoffFor(now, retentionDays);
  const expired = selectExpiredSpans({ spans, now, retentionDays });
  const bytesBefore = spans.reduce((sum, span) => sum + (span.bytes ?? 0), 0);

  const enforced = await storage.enforceRetention({ retentionDays, cutoff });
  const bytesAfter =
    enforced?.storeBytes ??
    enforced?.remainingBytes ??
    bytesBefore - expired.reduce((sum, span) => sum + (span.bytes ?? 0), 0);

  return {
    cutoff,
    retentionDays,
    expiredIds: expired.map((span) => span.id),
    expiredCount: expired.length,
    bytesBefore,
    bytesAfter,
    overBudget: bytesAfter > budgetBytes,
  };
}
