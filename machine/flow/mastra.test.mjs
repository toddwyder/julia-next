import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Agent } from '@mastra/core/agent';
import { TokenCostControl } from '@mastra/core/processors';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

import { openMastra, pruneTrace } from './mastra.mjs';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-mastra-'));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // DuckDB file handles on Windows can linger until process exit.
    }
  });
  return dir;
}

test('pruneTrace prunes old spans after 1d while keeping cost metrics across 40+ days for the $4 guard', async t => {
  const dir = tempDir(t);
  const dummyStep = createStep({
    id: 'noop',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async () => ({}),
  });
  const workflow = createWorkflow({ id: 'test-wf', inputSchema: z.object({}), outputSchema: z.object({}) })
    .then(dummyStep)
    .commit();

  const mastra = await openMastra({
    card: 'JUL-900',
    agents: {},
    workflow,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
  });
  t.after(async () => {
    await mastra.shutdown().catch(() => null);
  });

  await mastra.getStorage().init();
  const obs = await mastra.getStorage().getStore('observability');
  const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000);
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);

  await obs.createSpan({
    span: {
      traceId: 'trace-old',
      spanId: 'span-old',
      name: 'old-span',
      spanType: 'agent_run',
      startedAt: twoDaysAgo,
      endedAt: twoDaysAgo,
      isEvent: false,
      resourceId: 'JUL-900',
      entityType: 'agent',
    },
  });
  await obs.batchCreateMetrics({
    metrics: [
      {
        metricId: 'm-40d',
        name: 'mastra_model_total_input_tokens',
        value: 1000,
        timestamp: fortyDaysAgo,
        resourceId: 'JUL-900',
        entityType: 'agent',
        estimatedCost: 2.50,
        costUnit: 'USD',
      },
      {
        metricId: 'm-2d',
        name: 'mastra_model_total_output_tokens',
        value: 1000,
        timestamp: twoDaysAgo,
        resourceId: 'JUL-900',
        entityType: 'agent',
        estimatedCost: 1.60,
        costUnit: 'USD',
      },
    ],
  });

  await pruneTrace(mastra);

  const spansLeft = await obs.db.query(`SELECT COUNT(*)::INTEGER AS n FROM span_events WHERE traceId = 'trace-old'`);
  assert.equal(spansLeft[0].n, 0, 'old spans (>1d) are pruned');

  const agg = await obs.getMetricAggregate({
    name: ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'],
    aggregation: 'sum',
    filters: { resourceId: 'JUL-900' },
  });
  assert.ok(agg.estimatedCost >= 4.09, `metrics from 40d and 2d ago remain ($${agg.estimatedCost})`);

  const costControl = new TokenCostControl({ maxCost: 4, scope: 'resource', window: '365d', includeBreakdown: true });
  costControl.__registerMastra(mastra);
  let abortedWith = null;
  await costControl.processInputStep({
    requestContext: new Map([['mastra__resourceId', 'JUL-900']]),
    abort: (reason, opts) => {
      abortedWith = { reason, opts };
      throw new Error(`TRIPWIRE:${reason}`);
    },
  }).catch(err => {
    if (!String(err.message).startsWith('TRIPWIRE:')) throw err;
  });

  assert.ok(abortedWith, 'TokenCostControl blocks when multi-day spend exceeds $4');
});
