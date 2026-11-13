// The stages. An agent stage runs one plain agent and keeps whatever it wrote.
// A plain stage is a fixed rule: it reads the run's state or the scratch
// folder and returns a value. Landing, Todd's answer and the stop report are
// plain stages, so no model decides them.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

import { closeCopy, openCopy } from './copy.mjs';
import { tokenReport } from './report.mjs';
import { REVIEW_TIME_LIMIT_MS, criteriaFromCard, parseVerdict, realReview, reviewTask, verdictComment } from './review.mjs';
import { cardState, flowData, runInput } from './schema.mjs';
import { HELPER_CONCURRENCY } from './spending.mjs';
import { taskFromCard } from './task.mjs';
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

// The words a stop leaves behind are the same wherever the card stops. A stop on spending also
// states the most the card can overshoot: the helpers running when the cap was crossed, each worth
// at worst the dearest call the card has already paid for.
const reportText = (state, detail, spending) => {
  const dearest = Math.max(0, ...(spending?.calls ?? []).map(call => call.usd));
  const overshoot = state.stopPart === 'Spending' && dearest > 0
    ? [`Worst overshoot: $${(HELPER_CONCURRENCY * dearest).toFixed(3)} (${HELPER_CONCURRENCY} helpers x $${dearest.toFixed(3)}, the dearest call on this card)`]
    : [];
  return [
    `# ${state.card} stopped`,
    '',
    `Part: ${state.stopPart || 'unknown'}`,
    `Why: ${state.stopWhy || 'no reason recorded'}`,
    `Failures counted: ${state.failCount}`,
    `Shipping rounds: ${state.reviewRound}`,
    `Build rounds: ${state.buildRounds}`,
    ...(state.copy ? [`Copy: ${state.copy}`, `Started from main at: ${state.base}`] : []),
    `Last detail: ${detail || 'none'}`,
    ...overshoot,
    '',
    ...tokenReport(spending?.calls ?? []),
    '',
    'A second failure stops the card; the next step is an Investigation.',
  ].join('\n');
};

const step = (id, execute, extra = {}) =>
  createStep({ id, inputSchema: flowData, outputSchema: flowData, ...extra, execute });

export function createStages({ agents, dir, repo, review = realReview }) {
  const spending = agents.spending;
  const cardDir = (card) => join(dir, card);

  // Once the card has spent its limit, or a call came back with no usage to count, no later stage
  // calls a model or changes where the card is going. The card keeps the reason it stopped for,
  // and the path ends at the stop report. A stage also asks about its own model first, so a card
  // that cannot pay for the next call stops with a reason instead of a failed model call.
  const halt = async ({ inputData, state, setState }, stage) => {
    const ids = stage ? agents.spendingIds?.[stage]?.() : null;
    const reason = spending?.stopReason() ?? spending?.blockingReason(ids ?? null) ?? null;
    if (!reason) return null;
    if (state.stopPart !== 'Spending' || state.stopWhy !== reason) {
      await setState({ ...state, stopPart: 'Spending', stopWhy: reason });
    }
    // A stage whose input came from an agent (`{ text }`) still has to hand card data to the
    // next step, so the two things the run started with come from saved state.
    return { card: state.card, kind: state.kind, ...inputData, stopped: true, detail: reason };
  };

  // A stage that spends the card's last dollars in the middle of its call has that call refused by
  // the ledger's processor. The refusal is the card stopping, not the run failing, so the stage
  // hands back the same stopped data as a stage that was turned away before it called.
  const refused = async (context, error) => {
    if (!/TripWire/.test(String(error?.message ?? error))) return null;
    return halt(context);
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

  const startBuild = step('start-build', async (context) => {
    const stopped = await halt(context, 'build');
    if (stopped) return stopped;
    const { inputData, state, setState, requestContext } = context;
    const card = state.card || inputData.card;
    const buildRounds = state.buildRounds + 1;
    const requestId = `${card}/build-${buildRounds}`;
    const copy = openCopy({ repo, card });
    requestContext?.set?.('cardCheckout', copy.folder);
    requestContext?.set?.('mastra__threadId', requestId);
    requestContext?.set?.('mastra__resourceId', card);
    await setState({ ...state, buildRounds, requestId, copy: copy.folder, base: copy.base });
    const issue = await review.readCard(card);
    if (!issue) throw new Error(`Linear card ${card} could not be read.`);
    if (buildRounds === 1) await review.moveCard(card, 'Implementation');
    return { ...inputData, card, detail: `build round ${buildRounds} started in ${copy.folder}`, prompt: taskFromCard(issue) };
  });

  // The build is called here rather than handed to `createStep(agents.build)` so a card that spent
  // its limit in the stage before cannot make the call. Mastra's agent step has no way to skip its
  // agent, and refusing at the model would fail the run instead of ending the card with a reason.
  const buildAgent = createStep({
    id: 'flow-build',
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: z.object({ text: z.string() }),
    execute: async ({ inputData, requestContext, tracingContext, metrics }) => {
      const reason = spending?.stopReason() ?? spending?.blockingReason(agents.spendingIds?.build?.() ?? null) ?? null;
      if (reason) return { text: '' };
      try {
        const response = await agents.build.stream(inputData.prompt, { requestContext, tracingContext, metrics });
        return { text: (await response.text) ?? '' };
      } catch (error) {
        if (!/TripWire/.test(String(error?.message ?? error))) throw error;
        return { text: '' };
      }
    },
  });

  const finishBuild = createStep({
    id: 'finish-build',
    inputSchema: z.object({ text: z.string().optional() }),
    outputSchema: flowData,
    execute: async (context) => {
      const stopped = await halt(context, 'build');
      if (stopped) return stopped;
      const { inputData, state } = context;
      const card = state.card;
      const text = inputData.text ?? '';
      writeArtifact(cardDir(card), card, text);
      return { card, kind: state.kind, detail: text, failCount: state.failCount };
    },
  });

  // Shipping is a fresh agent that gets the card and the card's pull request, nothing the builder
  // said. A review that ends without an answer is not a failed review: it is reported as unreviewed.
  const shipping = step('shipping', async (context) => {
    const stopped = await halt(context, 'shipping');
    if (stopped) return stopped;
    const { inputData, state, tracingContext, requestContext } = context;
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
      const stopped = await refused(context, error);
      if (stopped) return stopped;
      throw error;
    }
  });

  // The verdict is a fixed rule: read the reviewer's verdict line and put it on the pull request.
  // No line, or a comment that did not post, leaves no verdict on the record, so the round is unreviewed.
  const verdict = step('verdict', async (context) => {
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, setState } = context;
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

  const remediation = step('remediation', async (context) => {
    const stopped = await halt(context, 'remediation');
    if (stopped) return stopped;
    const { inputData, state, tracingContext } = context;
    const artifact = readArtifact(cardDir(state.card), state.card);
    let result;
    try {
      result = await agents.remediation.stream(
        `Rewrite this line so it reads better.\n\n${artifact}`,
        { tracingContext },
      );
    } catch (error) {
      const stopped = await refused(context, error);
      if (stopped) return stopped;
      throw error;
    }
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
    const stopped = await halt(context, 'shipping');
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
    const path = writeReport(cardDir(state.card), state.card, reportText(state, inputData.detail, spending));
    return { ...inputData, stopped: true, finished: true, detail: `stop report at ${path}` };
  });

  const retro = step('retro', async (context) => {
    const stopped = await halt(context, 'retro');
    if (stopped) return stopped;
    const { inputData, state, tracingContext } = context;
    let result;
    try {
      result = await agents.retro.stream(
        `Card ${state.card} landed after ${state.reviewRound} shipping rounds and ${state.buildRounds} build rounds. Say in one sentence what this run did.`,
        { tracingContext },
      );
    } catch (error) {
      const stopped = await refused(context, error);
      if (stopped) return stopped;
      throw error;
    }
    const text = await result.text;
    writeRetro(cardDir(state.card), state.card, text ?? '');
    return { ...inputData, detail: text ?? '' };
  });

  // A card that ran to the end gets the same report, so every card leaves the token table behind.
  // A stopped card already wrote its own at the stop report, and that one stays.
  const cleanup = step('cleanup', async ({ inputData, state }) => {
    closeCopy({ repo, card: state.card });
    const report = join(cardDir(state.card), 'reports', `${state.card}.md`);
    if (!existsSync(report)) writeReport(cardDir(state.card), state.card, reportText(state, inputData.detail, spending));
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
