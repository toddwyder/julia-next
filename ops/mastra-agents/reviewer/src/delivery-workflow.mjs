import { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { createClient } from '@libsql/client';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod/v4';

export const DELIVERY_WORKFLOW_ID = 'julia-delivery-round-1';
const MAX_ROUNDS = 3;
const pathSchema = z.string().min(1);
const handoffSchema = z.object({
  approvedInputPath: pathSchema,
  runDirectory: pathSchema,
  runMetadataPath: pathSchema,
  round: z.number().int().min(0).max(MAX_ROUNDS),
  builderResultPath: pathSchema.optional(),
  checksResultPath: pathSchema.optional(),
  reviewResultPath: pathSchema.optional(),
  noticeResultPath: pathSchema.optional(),
  stopReason: z.string().optional(),
});
const terminalSchema = z.object({
  ...handoffSchema.shape,
  outcome: z.enum(['accepted', 'rejected', 'parked']),
  reason: z.string().optional(),
});
const workflowOutputSchema = z.object({
  outcome: z.enum(['accepted', 'rejected', 'parked']),
  reason: z.string().optional(),
  round: z.number().int(),
  summaryPath: pathSchema,
  peakMemoryBytes: z.number().int().positive(),
});

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
  return path;
}

async function updateMetadata(path, update) {
  const current = await readJson(path);
  const next = { ...current, ...update };
  await writeJson(path, next);
  return next;
}

export async function appendPermanentSummaryLine(path, runId, line) {
  const identity = `runId=${JSON.stringify(runId)}`;
  let existing = '';
  try { existing = await readFile(path, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (existing.split(/\r?\n/).some(saved => saved.endsWith(identity))) return false;
  await appendFile(path, `${line} ${identity}\n`);
  return true;
}

function adapterInput(inputData, additions = {}) {
  const input = {
    round: inputData.round,
    runDirectory: inputData.runDirectory,
    approvedInputPath: inputData.approvedInputPath,
    ...additions,
  };
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value != null));
}

function requireResultPath(role, result) {
  if (!result || typeof result.resultPath !== 'string' || !result.resultPath) {
    throw new Error(`${role} step did not return a result path`);
  }
  return result.resultPath;
}

function errorMessage(error) {
  return typeof error?.message === 'string' ? error.message : String(error);
}

async function failedResult(inputData, role, error) {
  const reason = `${role} failed: ${errorMessage(error)}`;
  const fileRole = role === 'reviewer' ? 'review' : role === 'notification' ? 'notice' : role;
  const resultPath = await writeJson(join(inputData.runDirectory, `${fileRole}-${inputData.round}.json`), {
    status: 'FAIL', verdict: 'FAIL', reason,
    model: null, effort: null, inputTokens: 0, outputTokens: 0, costEstimateUsd: 0,
  });
  return { resultPath, reason };
}

function createDeliveryWorkflow(adapters, samplePeak, summaryPath) {
  const build = createStep({
    id: 'build',
    inputSchema: handoffSchema,
    outputSchema: handoffSchema,
    execute: async ({ inputData }) => {
      const round = inputData.round + 1;
      await updateMetadata(inputData.runMetadataPath, { round });
      await samplePeak(inputData.runMetadataPath);
      let result;
      try {
        result = await adapters.builder(adapterInput({ ...inputData, round }, {
          priorReviewPath: inputData.reviewResultPath,
        }));
      } catch (error) {
        const failed = await failedResult({ ...inputData, round }, 'builder', error);
        await updateMetadata(inputData.runMetadataPath, { round, builderResultPath: failed.resultPath, stopReason: failed.reason });
        return { ...inputData, round, builderResultPath: failed.resultPath, stopReason: failed.reason };
      }
      const builderResultPath = requireResultPath('builder', result);
      await updateMetadata(inputData.runMetadataPath, { round, builderResultPath });
      await samplePeak(inputData.runMetadataPath);
      return {
        approvedInputPath: inputData.approvedInputPath,
        runDirectory: inputData.runDirectory,
        runMetadataPath: inputData.runMetadataPath,
        round,
        builderResultPath,
      };
    },
  });

  const checks = createStep({
    id: 'checks',
    inputSchema: handoffSchema,
    outputSchema: handoffSchema,
    execute: async ({ inputData }) => {
      const builder = await readJson(inputData.builderResultPath);
      let checksResultPath;
      if (builder.status === 'PASS') {
        try {
          const result = await adapters.checks(adapterInput(inputData, { builderResultPath: inputData.builderResultPath }));
          checksResultPath = requireResultPath('checks', result);
        } catch (error) {
          const failed = await failedResult(inputData, 'checks', error);
          checksResultPath = failed.resultPath;
          inputData = { ...inputData, stopReason: failed.reason };
        }
      } else {
        checksResultPath = await writeJson(join(inputData.runDirectory, `checks-${inputData.round}.json`), {
          status: 'FAIL', reason: builder.reason ?? 'builder did not pass',
        });
      }
      await updateMetadata(inputData.runMetadataPath, { checksResultPath, ...(inputData.stopReason ? { stopReason: inputData.stopReason } : {}) });
      await samplePeak(inputData.runMetadataPath);
      return { ...inputData, checksResultPath };
    },
  });

  const review = createStep({
    id: 'independent-review',
    inputSchema: handoffSchema,
    outputSchema: handoffSchema,
    execute: async ({ inputData }) => {
      const checksResult = await readJson(inputData.checksResultPath);
      let reviewResultPath;
      if (checksResult.status === 'PASS') {
        try {
          const result = await adapters.reviewer(adapterInput(inputData, {
            builderResultPath: inputData.builderResultPath,
            checksResultPath: inputData.checksResultPath,
          }));
          reviewResultPath = requireResultPath('reviewer', result);
        } catch (error) {
          const failed = await failedResult(inputData, 'reviewer', error);
          reviewResultPath = failed.resultPath;
          inputData = { ...inputData, stopReason: failed.reason };
        }
      } else {
        reviewResultPath = await writeJson(join(inputData.runDirectory, `review-${inputData.round}.json`), {
          verdict: 'FAIL', reason: checksResult.reason ?? 'checks did not pass',
          model: null, effort: null, inputTokens: 0, outputTokens: 0, costEstimateUsd: 0,
        });
      }
      await updateMetadata(inputData.runMetadataPath, { reviewResultPath, ...(inputData.stopReason ? { stopReason: inputData.stopReason } : {}) });
      await samplePeak(inputData.runMetadataPath);
      return { ...inputData, reviewResultPath };
    },
  });

  const round = createWorkflow({
    id: `${DELIVERY_WORKFLOW_ID}-round`,
    inputSchema: handoffSchema,
    outputSchema: handoffSchema,
  }).then(build).then(checks).then(review).commit();

  const notify = createStep({
    id: 'notify-technical-acceptance',
    inputSchema: handoffSchema,
    outputSchema: handoffSchema,
    execute: async ({ inputData }) => {
      const reviewResult = await readJson(inputData.reviewResultPath);
      if (reviewResult.verdict !== 'PASS') return inputData;
      let result;
      try {
        result = await adapters.notify(adapterInput(inputData, { reviewResultPath: inputData.reviewResultPath }));
      } catch (error) {
        const failed = await failedResult(inputData, 'notification', error);
        await updateMetadata(inputData.runMetadataPath, { noticeResultPath: failed.resultPath, stopReason: failed.reason });
        return { ...inputData, noticeResultPath: failed.resultPath, stopReason: failed.reason };
      }
      const noticeResultPath = requireResultPath('notification', result);
      await updateMetadata(inputData.runMetadataPath, { noticeResultPath });
      await samplePeak(inputData.runMetadataPath);
      return { ...inputData, noticeResultPath };
    },
  });

  const acceptance = createStep({
    id: 'technical-acceptance',
    inputSchema: handoffSchema,
    resumeSchema: z.object({ decision: z.enum(['accept', 'reject']), reason: z.string().optional() }),
    suspendSchema: z.object({ round: z.number().int(), reviewResultPath: pathSchema }),
    outputSchema: terminalSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      const reviewResult = await readJson(inputData.reviewResultPath);
      if (inputData.stopReason || reviewResult.verdict !== 'PASS') {
        return { ...inputData, outcome: 'parked', reason: inputData.stopReason ?? reviewResult.reason ?? 'three rounds ended without an accepted independent review' };
      }
      if (!resumeData) return suspend({ round: inputData.round, reviewResultPath: inputData.reviewResultPath });
      if (resumeData.decision === 'accept') return { ...inputData, outcome: 'accepted' };
      return { ...inputData, outcome: 'rejected', reason: resumeData.reason?.trim() || 'Todd rejected technical acceptance' };
    },
  });

  const summarize = createStep({
    id: 'permanent-summary',
    inputSchema: terminalSchema,
    outputSchema: workflowOutputSchema,
    execute: async ({ inputData }) => {
      const metadata = await updateMetadata(inputData.runMetadataPath, {
        peakMemoryBytes: await samplePeak(inputData.runMetadataPath), endTime: new Date().toISOString(),
      });
      const checksResult = await readJson(inputData.checksResultPath);
      const reviewResult = await readJson(inputData.reviewResultPath);
      const reviews = await Promise.all(Array.from({ length: inputData.round }, (_, index) => (
        readJson(join(inputData.runDirectory, `review-${index + 1}.json`))
      )));
      const total = field => reviews.every(review => Number.isFinite(review[field]))
        ? reviews.reduce((sum, review) => sum + review[field], 0)
        : 'unknown';
      const decision = inputData.outcome === 'accepted'
        ? 'verdict=ACCEPT'
        : `stop=${inputData.outcome === 'rejected' ? 'REJECT' : 'PARK'} reason=${JSON.stringify(inputData.reason ?? reviewResult.reason ?? 'unspecified')}`;
      const line = [
        `card=${metadata.card}`, `change=${checksResult.change ?? 'unknown'}`, `round=${inputData.round}`, decision,
        `reviewerModel=${reviewResult.model ?? 'unknown'}`, `reviewerEffort=${reviewResult.effort ?? 'unknown'}`,
        `inputTokens=${total('inputTokens')}`, `outputTokens=${total('outputTokens')}`,
        `costEstimateUsd=${total('costEstimateUsd')}`, `start=${metadata.startTime}`, `end=${metadata.endTime}`,
      ].join(' ');
      await appendPermanentSummaryLine(summaryPath, metadata.runId, line);
      await updateMetadata(inputData.runMetadataPath, { summaryWritten: true });
      return {
        outcome: inputData.outcome,
        ...(inputData.reason ? { reason: inputData.reason } : {}),
        round: inputData.round,
        summaryPath,
        peakMemoryBytes: metadata.peakMemoryBytes,
      };
    },
  });

  return createWorkflow({
    id: DELIVERY_WORKFLOW_ID,
    inputSchema: handoffSchema,
    outputSchema: workflowOutputSchema,
    options: { autoRestartActiveRuns: false },
  })
    .dountil(round, async ({ inputData }) => {
      const reviewResult = await readJson(inputData.reviewResultPath);
      return Boolean(inputData.stopReason) || reviewResult.verdict === 'PASS' || inputData.round >= MAX_ROUNDS;
    })
    .then(notify)
    .then(acceptance)
    .then(summarize)
    .commit();
}

export async function createDeliveryWorkflowRuntime({ storagePath, runDirectory, summaryPath, adapters }) {
  if (!storagePath || !runDirectory || !summaryPath) throw new Error('delivery workflow requires storage, run directory and summary paths');
  for (const name of ['builder', 'checks', 'reviewer', 'notify']) {
    if (typeof adapters?.[name] !== 'function') throw new Error(`delivery workflow requires the existing ${name} adapter`);
  }
  const absoluteStoragePath = resolve(storagePath).replaceAll('\\', '/');
  const storage = new LibSQLStore({
    id: 'julia-delivery-local', url: `file:${absoluteStoragePath}`,
    localPragmas: { mmapSize: 0 },
  });
  const trackers = new Map();
  const observePeak = metadataPath => {
    const tracker = trackers.get(metadataPath);
    const rss = process.memoryUsage().rss;
    if (tracker) tracker.peakMemoryBytes = Math.max(tracker.peakMemoryBytes, rss);
    return tracker?.peakMemoryBytes ?? rss;
  };
  const samplePeak = async metadataPath => observePeak(metadataPath);
  const beginMeasuring = async metadataPath => {
    const metadata = await readJson(metadataPath);
    const tracker = {
      peakMemoryBytes: Math.max(metadata.peakMemoryBytes ?? 0, process.memoryUsage().rss),
      sampler: null,
    };
    tracker.sampler = setInterval(() => observePeak(metadataPath), 10);
    tracker.sampler.unref();
    trackers.set(metadataPath, tracker);
    return async () => {
      observePeak(metadataPath);
      clearInterval(tracker.sampler);
      trackers.delete(metadataPath);
      await updateMetadata(metadataPath, { peakMemoryBytes: tracker.peakMemoryBytes });
      return tracker.peakMemoryBytes;
    };
  };
  const deliveryWorkflow = createDeliveryWorkflow(adapters, samplePeak, summaryPath);
  const mastra = new Mastra({ storage, workflows: { deliveryWorkflow } });
  const workflow = mastra.getWorkflow('deliveryWorkflow');

  const measurePause = async (runId, metadataPath) => {
    const measurementClient = createClient({ url: `file:${absoluteStoragePath}` });
    const measured = await measurementClient.execute({
      sql: 'SELECT length(snapshot) AS bytes FROM mastra_workflow_snapshot WHERE workflow_name = ? AND run_id = ?',
      args: [DELIVERY_WORKFLOW_ID, runId],
    });
    measurementClient.close();
    const pauseStateBytes = Number(measured.rows[0]?.bytes);
    if (!Number.isSafeInteger(pauseStateBytes) || pauseStateBytes <= 0) throw new Error('saved pause state size could not be measured');
    const metadata = await updateMetadata(metadataPath, { pauseStateBytes });
    return { pauseStateBytes, peakMemoryBytes: metadata.peakMemoryBytes };
  };

  const recordFailedRun = async (runId, metadataPath, failure) => {
    const fallback = { card: 'unknown', startTime: 'unknown', peakMemoryBytes: process.memoryUsage().rss, runId, round: 0 };
    let metadata;
    try { metadata = { ...fallback, ...await readJson(metadataPath) }; } catch { metadata = fallback; }
    if (metadata.summaryWritten) return;
    const endTime = new Date().toISOString();
    let checks = {}; let reviews = [];
    try { if (metadata.checksResultPath) checks = await readJson(metadata.checksResultPath); } catch { /* retain unknown */ }
    for (let round = 1; round <= (metadata.round ?? 0); round += 1) {
      try { reviews.push(await readJson(join(dirname(metadataPath), `review-${round}.json`))); } catch { /* incomplete round */ }
    }
    const lastReview = reviews.at(-1) ?? {};
    const total = field => reviews.length && reviews.every(review => Number.isFinite(review[field]))
      ? reviews.reduce((sum, review) => sum + review[field], 0)
      : 'unknown';
    const line = [
      `card=${metadata.card}`, `change=${checks.change ?? 'unknown'}`, `round=${metadata.round ?? 0}`,
      `stop=SYSTEM_ERROR reason=${JSON.stringify(errorMessage(failure))}`,
      `reviewerModel=${lastReview.model ?? 'unknown'}`, `reviewerEffort=${lastReview.effort ?? 'unknown'}`,
      `inputTokens=${total('inputTokens')}`, `outputTokens=${total('outputTokens')}`,
      `costEstimateUsd=${total('costEstimateUsd')}`, `start=${metadata.startTime}`, `end=${endTime}`,
    ].join(' ');
    await appendPermanentSummaryLine(summaryPath, runId, line);
    try { await updateMetadata(metadataPath, { endTime, summaryWritten: true }); } catch { /* summary is already permanent */ }
  };

  const complete = async (runId, metadataPath, operation) => {
    const finishMeasuring = await beginMeasuring(metadataPath);
    let result;
    try {
      result = await operation();
      if (result?.status === 'failed' || result?.status === 'tripwire') await recordFailedRun(runId, metadataPath, result.error ?? result.status);
    } catch (error) {
      await recordFailedRun(runId, metadataPath, error);
      throw error;
    } finally {
      const peakMemoryBytes = await finishMeasuring();
      if (result?.status === 'success' && result.result) result = { ...result, result: { ...result.result, peakMemoryBytes } };
    }
    return result;
  };

  return {
    async start({ runId, input }) {
      const metadataPath = join(input.runDirectory, `${runId}-workflow-metrics.json`);
      await writeJson(metadataPath, {
        card: input.card, runId,
        startTime: new Date().toISOString(),
        peakMemoryBytes: process.memoryUsage().rss,
        pauseStateBytes: null,
      });
      const run = await workflow.createRun({ runId });
      const result = await complete(runId, metadataPath, () => run.start({ inputData: {
        approvedInputPath: input.approvedInputPath,
        runDirectory: input.runDirectory,
        runMetadataPath: metadataPath,
        round: 0,
      } }));
      if (result.status !== 'suspended') return result;
      const measurements = await measurePause(runId, metadataPath);
      return { ...result, runId, outcome: 'awaiting-technical-acceptance', ...measurements };
    },
    async resume({ runId, decision, reason }) {
      const metadataPath = join(runDirectory, `${runId}-workflow-metrics.json`);
      const run = await workflow.createRun({ runId });
      return complete(runId, metadataPath, () => run.resume({ step: 'technical-acceptance', resumeData: { decision, ...(reason ? { reason } : {}) } }));
    },
    async close() {
      await mastra.getStorage().close();
    },
  };
}
