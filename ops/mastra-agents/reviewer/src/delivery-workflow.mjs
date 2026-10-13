import { createStep, createWorkflow } from '@mastra/core/workflows';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod/v4';

export const DELIVERY_WORKFLOW_ID = 'julia-delivery';
const MAX_ROUNDS = 2;
const pathSchema = z.string().min(1);
const launchSchema = z.object({
  card: z.string().min(1),
  launchInputPath: pathSchema,
  runDirectory: pathSchema,
  runMetadataPath: pathSchema,
});
const authorizedSchema = z.object({ ...launchSchema.shape, authorizationResultPath: pathSchema });
const handoffSchema = z.object({
  launchInputPath: pathSchema,
  authorizationResultPath: pathSchema,
  approvedInputPath: pathSchema,
  runDirectory: pathSchema,
  runMetadataPath: pathSchema,
  round: z.number().int().min(0).max(MAX_ROUNDS),
  builderResultPath: pathSchema.optional(),
  checksResultPath: pathSchema.optional(),
  reviewResultPath: pathSchema.optional(),
  priorReviewPath: pathSchema.optional(),
  waitingRecordPath: pathSchema.optional(),
  parkResultPath: pathSchema.optional(),
  acceptanceResultPath: pathSchema.optional(),
  rerunCandidate: z.boolean().optional(),
  cycle: z.number().int().min(1).optional(),
  stopReason: z.string().optional(),
});
const terminalSchema = z.object({
  ...handoffSchema.shape,
  outcome: z.enum(['accepted', 'rejected', 'parked', 'stale']),
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
    cycle: inputData.cycle,
    runDirectory: inputData.runDirectory,
    launchInputPath: inputData.launchInputPath,
    approvedInputPath: inputData.approvedInputPath,
    priorReviewPath: inputData.priorReviewPath,
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
  const fileRole = role === 'reviewer' ? 'review' : role;
  const resultPath = await writeJson(join(inputData.runDirectory, `${fileRole}-${inputData.round}.json`), {
    status: 'FAIL', verdict: 'FAIL', reason,
    model: null, effort: null, inputTokens: 0, outputTokens: 0, costEstimateUsd: 0,
  });
  return { resultPath, reason };
}

export function createDeliveryWorkflow(adapters, samplePeak, summaryPath) {
  const authorize = createStep({
    id: 'authorization-check',
    inputSchema: launchSchema,
    outputSchema: authorizedSchema,
    execute: async ({ inputData }) => {
      const resultPath = requireResultPath('authorization', await adapters.authorization({
        launchInputPath: inputData.launchInputPath, runDirectory: inputData.runDirectory,
      }));
      const result = await readJson(resultPath);
      if (result.status !== 'PASS') throw new Error(result.reason ?? 'delivery authorization was refused');
      return { ...inputData, authorizationResultPath: resultPath };
    },
  });

  const readCard = createStep({
    id: 'read-linear-card-once',
    inputSchema: authorizedSchema,
    outputSchema: handoffSchema,
    execute: async ({ inputData }) => {
      const approvedInputPath = requireResultPath('card read', await adapters.cardRead({
        launchInputPath: inputData.launchInputPath,
        authorizationResultPath: inputData.authorizationResultPath,
        runDirectory: inputData.runDirectory,
      }));
      return { ...inputData, approvedInputPath, round: 0, cycle: 1 };
    },
  });

  const build = createStep({
    id: 'build',
    inputSchema: handoffSchema,
    outputSchema: handoffSchema,
    execute: async ({ inputData }) => {
      if (inputData.rerunCandidate) {
        return { ...inputData, rerunCandidate: false, stopReason: undefined, priorReviewPath: undefined };
      }
      const round = inputData.round + 1;
      const priorReviewPath = inputData.reviewResultPath;
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
        launchInputPath: inputData.launchInputPath,
        authorizationResultPath: inputData.authorizationResultPath,
        approvedInputPath: inputData.approvedInputPath,
        runDirectory: inputData.runDirectory,
        runMetadataPath: inputData.runMetadataPath,
        round,
        builderResultPath,
        ...(priorReviewPath ? { priorReviewPath } : {}),
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
      const metadata = await readJson(inputData.runMetadataPath);
      await updateMetadata(inputData.runMetadataPath, {
        reviewResultPath,
        reviewResultPaths: [...(metadata.reviewResultPaths ?? []), reviewResultPath],
        ...(inputData.stopReason ? { stopReason: inputData.stopReason } : {}),
      });
      await samplePeak(inputData.runMetadataPath);
      return { ...inputData, reviewResultPath };
    },
  });

  const round = createWorkflow({
    id: `${DELIVERY_WORKFLOW_ID}-round`,
    inputSchema: handoffSchema,
    outputSchema: handoffSchema,
  }).then(build).then(checks).then(review).commit();

  const waitingRecord = createStep({
    id: 'write-waiting-record',
    inputSchema: handoffSchema,
    outputSchema: terminalSchema,
    execute: async ({ inputData }) => {
      const reviewResult = await readJson(inputData.reviewResultPath);
      if (inputData.stopReason || reviewResult.verdict !== 'PASS') {
        const reason = inputData.stopReason ?? reviewResult.reason ?? 'two rounds ended without an accepted independent review';
        let parkResultPath;
        try {
          parkResultPath = requireResultPath('park', await adapters.park(adapterInput(inputData, { reviewResultPath: inputData.reviewResultPath })));
        } catch (error) {
          const failed = await failedResult(inputData, 'park', error);
          parkResultPath = failed.resultPath;
        }
        await updateMetadata(inputData.runMetadataPath, { parkResultPath, stopReason: reason });
        return { ...inputData, parkResultPath, outcome: 'parked', reason };
      }
      let result;
      try {
        result = await adapters.waitingRecord(adapterInput(inputData, {
          builderResultPath: inputData.builderResultPath,
          checksResultPath: inputData.checksResultPath,
          reviewResultPath: inputData.reviewResultPath,
        }));
      } catch (error) {
        const failed = await failedResult(inputData, 'waiting-record', error);
        await updateMetadata(inputData.runMetadataPath, { waitingRecordPath: failed.resultPath, stopReason: failed.reason });
        return { ...inputData, waitingRecordPath: failed.resultPath, outcome: 'parked', reason: failed.reason };
      }
      const waitingRecordPath = requireResultPath('waiting record', result);
      await updateMetadata(inputData.runMetadataPath, { waitingRecordPath });
      await samplePeak(inputData.runMetadataPath);
      return { ...inputData, waitingRecordPath, outcome: 'stale' };
    },
  });

  const acceptance = createStep({
    id: 'technical-acceptance',
    inputSchema: terminalSchema,
    resumeSchema: z.object({ decision: z.enum(['accept', 'reject']), candidateCommit: z.string().min(1), reason: z.string().optional() }),
    suspendSchema: z.object({ round: z.number().int(), reviewResultPath: pathSchema }),
    outputSchema: terminalSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      const reviewResult = await readJson(inputData.reviewResultPath);
      if (inputData.outcome === 'parked') return inputData;
      if (!resumeData) return suspend({ round: inputData.round, reviewResultPath: inputData.reviewResultPath });
      const checksResult = await readJson(inputData.checksResultPath);
      const reviewedCommit = checksResult.candidateCommit ?? checksResult.change;
      // Mastra carries resume data through the enclosing do-until iteration.
      // A decision bound to the stale candidate must not auto-accept or reject
      // the newly reviewed candidate in the next iteration.
      if (resumeData.candidateCommit !== reviewedCommit) {
        return suspend({ round: inputData.round, reviewResultPath: inputData.reviewResultPath });
      }
      if (resumeData.decision === 'accept') {
        const validation = await adapters.validateCandidate(adapterInput(inputData, {
          checksResultPath: inputData.checksResultPath,
          reviewResultPath: inputData.reviewResultPath,
        }));
        if (validation?.status !== 'PASS') {
          const reason = validation?.reason ?? 'reviewed candidate changed';
          if (inputData.round >= MAX_ROUNDS) {
            const parkResultPath = requireResultPath('park', await adapters.park(adapterInput(inputData, {
              reviewResultPath: inputData.reviewResultPath,
            })));
            await updateMetadata(inputData.runMetadataPath, { parkResultPath, stopReason: reason });
            return { ...inputData, parkResultPath, outcome: 'parked', reason };
          }
          const round = inputData.round + 1;
          await updateMetadata(inputData.runMetadataPath, { round, stopReason: reason });
          return { ...inputData, round, outcome: 'stale', reason, rerunCandidate: true, cycle: (inputData.cycle ?? 1) + 1 };
        }
        const acceptanceResultPath = requireResultPath('acceptance', await adapters.recordAcceptance(adapterInput(inputData, {
          checksResultPath: inputData.checksResultPath,
          reviewResultPath: inputData.reviewResultPath,
        })));
        return { ...inputData, acceptanceResultPath, outcome: 'accepted', reason: undefined };
      }
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
      const reviews = await Promise.all((metadata.reviewResultPaths ?? [inputData.reviewResultPath]).map(readJson));
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

  const reviewCycle = createWorkflow({
    id: `${DELIVERY_WORKFLOW_ID}-cycle`,
    inputSchema: handoffSchema,
    outputSchema: terminalSchema,
  })
    .dountil(round, async ({ inputData }) => {
      const reviewResult = await readJson(inputData.reviewResultPath);
      return Boolean(inputData.stopReason) || reviewResult.verdict === 'PASS' || inputData.round >= MAX_ROUNDS;
    })
    .then(waitingRecord)
    .then(acceptance)
    .commit();

  return createWorkflow({
    id: DELIVERY_WORKFLOW_ID,
    inputSchema: launchSchema,
    outputSchema: workflowOutputSchema,
    options: { autoRestartActiveRuns: false },
  })
    .then(authorize)
    .then(readCard)
    .dountil(reviewCycle, async ({ inputData }) => inputData.outcome !== 'stale')
    .then(summarize)
    .commit();
}
