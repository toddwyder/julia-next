// Resuming a card's run. Both ends open the same storage, so a process that
// was killed while the path waited for Todd can pick the run up where it stood.
// Starting a card is not here on purpose: the run form in Mastra Studio is the
// one way a card begins, and nothing else sits in front of that agent step.
// The card's key name is set before anything imports an agent, because the
// model registry reads it at import time.

process.env.CMD_API_KEY ??= process.env.COMMANDCODE_API_KEY;

import { join } from 'node:path';

import { CARD_PATH } from './schema.mjs';

// The instance opened for this process. The run's spans reach the trace file
// through its exporter, so a process that exits before shutting it down loses
// whatever the exporter still holds.
let opened = null;

async function assemble({ dir, card, model, agents: injected }) {
  const { openScratch } = await import('./scratch.mjs');
  const { buildCardPath } = await import('./workflow.mjs');
  const { openMastra } = await import('./mastra.mjs');
  const { graphifyTools } = await import('./graphify.mjs');

  openScratch(dir);
  const agents =
    injected ?? (await import('./agents.mjs')).createAgents({
      ...(model ? { model } : {}),
      tools: await graphifyTools(),
    });
  const workflow = buildCardPath({ agents, dir, repo: (await import('./agents.mjs')).repoRoot() });
  const mastra = await openMastra({
    card,
    agents: injected ? undefined : agents,
    workflow,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
  });
  // A workflow carries a `.then` builder method, so returning it from an async
  // function makes the promise adopt it as a thenable and never settle. Hand it
  // back inside a plain object.
  opened = mastra;
  return { wf: mastra.getWorkflow(CARD_PATH) };
}

// The card a run belongs to is in the run's saved state, which is the only
// place it can be: the run was started by the Studio run form, not by a
// launcher that could have written it down.
async function cardOfRun(dir, runId) {
  const { LibSQLStore } = await import('@mastra/libsql');
  const store = new LibSQLStore({ id: 'flow-state', url: `file:${join(dir, 'state.db')}` });
  try {
    await store.init?.();
    const workflows = await store.getStore('workflows');
    const run = await workflows.getWorkflowRunById({ runId, workflowName: CARD_PATH });
    const snapshot = typeof run?.snapshot === 'string' ? JSON.parse(run.snapshot) : run?.snapshot;
    const card = snapshot?.value?.card ?? '';
    if (!card) throw new Error(`Run ${runId} in ${dir} names no card, so it cannot be resumed.`);
    return card;
  } finally {
    await store.close?.();
  }
}

async function waiting(wf, runId) {
  const { createWorkflowStateReader } = await import('@mastra/core/workflows');
  const state = await wf.getWorkflowRunById(runId);
  if (!state) return { status: 'unknown', card: '' };
  const suspended = createWorkflowStateReader(state).getSuspendedStep();
  return {
    card: state.initialState?.card ?? '',
    status: state.status,
    step: suspended?.stepId ?? null,
    path: suspended?.path ?? null,
    request: suspended?.suspendPayload?.request ?? null,
  };
}

export async function closeFlow() {
  const mastra = opened;
  opened = null;
  if (mastra) await mastra.shutdown();
}

export async function resumeCard({ dir, runId, request, answer, agents }) {
  const card = await cardOfRun(dir, runId);
  const { wf } = await assemble({ dir, card, agents });
  const open = await waiting(wf, runId);
  const run = await wf.createRun({ runId });
  const result = await run.resume({
    step: open.step ?? undefined,
    resumeData: { request: request ?? open.request, answer },
  });

  const after = result.status === 'suspended' ? await waiting(wf, runId) : null;

  return {
    card,
    runId,
    status: result.status,
    suspended: result.suspended ?? null,
    request: after?.request ?? null,
    step: after?.step ?? null,
    result: result.result ?? null,
    dir,
  };
}

export async function readState({ dir, runId }) {
  const card = await cardOfRun(dir, runId);
  const { wf } = await assemble({ dir, card });
  return waiting(wf, runId);
}
