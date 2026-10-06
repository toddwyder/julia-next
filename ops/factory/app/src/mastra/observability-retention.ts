/**
 * The daily scheduler for supported DuckDB observability retention (JUL-140).
 *
 * Mastra's retention doc says to run `prune()` from a scheduler or maintenance
 * worker and never from app startup/shutdown, and to prefer a single active
 * scheduler for a shared database. DuckDB allows one writer across processes,
 * so the scheduler must live in the app process that already holds the store —
 * which is exactly what Mastra's own cron scheduler is for.
 *
 * Declaring `schedule` selects Mastra's evented engine and auto-enables the
 * workflow scheduler; the `schedules` domain in Factory's default storage
 * records the fire history. The step calls the same DuckDB store the app
 * composes, so it prunes the real file with the real retention.
 *
 * `prune()` is age-based and never reclaims disk, so it cannot on its own
 * promise a byte cap. This module adds the explicit size-budget guard the
 * installed `@mastra/duckdb` docs call for: when the store is over budget it
 * applies a tighter supported `maxAge` through `PruneOptions.retention`, then
 * runs the documented DuckDB `CHECKPOINT` to reclaim the freed rows. When the
 * volume lacks the headroom a checkpoint needs, it stops and reports instead of
 * pressing on and filling the disk. It never issues a direct DB delete.
 *
 * Official docs: https://mastra.ai/docs/storage (retention / "Running prune on a
 * schedule" / DuckDB "run CHECKPOINT after pruning").
 */
import { statSync, statfsSync } from 'node:fs';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { PruneOptions, PruneResult, RetentionConfig } from '@mastra/core/storage';
import { z } from 'zod';
import { observabilityDuckDBPath } from './observability-store.js';

/** Daily at 04:00 server time, a low-traffic window. */
export const OBSERVABILITY_PRUNE_CRON = '0 4 * * *';

/** Bytes the DuckDB store may occupy before the guard escalates. */
export const OBSERVABILITY_SIZE_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;

/** The tightened window applied when the store is over budget. */
export const EMERGENCY_TRACE_RETENTION_DAYS = 1;

/** The over-budget supported policy, passed through `PruneOptions.retention`. */
export const EMERGENCY_RETENTION: RetentionConfig = {
  observability: {
    spans: { maxAge: `${EMERGENCY_TRACE_RETENTION_DAYS}d` },
    logs: { maxAge: `${EMERGENCY_TRACE_RETENTION_DAYS}d` },
  },
};

/**
 * The part of a store the daily prune needs; kept narrow so a test can fake it.
 * `checkpoint` is the documented DuckDB maintenance after a prune; it is
 * optional so a fake that does not model it still works.
 */
export interface ObservabilityPruner {
  prune(options?: PruneOptions): Promise<PruneResult[]>;
  checkpoint?(): Promise<void>;
}

/**
 * Bound each scheduled run the way the retention doc recommends: a fixed
 * number of rows and a short pause between batches, so a large backlog drains
 * over several days without starving live traffic. `prune()` reports
 * `done: false` for a table it did not finish; the next tick continues.
 */
export const DEFAULT_PRUNE_OPTIONS: PruneOptions = { maxRows: 100_000, pauseMs: 25 };

/** Free bytes needed before a checkpoint can reclaim space (1.2x + 256 MB). */
export function requiredFreeBytes(liveBytes: number): number {
  return Math.ceil(liveBytes * 1.2) + 256 * 1024 * 1024;
}

/** File size + WAL for the store, tolerating a store that does not exist yet. */
export function storeBytes(path: string = observabilityDuckDBPath()): number {
  let total = 0;
  for (const file of [path, `${path}-wal`]) {
    try {
      total += statSync(file).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Only a genuinely missing file counts as zero.
    }
  }
  return total;
}

/**
 * Free bytes on the volume holding the store, or `null` when it cannot be
 * measured. A `null` reading fails closed rather than assuming room.
 */
export function freeBytesAt(path: string = observabilityDuckDBPath()): number | null {
  let dir = path;
  for (let i = 0; i < 16; i += 1) {
    try {
      const { bsize, bavail } = statfsSync(dir);
      return bsize * bavail;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dir.replace(/\/[^/]+$/, '') || '/';
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const emptyInput = z.object({});
const pruneOutput = z.object({
  pruned: z.array(
    z.object({
      domain: z.string(),
      table: z.string(),
      deleted: z.number(),
      done: z.boolean(),
    }),
  ),
});

let pruneTarget: ObservabilityPruner | null = null;
let costCapture: (() => Promise<void>) | null = null;
let priceRefresh: (() => Promise<void>) | null = null;

/** Bind the in-process cost reader after Factory has composed its stores. */
export function setIssueCostCapture(capture: () => Promise<void>): void {
  costCapture = capture;
}
export function setModelPriceRefresh(refresh: () => Promise<void>): void { priceRefresh = refresh; }

/**
 * Give the scheduled step the DuckDB store to prune. `index.ts` calls this
 * after it composes the store; until then a fire fails loudly rather than
 * reporting a prune that did nothing.
 */
export function setObservabilityPruneTarget(target: ObservabilityPruner): void {
  pruneTarget = target;
}

/**
 * Run the real DuckDB observability prune and report each table's progress.
 *
 * This is the production call site for Mastra's supported retention: it never
 * deletes rows itself, it asks the DuckDB store to apply the retention
 * configured at construction (`DEFAULT_RETENTION`). A missing target is a
 * configuration error and throws rather than silently skipping the prune.
 */
export async function pruneObservabilityRetention({
  target,
  options = DEFAULT_PRUNE_OPTIONS,
  log = console.log,
}: {
  target?: ObservabilityPruner | null;
  options?: PruneOptions;
  log?: (message: string) => void;
} = {}): Promise<PruneResult[]> {
  if (!target) {
    throw new Error('observability prune target is not configured; refusing to report a prune that did not run');
  }
  const results = await target.prune(options);
  if (results.length === 0) {
    log('observability-retention: no retention-eligible rows to prune');
    return results;
  }
  for (const result of results) {
    log(
      `observability-retention: ${result.domain}.${result.table} deleted=${result.deleted} done=${result.done}`,
    );
  }
  const remaining = results.filter((result) => !result.done);
  if (remaining.length > 0) {
    log(`observability-retention: ${remaining.length} table(s) still draining; the next run continues`);
  }
  return results;
}

/**
 * One guarded retention run.
 *
 * Measure -> decide -> apply the supported prune -> checkpoint when we escalated
 * -> re-measure. The routine (under-budget) path applies the store's standing
 * age retention. The emergency path applies the tighter supported retention and
 * a checkpoint. The low-disk path throws before touching anything, so the disk
 * cannot fill while reclaiming. If the store is still over budget afterwards,
 * the run throws so the failure is visible rather than reported as healthy.
 */
export async function runObservabilityRetention({
  target = pruneTarget,
  path = observabilityDuckDBPath(),
  budgetBytes = OBSERVABILITY_SIZE_BUDGET_BYTES,
  routineOptions = DEFAULT_PRUNE_OPTIONS,
  measureBytes = storeBytes,
  measureFree = freeBytesAt,
  log = console.log,
}: {
  target?: ObservabilityPruner | null;
  path?: string;
  budgetBytes?: number;
  routineOptions?: PruneOptions;
  measureBytes?: (path: string) => number;
  measureFree?: (path: string) => number | null;
  log?: (message: string) => void;
} = {}): Promise<{ bytesBefore: number; bytesAfter: number; action: string; pruned: PruneResult[] }> {
  if (!target) {
    throw new Error('observability prune target is not configured; refusing to report a prune that did not run');
  }
  const bytesBefore = measureBytes(path);
  const free = measureFree(path);
  const overBudget = bytesBefore > budgetBytes;

  if (overBudget) {
    const need = requiredFreeBytes(bytesBefore);
    if (free === null || free < need) {
      throw new Error(
        `observability store is over budget (${bytesBefore} bytes > ${budgetBytes}) and there is not enough ` +
          `free disk to reclaim it safely (need ${need} bytes, have ${free ?? 'unknown'}); refusing to prune ` +
          'so the disk cannot fill — free space or move the store, then re-run',
      );
    }
    log(
      `observability-retention: over budget (${bytesBefore} bytes); applying ${EMERGENCY_TRACE_RETENTION_DAYS}d retention then CHECKPOINT`,
    );
    const pruned = await target.prune({ ...routineOptions, retention: EMERGENCY_RETENTION });
    if (target.checkpoint) await target.checkpoint();
    const bytesAfter = measureBytes(path);
    log(`observability-retention: bytes ${bytesBefore} -> ${bytesAfter} after emergency prune + checkpoint`);
    if (bytesAfter > budgetBytes) {
      throw new Error(
        `observability store is still over budget after emergency prune + checkpoint ` +
          `(${bytesAfter} bytes > ${budgetBytes}); manual operator action is required`,
      );
    }
    return { bytesBefore, bytesAfter, action: 'emergency-prune', pruned };
  }

  const pruned = await pruneObservabilityRetention({ target, options: routineOptions, log });
  const bytesAfter = measureBytes(path);
  log(`observability-retention: under budget (${bytesAfter} bytes <= ${budgetBytes}); applied routine retention`);
  return { bytesBefore, bytesAfter, action: 'routine-prune', pruned };
}

/**
 * The step body, exported for a direct test. It runs Mastra's supported
 * `prune()` against the configured DuckDB store and returns each table's
 * progress so the run is auditable.
 */
export async function runObservabilityPrune({
  target = pruneTarget,
  capture = costCapture ?? undefined,
  log = console.log,
}: {
  target?: ObservabilityPruner | null;
  /** Capture is deliberately isolated: cost evidence must not delay retention. */
  capture?: () => Promise<void>;
  log?: (message: string) => void;
} = {}): Promise<{ pruned: PruneResult[] }> {
  if (capture) {
    try {
      await capture();
    } catch (error) {
      log(`issue-cost-capture event=failed issue=unknown error=${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (priceRefresh) {
    try { await priceRefresh(); } catch (error) { log(`model-price-refresh event=failed error=${error instanceof Error ? error.message : String(error)}`); }
  }
  const { pruned } = await runObservabilityRetention({ target, log });
  return { pruned };
}

const pruneObservabilityStep = createStep({
  id: 'prune-observability',
  description: 'Apply supported DuckDB observability retention',
  inputSchema: emptyInput,
  outputSchema: pruneOutput,
  execute: async () => runObservabilityPrune(),
});

export const observabilityRetentionWorkflow = createWorkflow({
  id: 'observability-retention',
  description: 'Prune DuckDB observability spans older than the configured retention',
  inputSchema: emptyInput,
  outputSchema: pruneOutput,
  schedule: { cron: OBSERVABILITY_PRUNE_CRON },
})
  .then(pruneObservabilityStep)
  .commit();
