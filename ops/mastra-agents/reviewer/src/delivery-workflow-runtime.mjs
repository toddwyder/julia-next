import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { createClient } from '@libsql/client';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { DELIVERY_WORKFLOW_ID, appendPermanentSummaryLine, createDeliveryWorkflow } from './delivery-workflow.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => { await writeFile(path, `${JSON.stringify(value)}\n`); return path; };
const updateMetadata = async (path, update) => {
  const next = { ...await readJson(path), ...update };
  await writeJson(path, next);
  return next;
};
const errorMessage = error => typeof error?.message === 'string' ? error.message : String(error);

export async function createDeliveryWorkflowRuntime({ storagePath, runDirectory, summaryPath, adapters }) {
  if (!storagePath || !runDirectory || !summaryPath) throw new Error('delivery workflow requires storage, run directory and summary paths');
  for (const name of ['authorization', 'cardRead', 'builder', 'checks', 'reviewer', 'recoverCrash', 'waitingRecord', 'validateCandidate', 'recordAcceptance', 'park']) {
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
    for (const reviewPath of metadata.reviewResultPaths ?? []) {
      try { reviews.push(await readJson(reviewPath)); } catch { /* incomplete round */ }
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
    async inspect(runId) {
      const workflowStore = await mastra.getStorage().getStore('workflows');
      return workflowStore.loadWorkflowSnapshot({ runId, workflowName: DELIVERY_WORKFLOW_ID });
    },
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
        card: input.card,
        launchInputPath: input.launchInputPath,
        runDirectory: input.runDirectory,
        runMetadataPath: metadataPath,
      } }));
      if (result.status !== 'suspended') return result;
      const measurements = await measurePause(runId, metadataPath);
      return { ...result, runId, outcome: 'awaiting-technical-acceptance', ...measurements };
    },
    async resume({ runId, decision, reason }) {
      const metadataPath = join(runDirectory, `${runId}-workflow-metrics.json`);
      const metadata = await readJson(metadataPath);
      if (!metadata.checksResultPath) throw new Error('suspended workflow has no reviewed candidate');
      const checks = await readJson(metadata.checksResultPath);
      const candidateCommit = checks.candidateCommit ?? checks.change;
      if (typeof candidateCommit !== 'string' || !candidateCommit) throw new Error('suspended workflow has no candidate commit');
      const run = await workflow.createRun({ runId });
      const result = await complete(runId, metadataPath, () => run.resume({ resumeData: { decision, candidateCommit, ...(reason ? { reason } : {}) } }));
      if (result.status !== 'suspended') return result;
      const measurements = await measurePause(runId, metadataPath);
      return { ...result, runId, outcome: 'awaiting-technical-acceptance', ...measurements };
    },
    async close() {
      await mastra.getStorage().close();
    },
  };
}
