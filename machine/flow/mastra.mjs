// The run's own storage: LibSQL keeps the workflow's saved state and snapshots,
// DuckDB keeps the trace with Mastra retention, and one span processor stamps
// the card on every span so a model call can be found by the card it served.

import { Mastra } from '@mastra/core';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import { MastraStorageExporter, Observability } from '@mastra/observability';

export const DEFAULT_TRACE_MAX_AGE = '1d';

export const cardStamper = card => ({
  name: 'card-stamper',
  process(span) {
    if (!span) return span;
    if (card) span.attributes = { ...(span.attributes ?? {}), card };
    if (typeof span.resourceId === 'string') {
      const match = span.resourceId.match(/^([A-Z]+-\d+)-.+$/);
      if (match) span.resourceId = match[1];
    }
    return span;
  },
});

export async function openMastra({
  card,
  agents,
  workflow,
  stateDb,
  traceDb,
  traceMaxAge = process.env.FLOW_TRACE_MAX_AGE || DEFAULT_TRACE_MAX_AGE,
}) {
  const obs = await new DuckDBStore({ path: traceDb }).getStore('observability');
  const storage = new MastraCompositeStore({
    id: 'flow-storage',
    default: new LibSQLStore({ id: 'flow-state', url: `file:${stateDb}` }),
    domains: { observability: obs },
    retention: {
      observability: {
        spans: { maxAge: traceMaxAge },
      },
    },
  });

  const registeredAgents = Object.fromEntries(
    Object.entries(agents ?? {}).filter(([, agent]) => typeof agent?.__setLogger === 'function'),
  );
  return new Mastra({
    agents: registeredAgents,
    workflows: { [workflow.id]: workflow },
    storage,
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'jul-336-card-path',
          exporters: [new MastraStorageExporter({ maxBatchSize: 1 })],
          spanOutputProcessors: [cardStamper(card)],
          logging: { enabled: false },
        },
      },
    }),
  });
}

export async function pruneTrace(mastra, options) {
  const storage = mastra?.getStorage?.();
  if (!storage?.prune) return [];
  const results = await storage.prune(options);
  try {
    const obs = await storage.getStore?.('observability');
    await obs?.db?.query?.('CHECKPOINT');
  } catch {
    // Checkpoint is best-effort space reclamation after pruning.
  }
  return results;
}
