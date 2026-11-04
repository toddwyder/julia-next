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
    .then(stage.unwrap)
    .commit();

  const fixAndLand = createWorkflow({ ...schema, id: FIX_AND_LAND })
    .then(stage.remediation)
    .dountil(reviewRound, passed)
    .then(stage.gate)
    .branch([
      [async ({ inputData }) => inputData.stopped === true, stage.stopReport],
      [async ({ inputData }) => inputData.stopped !== true, stage.land],
    ])
    .then(stage.unwrap)
    .commit();

  const smokeRound = createWorkflow({ ...schema, id: SMOKE_ROUND })
    .then(stage.smoke)
    .branch([
      [async ({ inputData }) => inputData.smoke === 'FAIL' && inputData.failCount < 2, fixAndLand],
      [async ({ inputData }) => inputData.smoke === 'PASS', stage.smokePass],
      [async ({ inputData }) => inputData.smoke === 'FAIL' && inputData.failCount >= 2, stage.hold],
    ])
    .then(stage.unwrap)
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
      [async ({ inputData }) => inputData.stopped !== true, stage.acceptance],
    ])
    .then(stage.unwrap)
    .commit();

  return createWorkflow({ ...schema, id: CARD_PATH })
    .dountil(attempt, answered)
    .branch([
      [async ({ inputData }) => inputData.stopped === true, stage.hold],
      [async ({ inputData }) => inputData.stopped !== true, landAndSmoke],
    ])
    .then(stage.unwrap)
    .branch([
      [async ({ inputData }) => inputData.stopped === true, stage.hold],
      [async ({ inputData }) => inputData.stopped !== true && inputData.landed === true, stage.retro],
      [async ({ inputData }) => inputData.stopped !== true && inputData.landed !== true, stage.hold],
    ])
    .then(stage.unwrap)
    .then(stage.cleanup)
    .commit();
}
