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
 */
import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { PruneOptions, PruneResult } from '@mastra/core/storage';
import { z } from 'zod';

/** Daily at 04:00 server time, a low-traffic window. */
export const OBSERVABILITY_PRUNE_CRON = '0 4 * * *';

/** The part of a store the daily prune needs; kept narrow so a test can fake it. */
export interface ObservabilityPruner {
  prune(options?: PruneOptions): Promise<PruneResult[]>;
}

/**
 * Bound each scheduled run the way the retention doc recommends: a fixed
 * number of rows and a short pause between batches, so a large backlog drains
 * over several days without starving live traffic. `prune()` reports
 * `done: false` for a table it did not finish; the next tick continues.
 */
export const DEFAULT_PRUNE_OPTIONS: PruneOptions = { maxRows: 100_000, pauseMs: 25 };

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
 * The step body, exported for a direct test. It runs Mastra's supported
 * `prune()` against the configured DuckDB store and returns each table's
 * progress so the run is auditable.
 */
export async function runObservabilityPrune({
  target = pruneTarget,
  log = console.log,
}: {
  target?: ObservabilityPruner | null;
  log?: (message: string) => void;
} = {}): Promise<{ pruned: PruneResult[] }> {
  return { pruned: await pruneObservabilityRetention({ target, log }) };
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
