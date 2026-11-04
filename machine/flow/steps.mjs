// The stages. An agent stage runs one plain agent and keeps whatever it wrote.
// A plain stage is a fixed rule: it reads the run's state or the scratch
// folder and returns a value. Landing, Todd's answer and the stop report are
// plain stages, so no model decides them.

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

import { cardState, flowData } from './schema.mjs';
import {
  nextVerdict,
  readArtifact,
  sweepBuild,
  writeArtifact,
  writeLanding,
  writeReport,
  writeRetro,
} from './scratch.mjs';

// The words a stop leaves behind are the same wherever the card stops.
const reportText = (state, detail) =>
  [
    `# ${state.card} stopped`,
    '',
    `Part: ${state.stopPart || 'unknown'}`,
    `Why: ${state.stopWhy || 'no reason recorded'}`,
    `Failures counted: ${state.failCount}`,
    `Shipping rounds: ${state.reviewRound}`,
    `Build rounds: ${state.buildRounds}`,
    `Last detail: ${detail || 'none'}`,
    '',
    'A second failure stops the card; the next step is an Investigation.',
  ].join('\n');

const step = (id, execute, extra = {}) =>
  createStep({ id, inputSchema: flowData, outputSchema: flowData, ...extra, execute });

// A model call is the part of a stage that meets the network, so that stage is
// the one that retries. `retries: 2` is Mastra's own step setting.
const agentStep = (id, execute) => step(id, execute, { retries: 2 });

export function createStages({ agents, dir }) {
  const build = agentStep('build', async ({ state, setState, tracingContext }) => {
    const prompt = `The card is ${state.card}. ${'Write the line now.'}`;
    const result = await agents.build.generate(prompt, { tracingContext });
    const text = result.text ?? '';
    writeArtifact(dir, state.card, text);
    const buildRounds = state.buildRounds + 1;
    await setState({ ...state, buildRounds, requestId: `${state.card}/build-${buildRounds}` });
    return { card: state.card, kind: state.kind, detail: text, finished: false };
  });

  const shipping = agentStep('shipping', async ({ inputData, state, tracingContext }) => {
    const artifact = readArtifact(dir, state.card);
    const result = await agents.shipping.generate(
      `File follows. Is it a plausible recipe title?\n\n${artifact}`,
      { tracingContext },
    );
    return { ...inputData, detail: result.text ?? '' };
  });

  const verdict = step('verdict', async ({ inputData, state, setState }) => {
    const answer = nextVerdict(dir, 'review');
    const failCount = answer === 'FAIL' ? state.failCount + 1 : state.failCount;
    const reviewRound = state.reviewRound + 1;
    await setState({ ...state, failCount, reviewRound });
    return {
      ...inputData,
      verdict: answer,
      failCount,
      detail: `shipping round ${reviewRound} returned ${answer}`,
    };
  });

  const remediation = agentStep('remediation', async ({ inputData, state, tracingContext }) => {
    const artifact = readArtifact(dir, state.card);
    const result = await agents.remediation.generate(
      `Rewrite this line so it reads better.\n\n${artifact}`,
      { tracingContext },
    );
    writeArtifact(dir, state.card, result.text ?? artifact);
    return { ...inputData, detail: result.text ?? '' };
  });

  const passNote = step('pass-note', async ({ inputData }) => ({
    ...inputData,
    detail: `${inputData.detail} (no remediation needed)`,
  }));

  const gate = step('gate', async ({ inputData, state, setState }) => {
    if (inputData.verdict === 'PASS') {
      return { ...inputData, stopped: false };
    }
    await setState({
      ...state,
      stopPart: 'Shipping',
      stopWhy: `Shipping failed twice; the last verdict was FAIL with ${state.failCount} failures counted.`,
    });
    return { ...inputData, stopped: true };
  });

  const acceptance = step(
    'acceptance',
    async ({ inputData, state, setState, resumeData, suspend, suspendData }) => {
      const open = suspendData?.request ?? state.requestId;

      if (!resumeData) {
        return await suspend({ request: open });
      }

      if (resumeData.request !== open) {
        return await suspend({ request: open });
      }

      await setState({ ...state, answer: resumeData.answer });
      return {
        ...inputData,
        accepted: resumeData.answer === 'yes',
        rejected: resumeData.answer !== 'yes',
        detail: `Todd answered ${resumeData.answer} to ${open}`,
      };
    },
    {
      suspendSchema: z.object({ request: z.string() }),
      resumeSchema: z.object({ request: z.string(), answer: z.enum(['yes', 'no']) }),
    },
  );

  const machineAccept = step('machine-accept', async ({ inputData, state, setState }) => {
    await setState({ ...state, answer: 'machine card, no acceptance' });
    return { ...inputData, accepted: true, detail: 'machine card, so no acceptance is asked' };
  });

  const land = step('land', async ({ inputData, state }) => {
    writeLanding(dir, state.card, `Landing after ${state.reviewRound} shipping rounds.`);
    return { ...inputData, landed: true, detail: 'landed on main' };
  });

  const smoke = step('smoke', async ({ inputData, state, setState }) => {
    const answer = nextVerdict(dir, 'smoke');
    const failCount = answer === 'FAIL' ? state.failCount + 1 : state.failCount;
    await setState({
      ...state,
      failCount,
      ...(answer === 'FAIL'
        ? {
            stopPart: 'live smoke test',
            stopWhy: `The live smoke test failed with ${failCount} failures counted.`,
          }
        : {}),
    });
    return { ...inputData, smoke: answer, failCount, detail: `live smoke test returned ${answer}` };
  });

  const smokePass = step('smoke-pass', async ({ inputData }) => ({
    ...inputData,
    detail: `${inputData.detail}; the landed change stays live`,
  }));

  const stopReport = step('stop-report', async ({ inputData, state }) => {
    const path = writeReport(dir, state.card, reportText(state, inputData.detail));
    return { ...inputData, stopped: true, finished: true, detail: `stop report at ${path}` };
  });

  const retro = agentStep('retro', async ({ inputData, state, tracingContext }) => {
    const result = await agents.retro.generate(
      `Card ${state.card} landed after ${state.reviewRound} shipping rounds and ${state.buildRounds} build rounds. Say in one sentence what this run did.`,
      { tracingContext },
    );
    writeRetro(dir, state.card, result.text ?? '');
    return { ...inputData, detail: result.text ?? '' };
  });

  const cleanup = step('cleanup', async ({ inputData, state }) => {
    sweepBuild(dir);
    return { ...inputData, finished: true, detail: `${state.card} cleaned up` };
  });

  const hold = step('hold', async ({ inputData }) => inputData);

  return {
    build,
    shipping,
    verdict,
    remediation,
    passNote,
    gate,
    acceptance,
    land,
    smoke,
    smokePass,
    stopReport,
    retro,
    hold,
    machineAccept,
    cleanup,
  };
}
