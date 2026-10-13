import { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
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

function createDeliveryWorkflow(adapters, samplePeak, summaryPath) {
  const build = createStep({
    id: 'build',
    inputSchema: handoffSchema,
    outputSchema: handoffSchema,
    execute: async ({ inputData }) => {
      const round = inputData.round + 1;
      await samplePeak();
      const result = await adapters.builder(adapterInput({ ...inputData, round }, {
        priorReviewPath: inputData.reviewResultPath,
      }));
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
        const result = await adapters.checks(adapterInput(inputData, { builderResultPath: inputData.builderResultPath }));
        checksResultPath = requireResultPath('checks', result);
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
        const result = await adapters.reviewer(adapterInput(inputData, {
          builderResultPath: inputData.builderResultPath,
          checksResultPath: inputData.checksResultPath,
        }));
        reviewResultPath = requireResultPath('reviewer', result);
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
      const result = await adapters.notify(adapterInput(inputData, { reviewResultPath: inputData.reviewResultPath }));
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
      if (reviewResult.verdict !== 'PASS') {
        return { ...inputData, outcome: 'parked', reason: reviewResult.reason ?? 'three rounds ended without an accepted independent review' };
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
      const decision = inputData.outcome === 'accepted'
        ? 'verdict=ACCEPT'
        : `stop=${inputData.outcome === 'rejected' ? 'REJECT' : 'PARK'} reason=${JSON.stringify(inputData.reason ?? reviewResult.reason ?? 'unspecified')}`;
      const line = [
        `card=${metadata.card}`, `change=${checksResult.change ?? 'unknown'}`, `round=${inputData.round}`, decision,
        `reviewerModel=${reviewResult.model ?? 'unknown'}`, `reviewerEffort=${reviewResult.effort ?? 'unknown'}`,
        `inputTokens=${reviewResult.inputTokens ?? 'unknown'}`, `outputTokens=${reviewResult.outputTokens ?? 'unknown'}`,
        `costEstimateUsd=${reviewResult.costEstimateUsd ?? 'unknown'}`, `start=${metadata.startTime}`, `end=${metadata.endTime}`,
      ].join(' ');
      await appendFile(summaryPath, `${line}\n`);
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
      return reviewResult.verdict === 'PASS' || inputData.round >= MAX_ROUNDS;
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
    const rss = process.memoryUsage().rss;
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
    const workflowStore = await storage.getStore('workflows');
    const snapshot = await workflowStore.loadWorkflowSnapshot({ workflowName: DELIVERY_WORKFLOW_ID, runId });
    const pauseStateBytes = Buffer.byteLength(JSON.stringify(snapshot));
    const metadata = await updateMetadata(metadataPath, { pauseStateBytes, peakMemoryBytes: await samplePeak() });
    return { pauseStateBytes, peakMemoryBytes: metadata.peakMemoryBytes };
  };

  return {
    async start({ runId, input }) {
      metadataPath = join(input.runDirectory, `${runId}-workflow-metrics.json`);
      await writeJson(metadataPath, {
        card: input.card,
        startTime: new Date().toISOString(),
        peakMemoryBytes: process.memoryUsage().rss,
        pauseStateBytes: null,
      });
      const run = await workflow.createRun({ runId });
      const result = await run.start({ inputData: {
        approvedInputPath: input.approvedInputPath,
        runDirectory: input.runDirectory,
        runMetadataPath: metadataPath,
        round: 0,
      } });
      if (result.status !== 'suspended') return result;
      const measurements = await measurePause(runId);
      return { ...result, runId, outcome: 'awaiting-technical-acceptance', ...measurements };
    },
    async resume({ runId, decision, reason }) {
      metadataPath = join(runDirectory, `${runId}-workflow-metrics.json`);
      const run = await workflow.createRun({ runId });
      return run.resume({ step: 'technical-acceptance', resumeData: { decision, ...(reason ? { reason } : {}) } });
    },
    async close() {
      await mastra.getStorage().close();
    },
  };
}
