// One stock Mastra workflow carries a card down the whole path. Every rule of
// order, saved state, retries, the shared failure count and the wait for Todd
// is a Mastra setting: `then`, `dountil`, `branch`, workflow `stateSchema`,
// step `retries`, and `suspend`/`resume`. The shape is fixed here; a later card
// replaces one stand-in stage and leaves the shape alone.
//
// Todd's wait sits two levels deep (this workflow, then the attempt's body,
// then the acceptance stage). A wait nested deeper than that does not come
// back to the same stage: resuming it restarts the outermost suspended step,
// which in this version of Mastra would rebuild the card and ask again.

import { createWorkflow } from '@mastra/core/workflows';

import {
  ATTEMPT,
  CARD_PATH,
  FIX_AND_LAND,
  REVIEW_ROUND,
  SMOKE_LOOP,
  SMOKE_ROUND,
  cardState,
  flowData,
} from './schema.mjs';
import { createStages } from './steps.mjs';

const schema = { inputSchema: flowData, outputSchema: flowData, stateSchema: cardState };

// `.branch()` hands on its output keyed by the id of every branch step, with the
// ones that did not run left undefined, and Mastra documents `.map()` for
// reshaping that before the next element (docs-workflows-control-flow.md,
// "Output structure" and "Parallel and Branch outputs"). This mapper takes the
// arm that ran, so the loop condition and the next stage read card data.
const unfold = async ({ inputData }) => {
  if (typeof inputData.card === 'string') return inputData;
  const ran = Object.values(inputData).find((value) => value && typeof value === 'object');
  if (!ran) throw new Error('No branch step produced card data, so the flow cannot go on.');
  return ran;
};

const passed = async ({ inputData }) => inputData.verdict === 'PASS' || inputData.failCount >= 2;
const smokeDone = async ({ inputData }) => inputData.smoke === 'PASS' || inputData.stopped === true;
const answered = async ({ inputData }) => inputData.accepted === true || inputData.stopped === true;

export function buildCardPath({ agents, dir }) {
  const stage = createStages({ agents, dir });

  const reviewRound = createWorkflow({ ...schema, id: REVIEW_ROUND })
    .then(stage.shipping)
    .then(stage.verdict)
    .branch([
      [async ({ inputData }) => inputData.verdict === 'FAIL' && inputData.failCount < 2, stage.remediation],
      [async ({ inputData }) => inputData.verdict === 'PASS', stage.passNote],
      [async ({ inputData }) => inputData.verdict === 'FAIL' && inputData.failCount >= 2, stage.hold],
    ])
    .map(unfold)
    .commit();

  const fixAndLand = createWorkflow({ ...schema, id: FIX_AND_LAND })
    .then(stage.remediation)
    .dountil(reviewRound, passed)
    .then(stage.gate)
    .branch([
      [async ({ inputData }) => inputData.stopped === true, stage.stopReport],
      [async ({ inputData }) => inputData.stopped !== true, stage.land],
    ])
    .map(unfold)
    .commit();

  const smokeRound = createWorkflow({ ...schema, id: SMOKE_ROUND })
    .then(stage.smoke)
    .branch([
      [async ({ inputData }) => inputData.smoke === 'FAIL' && inputData.failCount < 2, fixAndLand],
      [async ({ inputData }) => inputData.smoke === 'FAIL' && inputData.failCount >= 2, stage.stopReport],
      [async ({ inputData }) => inputData.smoke === 'PASS', stage.smokePass],
    ])
    .map(unfold)
    .commit();

  const landAndSmoke = createWorkflow({ ...schema, id: SMOKE_LOOP })
    .then(stage.land)
    .dountil(smokeRound, smokeDone)
    .commit();

  const attempt = createWorkflow({ ...schema, id: ATTEMPT })
    .then(stage.build)
    .dountil(reviewRound, passed)
    .then(stage.gate)
    .branch([
      [async ({ inputData }) => inputData.stopped === true, stage.stopReport],
      [async ({ inputData }) => inputData.stopped !== true && inputData.kind === 'machine', stage.machineAccept],
      [async ({ inputData }) => inputData.stopped !== true && inputData.kind === 'product', stage.acceptance],
    ])
    .map(unfold)
    .commit();

  return createWorkflow({ ...schema, id: CARD_PATH })
    .dountil(attempt, answered)
    .branch([
      [async ({ inputData }) => inputData.stopped === true, stage.hold],
      [async ({ inputData }) => inputData.stopped !== true, landAndSmoke],
    ])
    .map(unfold)
    .branch([
      [async ({ inputData }) => inputData.stopped === true, stage.hold],
      [async ({ inputData }) => inputData.stopped !== true && inputData.landed === true, stage.retro],
      [async ({ inputData }) => inputData.stopped !== true && inputData.landed !== true, stage.hold],
    ])
    .map(unfold)
    .then(stage.cleanup)
    .commit();
}
