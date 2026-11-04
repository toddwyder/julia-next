// Starting and resuming a card's run. Both ends open the same storage, so a
// process that was killed while the path waited for Todd can pick the run up
// where it stood. The card's key name is set before anything imports an agent,
// because the model registry reads it at import time.

process.env.CMD_API_KEY ??= process.env.COMMANDCODE_API_KEY;

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CARD_PATH, initialState } from './schema.mjs';

const DEFAULT_VERDICTS = { review: ['PASS'], smoke: ['PASS'] };

// The instance opened for this process. The run's spans reach the trace file
// through its exporter, so a process that exits before shutting it down loses
// whatever the exporter still holds.
let opened = null;

async function assemble({ dir, card, model, agents: injected }) {
  const { openScratch } = await import('./scratch.mjs');
  const { buildCardPath } = await import('./workflow.mjs');
  const { openMastra } = await import('./mastra.mjs');

  openScratch(dir);
  const agents =
    injected ?? (await import('./agents.mjs')).createAgents(model ? { model } : undefined);
  const workflow = buildCardPath({ agents, dir });
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

function prepareVerdicts(dir, verdicts) {
  const target = join(dir, 'verdicts.json');
  if (verdicts) {
    copyFileSync(verdicts, target);
  } else if (!existsSync(target)) {
    writeFileSync(target, `${JSON.stringify(DEFAULT_VERDICTS, null, 2)}\n`);
  }
  writeFileSync(join(dir, 'cursors.json'), '{}\n');
}

async function waiting(wf, runId) {
  const { createWorkflowStateReader } = await import('@mastra/core/workflows');
  const state = await wf.getWorkflowRunById(runId);
  if (!state) return { status: 'unknown' };
  const suspended = createWorkflowStateReader(state).getSuspendedStep();
  return {
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

export function cardFromRecord(dir) {
  const path = join(dir, 'record.json');
  const line = readFileSync(path, 'utf8').split('\n').find(Boolean);
  return JSON.parse(line).card;
}

export async function startCard({ dir, card, kind, model, verdicts, agents }) {
  mkdirSync(dir, { recursive: true });
  prepareVerdicts(dir, verdicts);

  const { wf } = await assemble({ dir, card, model, agents });
  const run = await wf.createRun();
  const result = await run.start({
    inputData: { card, kind },
    initialState: initialState(card, kind),
  });

  const wait = result.status === 'suspended' ? await waiting(wf, run.runId) : null;

  return {
    card,
    kind,
    runId: run.runId,
    status: result.status,
    suspended: result.suspended ?? null,
    request: wait?.request ?? null,
    step: wait?.step ?? null,
    result: result.result ?? null,
    traceDb: join(dir, 'trace.duckdb'),
    dir,
  };
}

export async function resumeCard({ dir, runId, request, answer, agents }) {
  const card = cardFromRecord(dir);
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
  const card = cardFromRecord(dir);
  const { wf } = await assemble({ dir, card });
  return waiting(wf, runId);
}
