import { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { createClient } from '@libsql/client';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
      await samplePeak();
      let result;
      try {
        result = await adapters.builder(adapterInput({ ...inputData, round }, {
          priorReviewPath: inputData.reviewResultPath,
        }));
      } catch (error) {
        const failed = await failedResult({ ...inputData, round }, 'builder', error);
        return { ...inputData, round, builderResultPath: failed.resultPath, stopReason: failed.reason };
      }
      await samplePeak();
      return {
        approvedInputPath: inputData.approvedInputPath,
        runDirectory: inputData.runDirectory,
        runMetadataPath: inputData.runMetadataPath,
        round,
        builderResultPath: requireResultPath('builder', result),
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
      await samplePeak();
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
      await samplePeak();
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
        return { ...inputData, noticeResultPath: failed.resultPath, stopReason: failed.reason };
      }
      await samplePeak();
      return { ...inputData, noticeResultPath: requireResultPath('notification', result) };
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
        peakMemoryBytes: await samplePeak(), endTime: new Date().toISOString(),
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
      await appendFile(summaryPath, `${line}\n`);
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
  let metadataPath = null;
  const samplePeak = async () => {
    const rss = process.resourceUsage().maxRSS * 1024;
    if (!metadataPath) return rss;
    const metadata = await readJson(metadataPath);
    const peakMemoryBytes = Math.max(metadata.peakMemoryBytes ?? 0, rss);
    if (peakMemoryBytes !== metadata.peakMemoryBytes) await writeJson(metadataPath, { ...metadata, peakMemoryBytes });
    return peakMemoryBytes;
  };
  const deliveryWorkflow = createDeliveryWorkflow(adapters, samplePeak, summaryPath);
  const mastra = new Mastra({ storage, workflows: { deliveryWorkflow } });
  const workflow = mastra.getWorkflow('deliveryWorkflow');

  const measurePause = async runId => {
    const measurementClient = createClient({ url: `file:${absoluteStoragePath}` });
    const measured = await measurementClient.execute({
      sql: 'SELECT length(snapshot) AS bytes FROM mastra_workflow_snapshot WHERE workflow_name = ? AND run_id = ?',
      args: [DELIVERY_WORKFLOW_ID, runId],
    });
    measurementClient.close();
    const pauseStateBytes = Number(measured.rows[0]?.bytes);
    if (!Number.isSafeInteger(pauseStateBytes) || pauseStateBytes <= 0) throw new Error('saved pause state size could not be measured');
    const metadata = await updateMetadata(metadataPath, { pauseStateBytes, peakMemoryBytes: await samplePeak() });
    return { pauseStateBytes, peakMemoryBytes: metadata.peakMemoryBytes };
  };

  const recordFailedRun = async (runId, failure) => {
    const fallback = { card: 'unknown', startTime: 'unknown', peakMemoryBytes: await samplePeak(), runId };
    let metadata;
    try { metadata = { ...fallback, ...await readJson(metadataPath) }; } catch { metadata = fallback; }
    if (metadata.summaryWritten) return;
    const endTime = new Date().toISOString();
    const line = [
      `card=${metadata.card}`, 'change=unknown', 'round=0',
      `stop=SYSTEM_ERROR reason=${JSON.stringify(errorMessage(failure))}`,
      'reviewerModel=unknown', 'reviewerEffort=unknown', 'inputTokens=unknown',
      'outputTokens=unknown', 'costEstimateUsd=unknown', `start=${metadata.startTime}`, `end=${endTime}`,
    ].join(' ');
    await appendFile(summaryPath, `${line}\n`);
    try { await updateMetadata(metadataPath, { endTime, peakMemoryBytes: await samplePeak(), summaryWritten: true }); } catch { /* summary is already permanent */ }
  };

  const complete = async (runId, operation) => {
    try {
      const result = await operation();
      if (result?.status === 'failed' || result?.status === 'tripwire') await recordFailedRun(runId, result.error ?? result.status);
      return result;
    } catch (error) {
      await recordFailedRun(runId, error);
      throw error;
    }
  };

  return {
    async start({ runId, input }) {
      metadataPath = join(input.runDirectory, `${runId}-workflow-metrics.json`);
      await writeJson(metadataPath, {
        card: input.card, runId,
        startTime: new Date().toISOString(),
        peakMemoryBytes: process.memoryUsage().rss,
        pauseStateBytes: null,
      });
      const run = await workflow.createRun({ runId });
      const result = await complete(runId, () => run.start({ inputData: {
        approvedInputPath: input.approvedInputPath,
        runDirectory: input.runDirectory,
        runMetadataPath: metadataPath,
        round: 0,
      } }));
      if (result.status !== 'suspended') return result;
      const measurements = await measurePause(runId);
      return { ...result, runId, outcome: 'awaiting-technical-acceptance', ...measurements };
    },
    async resume({ runId, decision, reason }) {
      metadataPath = join(runDirectory, `${runId}-workflow-metrics.json`);
      const run = await workflow.createRun({ runId });
      return complete(runId, () => run.resume({ step: 'technical-acceptance', resumeData: { decision, ...(reason ? { reason } : {}) } }));
    },
    async close() {
      await mastra.getStorage().close();
    },
  };
}
