import { mkdir, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { directoryBytes, durableWrite, RUN_EVIDENCE_MAX_BYTES } from './run-file.mjs';

export const REVIEW_MIN_FREE_DISK_BYTES = 2 * 1024 * 1024 * 1024;
export const REVIEW_MAX_DISK_GROWTH_BYTES = 128 * 1024 * 1024;
export const REVIEW_MAX_RSS_BYTES = 768 * 1024 * 1024;
export const REVIEW_RSS_STEP_RESERVE_BYTES = 32 * 1024 * 1024;

export const reviewLimitForReason = reason => {
  if (/20 minute|elapsed/i.test(reason)) return 'elapsed';
  if (/\$0\.50|\$0\.5|cost|cumulative card limit/i.test(reason)) return 'cost';
  if (/evidence/i.test(reason)) return 'evidence';
  if (/memory/i.test(reason)) return 'memory';
  if (/disk-growth|free disk/i.test(reason)) return /free disk/i.test(reason) ? 'free-disk' : 'disk-growth';
  if (/max(?:imum)? steps?|step maximum|ended without a successful submit/i.test(reason)) return 'steps';
  return 'infrastructure';
};

export const recordReviewSystemError = async ({ terminalPath, progress, limit, reason, measured = {} }) => {
  const terminal = {
    state: 'SYSTEM_ERROR',
    reason,
    limit,
    progress: { acceptedPieces: [...progress()] },
    measured,
    recordedAt: new Date().toISOString(),
  };
  await durableWrite(terminalPath, `${JSON.stringify(terminal)}\n`, {
    root: dirname(terminalPath),
    maxBytes: RUN_EVIDENCE_MAX_BYTES,
  });
  return terminal;
};

export async function createReviewResourceBudget({
  runDirectory,
  terminalPath = join(runDirectory, 'terminal-state.json'),
  progress = () => [],
  measureFreeDiskBytes = async directory => {
    const filesystem = await statfs(directory);
    return filesystem.bavail * filesystem.bsize;
  },
  measureDirectoryBytes = directoryBytes,
  measureRssBytes = () => process.memoryUsage().rss,
} = {}) {
  if (!runDirectory) throw new Error('review resource budget needs a run folder');
  await mkdir(runDirectory, { recursive: true });
  const baselineDiskBytes = await measureDirectoryBytes(runDirectory);
  const freeDiskBytes = await measureFreeDiskBytes(runDirectory);
  if (!Number.isFinite(freeDiskBytes) || freeDiskBytes < REVIEW_MIN_FREE_DISK_BYTES) {
    const reason = 'reviewer refused: preflight requires at least 2 GiB free disk';
    await recordReviewSystemError({ terminalPath, progress, limit: 'free-disk', reason, measured: { freeDiskBytes } });
    throw new Error(reason);
  }
  const initialRssBytes = measureRssBytes();
  if (!Number.isFinite(initialRssBytes) || initialRssBytes < 0) throw new Error('reviewer refused: initial memory measurement is invalid');
  let peakRssBytes = initialRssBytes;
  let peakRssStepIncreaseBytes = 0;
  let peakDiskGrowthBytes = 0;
  let peakProviderStepMs = 0;
  let peakAgentStepMs = 0;
  let agentStep = null;
  let memoryLimitError = null;
  const observeRss = () => {
    const rssBytes = measureRssBytes();
    if (!Number.isFinite(rssBytes) || rssBytes < 0) return null;
    peakRssBytes = Math.max(peakRssBytes, rssBytes);
    if (agentStep) {
      agentStep.peakRssBytes = Math.max(agentStep.peakRssBytes, rssBytes);
      if (rssBytes + REVIEW_RSS_STEP_RESERVE_BYTES > REVIEW_MAX_RSS_BYTES && !memoryLimitError) {
        memoryLimitError = new Error('reviewer refused: sampled memory reached the 736 MiB guard before the 768 MiB ceiling');
        agentStep.abortController.abort(memoryLimitError);
      }
    }
    return rssBytes;
  };
  const finishAgentStep = () => {
    if (!agentStep) return;
    observeRss();
    clearInterval(agentStep.memorySampler);
    peakAgentStepMs = Math.max(peakAgentStepMs, performance.now() - agentStep.startedAt);
    peakRssStepIncreaseBytes = Math.max(peakRssStepIncreaseBytes, Math.max(0, agentStep.peakRssBytes - agentStep.initialRssBytes));
    agentStep = null;
  };
  const beginAgentStep = () => {
    finishAgentStep();
    if (memoryLimitError) throw memoryLimitError;
    const initialStepRssBytes = observeRss();
    if (initialStepRssBytes === null) throw new Error('reviewer refused: resource measurement is invalid');
    const abortController = new AbortController();
    agentStep = {
      startedAt: performance.now(),
      initialRssBytes: initialStepRssBytes,
      peakRssBytes: initialStepRssBytes,
      abortController,
      memorySampler: setInterval(observeRss, 10),
    };
    agentStep.memorySampler.unref();
    return abortController.signal;
  };
  const assertWithinLimits = () => {
    if (memoryLimitError) throw memoryLimitError;
  };
  const sample = async () => {
    const rssBytes = observeRss();
    const currentDiskBytes = await measureDirectoryBytes(runDirectory);
    const diskGrowthBytes = Math.max(0, currentDiskBytes - baselineDiskBytes);
    if (rssBytes === null || !Number.isFinite(diskGrowthBytes)) {
      const reason = 'reviewer refused: resource measurement is invalid';
      await recordReviewSystemError({ terminalPath, progress, limit: 'resource-measurement', reason, measured: { rssBytes, diskGrowthBytes } });
      throw new Error(reason);
    }
    peakDiskGrowthBytes = Math.max(peakDiskGrowthBytes, diskGrowthBytes);
    return { rssBytes, diskGrowthBytes };
  };
  const beforeDispatch = async () => {
    const measured = await sample();
    if (measured.rssBytes + REVIEW_RSS_STEP_RESERVE_BYTES > REVIEW_MAX_RSS_BYTES) {
      const reason = 'reviewer refused: peak memory reservation would cross 768 MiB';
      await recordReviewSystemError({ terminalPath, progress, limit: 'memory', reason, measured: { ...measured, reservedRssBytes: REVIEW_RSS_STEP_RESERVE_BYTES } });
      throw new Error(reason);
    }
    if (measured.diskGrowthBytes + RUN_EVIDENCE_MAX_BYTES > REVIEW_MAX_DISK_GROWTH_BYTES) {
      const reason = 'reviewer refused: disk-growth reservation would cross 128 MiB';
      await recordReviewSystemError({ terminalPath, progress, limit: 'disk-growth', reason, measured: { ...measured, reservedAtomicWriteBytes: RUN_EVIDENCE_MAX_BYTES } });
      throw new Error(reason);
    }
    return measured;
  };
  const summary = async () => {
    await sample();
    return {
      freeDiskBytes, baselineDiskBytes, initialRssBytes, peakRssBytes, peakRssStepIncreaseBytes,
      rssStepReserveBytes: REVIEW_RSS_STEP_RESERVE_BYTES, peakDiskGrowthBytes, peakProviderStepMs, peakAgentStepMs,
    };
  };
  const recordProviderStep = durationMs => {
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('reviewer refused: provider step duration is invalid');
    peakProviderStepMs = Math.max(peakProviderStepMs, durationMs);
  };
  return { beforeDispatch, beginAgentStep, finishAgentStep, assertWithinLimits, sample, recordProviderStep, summary };
}
