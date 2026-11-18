// The stages. An agent stage runs one plain agent and keeps whatever it wrote.
// A plain stage is a fixed rule: it reads the run's state or the scratch
// folder and returns a value. Landing, Todd's answer and the stop report are
// plain stages, so no model decides them.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

import { realCheck } from './check.mjs';
import { closeCopy, findLeftoverWork, openCopy } from './copy.mjs';
import { sendCardCostRecord } from './cost-record.mjs';
import { pruneTrace } from './mastra.mjs';
import { acceptanceWaitMessage, notifyCard, reportText, tripwireStop } from './report.mjs';
import { stopIfResourcesShort } from './resources.mjs';
import { REVIEW_TIME_LIMIT_MS, criteriaFromCard, parseVerdict, realReview, reviewTask, verdictComment } from './review.mjs';
import { cardState, flowData, runInput } from './schema.mjs';
import { nextVerdict, openRun, readArtifact, sweepBuild, writeArtifact, writeLanding, writeReport, writeRetro } from './scratch.mjs';
import { taskFromCard } from './task.mjs';

const step = (id, execute, extra = {}) =>
  createStep({ id, inputSchema: flowData, outputSchema: flowData, ...extra, execute });

const REQUIRED_TASK_TOOLS = ['task_write', 'task_update', 'task_complete', 'task_check'];

const finishCard = ({ mastra, card, status }) =>
  Promise.allSettled([sendCardCostRecord({ mastra, card, status }), pruneTrace(mastra)]);

export function createStages({ agents, dir, repo, review = realReview, check = realCheck }) {
  const cardDir = (card) => join(dir, card);

  const halt = async ({ inputData, state }) =>
    state.stopped ? { card: state.card, kind: state.kind, ...inputData, stopped: true, detail: state.stopWhy } : null;

  const haltOrShort = async context => (await halt(context)) ?? stopIfResourcesShort(context, dir);

  const refused = async ({ inputData, state, setState }, error) => {
    if (error?.name !== 'TripWire' && !/TripWire/.test(String(error?.message ?? error))) return null;
    const stop = tripwireStop({
      reason: error?.message,
      processorId: error?.processorId,
      metadata: error?.options?.metadata,
    });
    await setState({ ...state, ...stop, stopped: true });
    return { card: state.card, kind: state.kind, ...inputData, stopped: true, detail: stop.stopWhy };
  };

  const start = createStep({
    id: 'start',
    inputSchema: runInput,
    outputSchema: flowData,
    execute: async ({ inputData, state, setState }) => {
      const toolNames = Object.keys((await agents.build.listTools?.()) ?? agents.build.tools ?? {});
      const missing = REQUIRED_TASK_TOOLS.filter(name => !toolNames.includes(name));
      if (missing.length > 0) {
        throw new Error(`Lead is missing required task tools (${missing.join(', ')}). Check the Lead memory setting before starting a card.`);
      }
      await setState({ ...state, card: inputData.card, kind: inputData.kind });
      openRun(dir, inputData.card);
      const short = await stopIfResourcesShort({ inputData, state: { ...state, card: inputData.card, kind: inputData.kind }, setState }, dir);
      if (short) return short;
      return { card: inputData.card, kind: inputData.kind };
    },
  });

  const startBuild = step('start-build', async (context) => {
    const stopped = await haltOrShort(context);
    if (stopped) return stopped;
    const { inputData, state, setState, requestContext } = context;
    const card = state.card || inputData.card;
    const buildRounds = state.buildRounds + 1;
    const requestId = `${card}/build-${buildRounds}`;
    const leftover = buildRounds === 1 ? findLeftoverWork({ repo, card, findPr: review.findPr }) : '';
    if (leftover) {
      await setState({ ...state, stopPart: 'Leftover work', stopWhy: leftover, stopped: true });
      return { ...inputData, card, stopped: true, detail: leftover, prompt: '' };
    }
    let copy;
    try {
      copy = openCopy({ repo, card });
    } catch (error) {
      const stopWhy = String(error?.message ?? error);
      await setState({ ...state, stopPart: 'start-build', stopWhy, stopped: true });
      return { ...inputData, card, stopped: true, detail: stopWhy, prompt: '' };
    }
    requestContext?.set?.('cardCheckout', copy.folder);
    requestContext?.set?.('flowCard', card);
    requestContext?.set?.('mastra__threadId', requestId);
    requestContext?.set?.('mastra__resourceId', card);
    await setState({ ...state, buildRounds, requestId, copy: copy.folder, base: copy.base, playbook: '', playbookCall: 0 });
    const issue = await review.readCard(card);
    if (!issue) throw new Error(`Linear card ${card} could not be read.`);
    if (buildRounds === 1) await review.moveCard(card, 'Implementation');
    const backNote = state.checkReasons?.length > 0 ? `\n\n## Previous check failure\n${state.checkReasons.at(-1)}` : '';
    const playbookNote = '\n\n## Playbook step\nAs your first act before any other tool call, call `choose_playbook` with the poteto-mode playbook name for this card (for example `feature`, `bug-fix`, `investigation`, `refactoring`). Keep every `playbook_*` item\'s content word for word (only append `skip: <reason>` when leaving a step undone); use `task_complete` or `task_update` with `status` alone to mark a step done (read a named skill\'s `SKILL.md` before marking its step done), and place any step-required sub-items (such as Feature step 3\'s four throughput checkpoint items) immediately after that step rather than overwriting it.';
    return { ...inputData, card, detail: `build round ${buildRounds} started in ${copy.folder}`, prompt: `${taskFromCard(issue)}${backNote}${playbookNote}` };
  });

  const buildAgent = createStep({
    id: 'flow-build',
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: z.object({ text: z.string() }),
    execute: async ({ inputData, state, setState, requestContext, tracingContext, metrics }) => {
      if (state.stopped) return { text: '' };
      let stop = null;
      try {
        const response = await agents.build.stream(inputData.prompt, { requestContext, tracingContext, metrics });
        const text = (await response.text) ?? '';
        const tripwire = await response.tripwire;
        if (tripwire) stop = { ...tripwireStop(tripwire), stopped: true };
        return { text };
      } catch (error) {
        if (error?.name !== 'TripWire' && !/TripWire/.test(String(error?.message ?? error))) throw error;
        stop = { ...tripwireStop({ reason: error?.message, processorId: error?.processorId, metadata: error?.options?.metadata }), stopped: true };
        return { text: '' };
      } finally {
        const chosen = requestContext?.get?.('flowPlaybook');
        if (stop || chosen?.playbook) {
          await setState({
            ...state,
            ...(stop ?? {}),
            ...(chosen?.playbook ? { playbook: chosen.playbook, playbookCall: chosen.callNumber ?? 0 } : {}),
          });
        }
      }
    },
  });

  const finishBuild = createStep({
    id: 'finish-build',
    inputSchema: z.object({ text: z.string().optional() }),
    outputSchema: flowData,
    execute: async (context) => {
      const stopped = await halt(context);
      if (stopped) return stopped;
      const { inputData, state } = context;
      const card = state.card;
      const text = inputData.text ?? '';
      writeArtifact(cardDir(card), card, text);
      return { card, kind: state.kind, detail: text, failCount: state.failCount, playbook: state.playbook, playbookCall: state.playbookCall };
    },
  });

  const buildCheck = step('build-check', async (context) => {
    if (context.inputData.stopped) return context.inputData;
    const stopped = await halt(context);
    if (stopped) return stopped;
    const { inputData, state, setState, mastra } = context;
    const result = await check.run({ mastra, threadId: state.requestId, playbook: state.playbook, repo })
      .catch(error => ({ ok: false, fatal: true, reason: String(error?.message ?? error) }));
    if (result.ok) return { ...inputData, checkPassed: true, checkReason: '' };
    const checkReturns = result.fatal ? state.checkReturns : state.checkReturns + 1;
    const checkReasons = result.fatal ? state.checkReasons : [...state.checkReasons, result.reason];
    const stop = result.fatal || checkReturns >= 2;
    const stopWhy = result.fatal ? `stopped at the check step: ${result.reason}` : `stopped at the check step: (1) ${checkReasons[0]}; (2) ${checkReasons[1]}`;
    await setState({ ...state, checkReturns, checkReasons, ...(stop ? { stopPart: 'check step', stopWhy } : {}) });
    return { ...inputData, checkPassed: false, checkReason: result.reason, stopped: stop, detail: result.reason };
  });

  const shipping = step('shipping', async (context) => {
    const stopped = await haltOrShort(context);
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
      requestContext?.set?.('mastra__resourceId', state.card);
      const result = await agents.shipping.stream(
        reviewTask({ pr: found.pr, sha, checkout, card, criteria }),
        { tracingContext, requestContext, abortSignal: clock },
      );
      const text = (await result.text) ?? '';
      const tripwire = await result.tripwire;
      if (tripwire) {
        const stop = tripwireStop(tripwire);
        await context.setState({ ...state, ...stop, stopped: true });
        return { ...inputData, stopped: true, detail: stop.stopWhy };
      }
      return { ...inputData, pr: found.pr, sha, answer: text, criteriaCount: criteria.length, detail: text };
    } catch (error) {
      if (clock.aborted) return unreviewed(`the review ran longer than ${REVIEW_TIME_LIMIT_MS / 60_000} minutes and was ended`);
      const refusedStop = await refused(context, error);
      if (refusedStop) return refusedStop;
      throw error;
    }
  });

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
    const stopped = await haltOrShort(context);
    if (stopped) return stopped;
    const { inputData, state, tracingContext, requestContext } = context;
    const artifact = readArtifact(cardDir(state.card), state.card);
    requestContext?.set?.('mastra__resourceId', state.card);
    let result;
    try {
      result = await agents.remediation.stream(
        `Rewrite this line so it reads better.\n\n${artifact}`,
        { tracingContext, requestContext },
      );
      const text = (await result.text) ?? '';
      const tripwire = await result.tripwire;
      if (tripwire) {
        const stop = tripwireStop(tripwire);
        await context.setState({ ...state, ...stop, stopped: true });
        return { ...inputData, stopped: true, detail: stop.stopWhy };
      }
      writeArtifact(cardDir(state.card), state.card, text || artifact);
      return { ...inputData, detail: text };
    } catch (error) {
      const refusedStop = await refused(context, error);
      if (refusedStop) return refusedStop;
      throw error;
    }
  });

  const passNote = step('pass-note', async ({ inputData }) => ({ ...inputData, detail: `${inputData.detail} (no remediation needed)` }));

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

      if (!resumeData || resumeData.request !== open) {
        await notifyCard(review, state.card, acceptanceWaitMessage(state.card, open), cardDir(state.card));
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

  const smokePass = step('smoke-pass', async ({ inputData }) => ({ ...inputData, detail: `${inputData.detail}; the landed change stays live` }));

  const stopReport = step('stop-report', async ({ inputData, state, mastra }) => {
    await finishCard({ mastra, card: state.card, status: 'stopped' });
    const report = reportText(state, inputData.detail);
    const path = writeReport(cardDir(state.card), state.card, report);
    await notifyCard(review, state.card, report, cardDir(state.card));
    return { ...inputData, stopped: true, finished: true, detail: `stop report at ${path}` };
  });

  const retro = step('retro', async (context) => {
    const stopped = await haltOrShort(context);
    if (stopped) return stopped;
    const { inputData, state, tracingContext, requestContext } = context;
    requestContext?.set?.('mastra__resourceId', state.card);
    let result;
    try {
      result = await agents.retro.stream(
        `Card ${state.card} landed after ${state.reviewRound} shipping rounds and ${state.buildRounds} build rounds. Say in one sentence what this run did.`,
        { tracingContext, requestContext },
      );
      const text = (await result.text) ?? '';
      const tripwire = await result.tripwire;
      if (tripwire) {
        const stop = tripwireStop(tripwire);
        await context.setState({ ...state, ...stop, stopped: true });
        return { ...inputData, stopped: true, detail: stop.stopWhy };
      }
      writeRetro(cardDir(state.card), state.card, text);
      return { ...inputData, detail: text };
    } catch (error) {
      const refusedStop = await refused(context, error);
      if (refusedStop) return refusedStop;
      throw error;
    }
  });

  const cleanup = step('cleanup', async ({ inputData, state, mastra }) => {
    if (!state.stopped) await finishCard({ mastra, card: state.card, status: 'finished' });
    closeCopy({ repo, card: state.card });
    const report = join(cardDir(state.card), 'reports', `${state.card}.md`);
    if (!existsSync(report)) writeReport(cardDir(state.card), state.card, reportText(state, inputData.detail));
    sweepBuild(cardDir(state.card));
    return { ...inputData, finished: true, detail: `${state.card} cleaned up` };
  });

  const hold = step('hold', async ({ inputData }) => inputData);

  return {
    start, startBuild, buildAgent, finishBuild, buildCheck, shipping, verdict, remediation, passNote,
    gate, acceptance, land, smoke, smokePass, stopReport, retro, hold, machineAccept, cleanup,
  };
}
