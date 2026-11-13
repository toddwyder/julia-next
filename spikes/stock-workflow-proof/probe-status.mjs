#!/usr/bin/env node
// Follow-up probe for JUL-325, question 4: after the run ended, what does
// Mastra's own storage say the run's status is, and under which field?
//
// It reads a state database a spike run already wrote. No model calls.
//
//   node spikes/stock-workflow-proof/probe-status.mjs <state file> <workflow id>

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const stateFile = process.argv[2];
const workflowId = process.argv[3] ?? 'stock-workflow-proof';
if (!stateFile) throw new Error('Give the state database as the first argument.');

const { loadMastra } = await import('../../machine/shipping/harness.mjs');
const { z, createWorkflow, createStep, Mastra, LibSQLStore } = await loadMastra();

const storage = new LibSQLStore({ id: 'probe', url: `file:${path.resolve(stateFile)}` });
const mastra = new Mastra({ storage, logger: false });

const step = createStep({
  id: 'noop',
  inputSchema: z.object({ task: z.string() }),
  outputSchema: z.object({ answer: z.string(), modelId: z.string() }),
  execute: async ({ inputData }) => ({ answer: inputData.task, modelId: 'probe' }),
});
const workflow = createWorkflow({
  id: workflowId,
  inputSchema: z.object({ task: z.string() }),
  outputSchema: z.object({ answer: z.string(), modelId: z.string() }),
}).then(step).commit();
mastra.addWorkflow(workflow);

const [active, all] = await Promise.all([
  workflow.listActiveWorkflowRuns(),
  workflow.listWorkflowRuns({ perPage: 10 }),
]);

console.log(`listActiveWorkflowRuns(): ${active.total} active`);
for (const run of active.runs) console.log(`  ${JSON.stringify(run)}`);
console.log(`listWorkflowRuns(): ${all.total} total`);
for (const run of all.runs) console.log(`  keys: ${Object.keys(run).join(', ')}\n  ${JSON.stringify(run)}`);

process.exit(0);
