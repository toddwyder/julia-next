import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { TokenCostControl } from '@mastra/core/processors';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';

import { openMastra, pruneTrace } from './mastra.mjs';

const require = createRequire(import.meta.url);

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
  const workflow = createWorkflow({
    id: 'test-wf',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    options: { autoRestartActiveRuns: false },
  })
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

test('installed @mastra/core version is reported', t => {
  const pkg = require('@mastra/core/package.json');
  assert.equal(typeof pkg.version, 'string');
  assert.ok(pkg.version.length > 0);
  const line = `@mastra/core version: ${pkg.version}`;
  console.log(line);
  t.diagnostic(line);
});

test('openMastra throws when workflow.options.autoRestartActiveRuns is not false', async t => {
  const dir = tempDir(t);
  const step = createStep({
    id: 'noop',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async () => ({}),
  });
  const workflow = createWorkflow({
    id: 'missing-auto-restart-guard',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
  })
    .then(step)
    .commit();

  await assert.rejects(
    () =>
      openMastra({
        card: 'JUL-901',
        agents: {},
        workflow,
        stateDb: join(dir, 'state.db'),
      }),
    /missing-auto-restart-guard/,
  );
});

function readCounts(countsFile) {
  if (!existsSync(countsFile)) return { outer: 0, nested: 0 };
  return JSON.parse(readFileSync(countsFile, 'utf8'));
}

function incrementCount(countsFile, key) {
  const counts = readCounts(countsFile);
  counts[key] += 1;
  writeFileSync(countsFile, JSON.stringify(counts));
}

function makeCountingWorkflow({ id, autoRestartActiveRuns, countsFile }) {
  const options = autoRestartActiveRuns === false ? { options: { autoRestartActiveRuns: false } } : {};
  const nestedStep = createStep({
    id: 'nested-step',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async () => {
      incrementCount(countsFile, 'nested');
      return {};
    },
  });
  const nestedWorkflow = createWorkflow({
    id: `${id}-nested`,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    ...options,
  })
    .then(nestedStep)
    .commit();
  const outerStep = createStep({
    id: 'outer-step',
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async () => {
      incrementCount(countsFile, 'outer');
      return {};
    },
  });
  return createWorkflow({
    id,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    ...options,
  })
    .then(outerStep)
    .then(nestedWorkflow)
    .commit();
}

async function runChildUntilNestedReady({ stateDb, countsFile, workflowId, autoRestartActiveRuns }) {
  const childScript = `
    import { existsSync, readFileSync, writeFileSync } from 'node:fs';
    import { Mastra } from '@mastra/core';
    import { createWorkflow, createStep } from '@mastra/core/workflows';
    import { LibSQLStore } from '@mastra/libsql';
    import { z } from 'zod';

    const stateDb = process.env.TEST_STATE_DB;
    const countsFile = process.env.TEST_COUNTS_FILE;
    const workflowId = process.env.TEST_WORKFLOW_ID;
    const disableAutoRestart = process.env.TEST_DISABLE_AUTO_RESTART === '1';
    const options = disableAutoRestart ? { options: { autoRestartActiveRuns: false } } : {};

    function incrementCount(key) {
      const counts = existsSync(countsFile)
        ? JSON.parse(readFileSync(countsFile, 'utf8'))
        : { outer: 0, nested: 0 };
      counts[key] += 1;
      writeFileSync(countsFile, JSON.stringify(counts));
    }

    const nestedStep = createStep({
      id: 'nested-step',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => {
        incrementCount('nested');
        process.stdout.write('READY\\n');
        await new Promise(() => {});
        return {};
      },
    });
    const nestedWorkflow = createWorkflow({
      id: workflowId + '-nested',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      ...options,
    })
      .then(nestedStep)
      .commit();
    const outerStep = createStep({
      id: 'outer-step',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => {
        incrementCount('outer');
        return {};
      },
    });
    const workflow = createWorkflow({
      id: workflowId,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      ...options,
    })
      .then(outerStep)
      .then(nestedWorkflow)
      .commit();

    const mastra = new Mastra({
      workflows: { [workflow.id]: workflow },
      storage: new LibSQLStore({ id: 'child-storage', url: 'file:' + stateDb }),
    });
    await mastra.getStorage().init();
    const run = await mastra.getWorkflow(workflow.id).createRun();
    await run.start({ inputData: {} });
  `;

  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
      env: {
        ...process.env,
        TEST_STATE_DB: stateDb,
        TEST_COUNTS_FILE: countsFile,
        TEST_WORKFLOW_ID: workflowId,
        TEST_DISABLE_AUTO_RESTART: autoRestartActiveRuns === false ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!killed && stdout.includes('READY')) {
        killed = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', () => {
      if (!killed) {
        reject(new Error(`Child exited before READY. stdout=${stdout} stderr=${stderr}`));
        return;
      }
      resolvePromise();
    });
  });

  const store = new LibSQLStore({ id: 'backdate-owner', url: `file:${stateDb}` });
  await store.init();
  const pastIso = '2000-01-01T00:00:00.000Z';
  const pastMs = Date.parse(pastIso);
  await store.client.execute({
    sql: `UPDATE mastra_workflow_snapshot SET updatedAt = ?`,
    args: [pastIso],
  });
  await store.client.execute({
    sql: `UPDATE mastra_workflow_run_owners SET leaseExpiresAt = ?, updatedAt = ?`,
    args: [pastMs, pastMs],
  });
  await store.close();
}

test('restartAllActiveWorkflowRuns leaves outer and nested step counters untouched when autoRestartActiveRuns is false (with control)', async t => {
  const disabledDir = tempDir(t);
  const disabledStateDb = join(disabledDir, 'state.db');
  const disabledCountsFile = join(disabledDir, 'counts.json');
  await runChildUntilNestedReady({
    stateDb: disabledStateDb,
    countsFile: disabledCountsFile,
    workflowId: 'wf-disabled',
    autoRestartActiveRuns: false,
  });

  const disabledWorkflow = makeCountingWorkflow({
    id: 'wf-disabled',
    autoRestartActiveRuns: false,
    countsFile: disabledCountsFile,
  });
  const mastraDisabled = await openMastra({
    card: 'JUL-902',
    agents: {},
    workflow: disabledWorkflow,
    stateDb: disabledStateDb,
  });
  t.after(async () => {
    await mastraDisabled.shutdown().catch(() => null);
  });
  await mastraDisabled.getStorage().init();
  await mastraDisabled.restartAllActiveWorkflowRuns();

  const disabledCounts = readCounts(disabledCountsFile);
  assert.equal(disabledCounts.outer, 1, 'outer step counter stays untouched when autoRestartActiveRuns is false');
  assert.equal(disabledCounts.nested, 1, 'nested step counter stays untouched when autoRestartActiveRuns is false');

  const controlDir = tempDir(t);
  const controlStateDb = join(controlDir, 'state.db');
  const controlCountsFile = join(controlDir, 'counts.json');
  await runChildUntilNestedReady({
    stateDb: controlStateDb,
    countsFile: controlCountsFile,
    workflowId: 'wf-control',
    autoRestartActiveRuns: undefined,
  });

  const controlWorkflow = makeCountingWorkflow({
    id: 'wf-control',
    autoRestartActiveRuns: undefined,
    countsFile: controlCountsFile,
  });
  const mastraControl = new Mastra({
    workflows: { [controlWorkflow.id]: controlWorkflow },
    storage: new LibSQLStore({ id: 'control-storage', url: `file:${controlStateDb}` }),
  });
  t.after(async () => {
    await mastraControl.shutdown().catch(() => null);
  });
  await mastraControl.getStorage().init();
  await mastraControl.restartAllActiveWorkflowRuns();

  const controlCounts = readCounts(controlCountsFile);
  assert.ok(controlCounts.nested >= 2, `control nested step counter rises when autoRestartActiveRuns is left on (got ${controlCounts.nested})`);
});
