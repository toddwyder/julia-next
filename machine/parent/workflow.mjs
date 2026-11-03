// The machine as one stock Mastra workflow (JUL-330): build, then remediation,
// then landing. Each step hands the next one the card and the pull request, and
// each step writes itself into the run's record before it starts and after it
// ends, so the page Todd opens reads the same store the workflow is writing.
//
// A step also writes down what the stage cost (tokens, money, elapsed time, and
// the trace files it left behind), because the stage runs in its own process and
// the run record is the only thing that outlives it. A step that fails stops the
// workflow: the record keeps the steps that ran, the run is finished as failed,
// and the caller tells Todd.

import { loadMastra } from '../shipping/harness.mjs';
import { STEP_IDS } from './store.mjs';

export const WORKFLOW_ID = 'machine';

export async function createMachineWorkflow({ mastra, store, holder, runStage, model = null, runDir = null, log = console.log }) {
  const { z, createWorkflow, createStep } = await loadMastra();

  const state = z.object({ card: z.string(), pr: z.number().nullable().default(null) });

  const stepFor = id =>
    createStep({
      id,
      inputSchema: state,
      outputSchema: state,
      execute: async ({ inputData }) => {
        holder.record = store.begin(holder.record, id);
        let outcome;
        try {
          outcome = await runStage(id, { card: inputData.card, pr: inputData.pr, model, runDir });
        } catch (error) {
          outcome = { status: 'failed', pr: inputData.pr, detail: error.message };
        }
        const recorded = store.end(holder.record, id, outcome);
        holder.record = recorded;
        log(`machine: ${id} ${outcome.status}${outcome.detail ? ` — ${outcome.detail}` : ''}`);
        if (outcome.status === 'failed') throw new Error(`${id} failed: ${outcome.detail ?? 'no reason given'}`);
        return { card: inputData.card, pr: outcome.pr ?? inputData.pr };
      },
    });

  const workflow = createWorkflow({ id: WORKFLOW_ID, inputSchema: state, outputSchema: state })
    .then(stepFor(STEP_IDS[0]))
    .then(stepFor(STEP_IDS[1]))
    .then(stepFor(STEP_IDS[2]))
    .commit();

  mastra.addWorkflow(workflow);
  return { workflow };
}
