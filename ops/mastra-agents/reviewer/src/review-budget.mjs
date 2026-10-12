import { durableWrite } from './run-file.mjs';
import { readFile } from 'node:fs/promises';

const MAX_OUTPUT_TOKENS = 4096;
const TOTAL_MS = 20 * 60 * 1000;
const STEP_MS = 2 * 60 * 1000;
const PEAK_INPUT_PER_MILLION = 0.30;
const PEAK_OUTPUT_PER_MILLION = 1.20;

const maximumRequestCost = body => {
  const maximumInputTokens = Buffer.byteLength(JSON.stringify(body), 'utf8');
  return {
    maximumInputTokens,
    maximumOutputTokens: MAX_OUTPUT_TOKENS,
    maximumCostUsd: (maximumInputTokens * PEAK_INPUT_PER_MILLION + MAX_OUTPUT_TOKENS * PEAK_OUTPUT_PER_MILLION) / 1_000_000,
  };
};

export async function createReviewBudget({
  path,
  maxUsd = 0.50,
  totalMs = TOTAL_MS,
  stepMs = STEP_MS,
  maximumOutputTokens = MAX_OUTPUT_TOKENS,
  startedAt = Date.now(),
  now = Date.now,
}) {
  if (!path) throw new Error('review budget needs a run-file path');
  if (maximumOutputTokens !== MAX_OUTPUT_TOKENS) throw new Error('review budget must match the 4096-token generation ceiling');
  let state;
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
    if (state.maxUsd !== maxUsd || state.totalMs !== totalMs || state.stepMs !== stepMs) {
      throw new Error('reviewer refused: saved budget does not match the authorized limits');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    state = { startedAt, maxUsd, totalMs, stepMs, spentUsd: 0, pending: null, responses: [] };
  }
  const save = () => durableWrite(path, `${JSON.stringify(state)}\n`);
  await save();

  return {
    beforeRequest: async body => {
      if (state.pending) throw new Error('reviewer refused: saved budget has an unresolved paid request');
      const elapsedMs = now() - state.startedAt;
      if (elapsedMs + stepMs > totalMs) throw new Error(`reviewer refused: pending request would cross the ${totalMs / 60_000} minute limit`);
      const priced = maximumRequestCost(body);
      if (state.spentUsd + priced.maximumCostUsd > maxUsd) throw new Error(`reviewer refused: pending request would cross the $${maxUsd} limit`);
      state.pending = { ...priced, maximumDurationMs: stepMs, reservedAt: now() };
      await save();
      return state.pending;
    },
    recordResponse: async ({ responseId, estimate }) => {
      if (!state.pending) throw new Error('reviewer refused: response arrived without a pending reservation');
      if (typeof responseId !== 'string' || !responseId || !Number.isFinite(estimate?.cost) || estimate.cost < 0) {
        throw new Error('reviewer refused: response cost evidence is missing or unknown');
      }
      if (state.responses.includes(responseId)) throw new Error(`reviewer refused: duplicate response ${responseId}`);
      state.spentUsd += estimate.cost;
      state.responses.push(responseId);
      state.pending = null;
      await save();
    },
  };
}
