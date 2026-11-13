// The stages. An agent stage runs one plain agent and keeps whatever it wrote.
// A plain stage is a fixed rule: it reads the run's state or the scratch
// folder and returns a value. Landing, Todd's answer and the stop report are
// plain stages, so no model decides them.

import { join } from 'node:path';

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

import { closeCopy, openCopy } from './copy.mjs';
import { REVIEW_TIME_LIMIT_MS, criteriaFromCard, parseVerdict, realReview, reviewTask, verdictComment } from './review.mjs';
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
    ...(state.copy ? [`Copy: ${state.copy}`, `Started from main at: ${state.base}`] : []),
    `Last detail: ${detail || 'none'}`,
    '',
    state.unreviewed
      ? 'The card is unreviewed. No failure was counted; it needs a Shipping review before it can go on.'
      : 'A second failure stops the card; the next step is an Investigation.',
  ].join('\n');

const step = (id, execute, extra = {}) =>
  createStep({ id, inputSchema: flowData, outputSchema: flowData, ...extra, execute });

// A model call is the part of a stage that meets the network, so that stage is
// the one that retries. `retries: 2` is Mastra's own step setting.
const agentStep = (id, execute) => step(id, execute, { retries: BUILD_RETRIES });

const buildPrompt = (card, kind) =>
  [
    `Build Linear card ${card}. It is a ${kind} card.`,
    'You work in a fresh copy of the repository made from main for this card. No other card works there.',
    "Read the whole card first, including Todd's dated decisions on it, and move it to Implementation when you start.",
    'Open the pull request in the same step as your first push, name only this card in its description, and keep pushing as you go.',
    'When the build is ready and the pull request is up to date, stop. Shipping comes next.',
    "Only a product decision or one approval in Todd's own account may reach him. Decide the rest and log it in the decision log.",
  ].join('\n');

export function createStages({ agents, dir, repo, review = realReview }) {
  const buildGate = agents.gate;
  const modelStep = (id, execute) => buildGate ? step(id, execute, { retries: 0 }) : agentStep(id, execute);
  const cardDir = (card) => join(dir, card);

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
      return { card: inputData.card, kind: inputData.kind };
    },
  });

  // The build is a real agent step: `createStep(agents.build)` gives it the
  // agent's own input and output, so the card data goes through a mapper either
  // side of it instead of through the stage's shared schema.
  const startBuild = step('start-build', async ({ inputData, state, setState, requestContext }) => {
    buildGate?.start();
    const card = state.card || inputData.card;
    const buildRounds = state.buildRounds + 1;
    const requestId = `${card}/build-${buildRounds}`;
    const copy = openCopy({ repo, card });
    requestContext?.set?.('cardCheckout', copy.folder);
    requestContext?.set?.('mastra__threadId', requestId);
    requestContext?.set?.('mastra__resourceId', card);
    await setState({ ...state, buildRounds, requestId, copy: copy.folder, base: copy.base });
    return { ...inputData, card, detail: `build round ${buildRounds} started in ${copy.folder}`, prompt: buildPrompt(card, state.kind) };
  });

  const buildAgent = createStep(agents.build, { retries: buildGate ? 0 : BUILD_RETRIES });

  const finishBuild = createStep({
    id: 'finish-build',
    inputSchema: z.object({ text: z.string() }),
    outputSchema: flowData,
    execute: async ({ inputData, state }) => {
      const card = state.card;
      buildGate?.finish();
      const text = inputData.text ?? '';
      writeArtifact(cardDir(card), card, text);
      return { card, kind: state.kind, detail: text, failCount: state.failCount };
    },
  });

  // Shipping is a fresh agent that gets the card and the card's pull request, nothing the builder
  // said. A review that ends without an answer is not a failed review: it is reported as unreviewed.
  const shipping = modelStep('shipping', async ({ inputData, state, tracingContext, requestContext }) => {
    const unreviewed = reason => ({ ...inputData, unreviewed: true, pr: null, answer: '', detail: reason });
    const found = review.findPr(repo, state.card);
    if (!found.pr) return unreviewed(found.reason);
    const card = await review.readCard(state.card);
    const criteria = criteriaFromCard(card?.description);
    if (criteria.length === 0) return unreviewed(`${state.card} lists no acceptance criteria to judge`);
    if (!state.copy) return unreviewed(`${state.card} has no copy of the repository to review`);

    const checkout = state.copy;
    const sha = review.headCommit(checkout);
    const clock = AbortSignal.timeout(REVIEW_TIME_LIMIT_MS);
    try {
      requestContext?.set?.('cardCheckout', checkout);
      const result = await agents.shipping.stream(
        reviewTask({ pr: found.pr, sha, checkout, card, criteria }),
        { tracingContext, requestContext, abortSignal: clock },
      );
      const text = await result.text;
      return { ...inputData, pr: found.pr, sha, answer: text ?? '', criteriaCount: criteria.length, detail: text ?? '' };
    } catch (error) {
      if (clock.aborted) return unreviewed(`the review ran longer than ${REVIEW_TIME_LIMIT_MS / 60_000} minutes and was ended`);
      throw error;
    }
  });

  // The verdict is a fixed rule: read the reviewer's verdict line and put it on the pull request.
  // No line, or a comment that did not post, leaves no verdict on the record, so the round is unreviewed.
  const verdict = step('verdict', async ({ inputData, state, setState }) => {
    const reviewRound = state.reviewRound + 1;
    const unreviewed = async reason => {
      await setState({
        ...state,
        reviewRound,
        unreviewed: true,
        stopPart: 'Shipping',
        stopWhy: `The card is unreviewed: ${reason}. No failure was counted.`,
      });
      return { ...inputData, verdict: null, unreviewed: true, detail: `shipping round ${reviewRound} gave no verdict: ${reason}` };
    };
    if (inputData.unreviewed) return unreviewed(inputData.detail);
    const { verdict: answer, reason } = parseVerdict(inputData.answer, inputData.criteriaCount);
    if (!answer) return unreviewed(`the reviewer gave no verdict: ${reason}`);
    try {
      review.postPrComment(repo, inputData.pr, verdictComment({ verdict: answer, answer: inputData.answer, sha: inputData.sha }));
    } catch (error) {
      return unreviewed(`the verdict could not be posted to pull request #${inputData.pr} (${String(error?.message ?? error).split('\n')[0]})`);
    }
    const failCount = answer === 'FAIL' ? state.failCount + 1 : state.failCount;
    await setState({ ...state, failCount, reviewRound });
    return {
      ...inputData,
      verdict: answer,
      failCount,
      detail: `shipping round ${reviewRound} returned ${answer} on pull request #${inputData.pr}`,
    };
  });

  const remediation = modelStep('remediation', async ({ inputData, state, tracingContext }) => {
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

  const gate = step('gate', async ({ inputData, state, setState }) => {
    if (inputData.verdict === 'PASS' || inputData.verdict === 'PASS+NOTES') {
      return { ...inputData, stopped: false };
    }
    if (inputData.unreviewed) {
      return { ...inputData, stopped: true };
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
    writeLanding(cardDir(state.card), state.card, `Landing after ${state.reviewRound} shipping rounds.`);
    return { ...inputData, landed: true, detail: 'landed on main' };
  });

  const smoke = step('smoke', async ({ inputData, state, setState }) => {
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

  const retro = modelStep('retro', async ({ inputData, state, tracingContext }) => {
    const result = await agents.retro.stream(
      `Card ${state.card} landed after ${state.reviewRound} shipping rounds and ${state.buildRounds} build rounds. Say in one sentence what this run did.`,
      { tracingContext },
    );
    const text = await result.text;
    writeRetro(cardDir(state.card), state.card, text ?? '');
    return { ...inputData, detail: text ?? '' };
  });

  const cleanup = step('cleanup', async ({ inputData, state }) => {
    closeCopy({ repo, card: state.card });
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
