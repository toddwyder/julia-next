// The run's own storage: LibSQL keeps the workflow's saved state and snapshots,
// DuckDB keeps the trace, and one span processor stamps the card on every span
// so a model call can be found by the card it served.

import { Mastra } from '@mastra/core';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import { MastraStorageExporter, Observability } from '@mastra/observability';

export const cardStamper = card => ({
  name: 'card-stamper',
  process(span) {
    if (!span || !card) return span;
    span.attributes = { ...(span.attributes ?? {}), card };
    return span;
  },
});

export async function openMastra({ card, agents, workflow, stateDb, traceDb, budget }) {
  const storage = new MastraCompositeStore({
    id: 'flow-storage',
    default: new LibSQLStore({ id: 'flow-state', url: `file:${stateDb}` }),
    domains: { observability: await new DuckDBStore({ path: traceDb }).getStore('observability') },
  });

  const { budget: agentBudget, ...registeredAgents } = agents ?? {};
  budget ??= agentBudget;
  return new Mastra({
    agents: registeredAgents,
    workflows: { [workflow.id]: workflow },
    storage,
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'jul-336-card-path',
          exporters: [new MastraStorageExporter()],
          spanOutputProcessors: [cardStamper(card), ...(budget ? [budget.processor] : [])],
          logging: { enabled: false },
        },
      },
    }),
  });
}
