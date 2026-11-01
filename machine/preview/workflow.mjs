// The machine that puts a change on a preview and checks it: one PASS or FAIL
// before Todd's UAT. A change that never touches the dashboard is judged by the
// tests and the pull request's checks alone, so no preview is made for it.
import path from 'node:path';

import { loadMastra } from '../shipping/harness.mjs';
import { checks, gather, preview, proofs, settle } from './steps.mjs';
import { verdictOf } from './verdict.mjs';

export const WORKFLOW_ID = 'preview';
export { MAX_FAILS } from './steps.mjs';

export async function createPreviewWorkflow({ mastra, deps, log = console.log, failedBefore = 0 }) {
  const { z, createWorkflow, createStep } = await loadMastra();

  const itemSchema = z.object({
    kind: z.string(),
    name: z.string(),
    ok: z.boolean(),
    detail: z.string().default(''),
    skip: z.boolean().default(false),
  });

  const recordSchema = z.object({
    pr: z.number(),
    card: z.object({
      identifier: z.string(),
      title: z.string().default(''),
      description: z.string().default(''),
      url: z.string().nullable().default(null),
    }),
    sha: z.string(),
    checkout: z.string(),
    files: z.array(z.string()).default([]),
    scope: z.string(),
    scopeReason: z.string().default(''),
    checks: z.any().nullable().default(null),
    preview: z.any().nullable().default(null),
    previewGap: z.string().nullable().default(null),
    proofs: z.array(z.any()).default([]),
    live: z.any().nullable().default(null),
    verdict: z.string().nullable().default(null),
    items: z.array(itemSchema).default([]),
    failing: z.array(z.string()).default([]),
    failCount: z.number().default(0),
    stopped: z.boolean().default(false),
    posted: z.any().nullable().default(null),
    at: z.string().nullable().default(null),
  });

  const startSchema = z.object({ pr: z.number(), card: z.string() });

  const step = (id, run) => createStep({ id, inputSchema: recordSchema, outputSchema: recordSchema, execute: ({ inputData }) => run(inputData) });

  const gatherStep = createStep({ id: 'gather', inputSchema: startSchema, outputSchema: recordSchema, execute: ({ inputData }) => gather(deps, inputData) });

  const workflow = createWorkflow({ id: WORKFLOW_ID, inputSchema: startSchema, outputSchema: recordSchema })
    .then(gatherStep)
    .then(step('preview', state => preview(deps, state)))
    .then(step('checks', state => checks(deps, state)))
    .then(step('proofs', state => proofs(deps, state)))
    .then(
      step('settle', async state => {
        const record = await settle(deps, state, { verdictOf, failedBefore });
        const where = record.stopped ? 'stopped the card' : record.verdict === 'PASS' ? 'passed the change' : 'sent the change back to the build';
        log(`${record.verdict} for #${record.pr}: ${where}.`);
        return record;
      })
    )
    .commit();

  mastra.addWorkflow(workflow);
  // A workflow carries a `then` method for building the graph, so an async
  // function that returned it would be awaited as a promise and never settle.
  return { workflow };
}

// The machine has no agent to start: every step reads a command's exit code or
// an address that answered, so the run needs only the engine and somewhere to
// keep its own state.
export async function runPreview({ pr, card, deps, runDir, failedBefore = 0, log = console.log }) {
  const { Mastra, LibSQLStore } = await loadMastra();
  const storage = new LibSQLStore({ id: `preview-pr-${pr}`, url: `file:${path.join(runDir, 'state.db')}` });
  const mastra = new Mastra({ storage, logger: false });
  const { workflow } = await createPreviewWorkflow({ mastra, deps, log, failedBefore });

  const run = await workflow.createRun();
  log(`Mastra workflow run ${run.runId} started.`);
  const started = Date.now();
  let outcome = null;
  try {
    outcome = await run.start({ inputData: { pr, card } });
  } finally {
    await storage.close?.();
  }
  const elapsedMs = Date.now() - started;

  return {
    runId: run.runId,
    status: outcome?.status ?? 'failed',
    output: outcome?.status === 'success' ? outcome.result : null,
    error: outcome?.status === 'success' ? null : JSON.stringify(outcome?.error ?? outcome?.status ?? 'no outcome'),
    elapsedMs,
  };
}
