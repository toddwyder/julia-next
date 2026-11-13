// The stages. An agent stage runs one plain agent and keeps whatever it wrote.
// A plain stage is a fixed rule: it reads the run's state or the scratch
// folder and returns a value. Landing, Todd's answer and the stop report are
// plain stages, so no model decides them.

import { join } from 'node:path';

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

import { cardState, flowData, runInput } from './schema.mjs';
import {
  nextVerdict,
  openRun,
  readArtifact,
  sweepBuild,
  writeArtifact,
  writeLanding,
  writeReport,
  writeRetro,
} from './scratch.mjs';

// What the build step does with a failed model call is Mastra's own step
// setting. The tests count attempts from this number instead of naming one.
export const BUILD_RETRIES = 2;

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
const agentStep = (id, execute) => step(id, execute, { retries: BUILD_RETRIES });

const buildPrompt = (card, kind) =>
  [
    `Build Linear card ${card}. It is a ${kind} card.`,
    "Read the whole card first, including Todd's dated decisions on it, and move it to Implementation when you start.",
    'Open the pull request in the same step as your first push, name only this card in its description, and keep pushing as you go.',
    'When the build is ready and the pull request is up to date, stop. Shipping comes next.',
    "Only a product decision or one approval in Todd's own account may reach him. Decide the rest and log it in the decision log.",
  ].join('\n');

export function createStages({ agents, dir }) {
  const buildGate = agents.gate;
  const spending = agents.spending;
  const modelStep = (id, execute) => buildGate ? step(id, execute, { retries: 0 }) : agentStep(id, execute);
  const cardDir = (card) => join(dir, card);

  // Once the card has spent its limit, or a call came back with no usage to count, no later stage
  // calls a model or changes where the card is going. The card keeps the reason it stopped for,
  // and the path ends at the stop report.
  const halt = async ({ inputData, state, setState }) => {
    const reason = spending?.stopReason() ?? null;
    if (!reason) return null;
    if (state.stopPart !== 'Spending' || state.stopWhy !== reason) {
      await setState({ ...state, stopPart: 'Spending', stopWhy: reason });
    }
    // A stage whose input came from an agent (`{ text }`) still has to hand card data to the
    // next step, so the two things the run started with come from saved state.
    return { card: state.card, kind: state.kind, ...inputData, stopped: true, detail: reason };
  };

  // The first stage of a run. It takes the two things the run form asks for
  // and puts them into the run's saved state, so every later stage and the
  // finished trace can name the card without asking for it again.
  const start = createStep({
    id: 'start',
    inputSchema: runInput,
    outputSchema: flowData,
    execute: async ({ inputData, state, setState }) => {
      await setState({ ...state, card: inputData.card, kind: inputData.kind });
      openRun(dir, inputData.card);
      spending?.begin(inputData.card);
      return { card: inputData.card, kind: inputData.kind };
    },
  });

  // The build is a real agent step: `createStep(agents.build)` gives it the
  // agent's own input and output, so the card data goes through a mapper either
  // side of it instead of through the stage's shared schema.
  const startBuild = step('start-build', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, setState, requestContext } = context;
    buildGate?.start();
    const card = state.card || inputData.card;
    const buildRounds = state.buildRounds + 1;
    const requestId = `${card}/build-${buildRounds}`;
    requestContext?.set?.('mastra__threadId', requestId);
    requestContext?.set?.('mastra__resourceId', card);
    await setState({ ...state, buildRounds, requestId });
    return { ...inputData, card, detail: `build round ${buildRounds} started`, prompt: buildPrompt(card, state.kind) };
  });

  const buildAgent = createStep(agents.build, { retries: buildGate ? 0 : BUILD_RETRIES });

  const finishBuild = createStep({
    id: 'finish-build',
    inputSchema: z.object({ text: z.string().optional() }),
    outputSchema: flowData,
    execute: async (context) => {
      const stopped = await halt(context);
      if (stopped) return stopped;
      const { inputData, state } = context;
      const card = state.card;
      buildGate?.finish();
      const text = inputData.text ?? '';
      writeArtifact(cardDir(card), card, text);
      return { card, kind: state.kind, detail: text, failCount: state.failCount };
    },
  });

  const shipping = modelStep('shipping', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, tracingContext } = context;
    const artifact = readArtifact(cardDir(state.card), state.card);
    const result = await agents.shipping.stream(
      `File follows. Is it a plausible recipe title?\n\n${artifact}`,
      { tracingContext },
    );
    const text = await result.text;
    return { ...inputData, detail: text ?? '' };
  });

  const verdict = step('verdict', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, setState } = context;
    const answer = nextVerdict(cardDir(state.card), 'review');
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

  const remediation = modelStep('remediation', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, tracingContext } = context;
    const artifact = readArtifact(cardDir(state.card), state.card);
    const result = await agents.remediation.stream(
      `Rewrite this line so it reads better.\n\n${artifact}`,
      { tracingContext },
    );
    const text = await result.text;
    writeArtifact(cardDir(state.card), state.card, text ?? artifact);
    return { ...inputData, detail: text ?? '' };
  });

  const passNote = step('pass-note', async ({ inputData }) => ({
    ...inputData,
    detail: `${inputData.detail} (no remediation needed)`,
  }));

  const gate = step('gate', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, setState } = context;
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
    async (context) => {
      const stopped = await halt(context);
      if (stopped) return stopped;
      const { inputData, state, setState, resumeData, suspend, suspendData } = context;
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

  const machineAccept = step('machine-accept', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, setState } = context;
    await setState({ ...state, answer: 'machine card, no acceptance' });
    return { ...inputData, accepted: true, detail: 'machine card, so no acceptance is asked' };
  });

  const land = step('land', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state } = context;
    writeLanding(cardDir(state.card), state.card, `Landing after ${state.reviewRound} shipping rounds.`);
    return { ...inputData, landed: true, detail: 'landed on main' };
  });

  const smoke = step('smoke', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, setState } = context;
    const answer = nextVerdict(cardDir(state.card), 'smoke');
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
    const path = writeReport(cardDir(state.card), state.card, reportText(state, inputData.detail));
    return { ...inputData, stopped: true, finished: true, detail: `stop report at ${path}` };
  });

  const retro = modelStep('retro', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, tracingContext } = context;
    const result = await agents.retro.stream(
      `Card ${state.card} landed after ${state.reviewRound} shipping rounds and ${state.buildRounds} build rounds. Say in one sentence what this run did.`,
      { tracingContext },
    );
    const text = await result.text;
    writeRetro(cardDir(state.card), state.card, text ?? '');
    return { ...inputData, detail: text ?? '' };
  });

  const cleanup = step('cleanup', async ({ inputData, state }) => {
    sweepBuild(cardDir(state.card));
    return { ...inputData, finished: true, detail: `${state.card} cleaned up` };
  });

  const hold = step('hold', async ({ inputData }) => inputData);

  return {
    start,
    startBuild,
    buildAgent,
    finishBuild,
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
