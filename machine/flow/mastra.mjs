// The run's own storage: LibSQL keeps the workflow's saved state and snapshots,
// DuckDB keeps the trace, and one span processor stamps the card on every span
// so a model call can be found by the card it served.

import { Mastra } from '@mastra/core';
import { SpanType } from '@mastra/core/observability';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import { MastraStorageExporter, Observability } from '@mastra/observability';

// A long build stores one span per model step, and each span's input carries the
// prompt so far, so unbounded strings cost the square of the step count. Two
// thousand characters keeps a tool result readable in the trace without keeping
// the whole of it.
export const MAX_STRING_LENGTH = 2000;

// The stock error processors log the whole prompt at every step, and their spans
// are what grew fastest on 7 Nov. Nothing reads them back.
const EXCLUDED_SPAN_TYPES = [SpanType.PROCESSOR_RUN];

export const cardStamper = card => ({
  name: 'card-stamper',
  process(span) {
    if (!span || !card) return span;
    span.attributes = { ...(span.attributes ?? {}), card };
    return span;
  },
});

export async function openMastra({ card, agents, workflow, stateDb, traceDb }) {
  const storage = new MastraCompositeStore({
    id: 'flow-storage',
    default: new LibSQLStore({ id: 'flow-state', url: `file:${stateDb}` }),
    domains: { observability: await new DuckDBStore({ path: traceDb }).getStore('observability') },
  });

  return new Mastra({
    agents,
    workflows: { [workflow.id]: workflow },
    storage,
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'jul-336-card-path',
          exporters: [new MastraStorageExporter()],
          spanOutputProcessors: [cardStamper(card)],
          serializationOptions: { maxStringLength: MAX_STRING_LENGTH },
          excludeSpanTypes: EXCLUDED_SPAN_TYPES,
          logging: { enabled: false },
        },
      },
    }),
  });
}
