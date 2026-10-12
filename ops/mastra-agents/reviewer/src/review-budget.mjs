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

function validState(state, limits) {
  return state && Number.isFinite(state.startedAt) && Number.isFinite(state.spentUsd) && state.spentUsd >= 0
    && state.maxUsd === limits.maxUsd && state.totalMs === limits.totalMs && state.stepMs === limits.stepMs
    && Array.isArray(state.responses) && state.responses.every(value => typeof value === 'string')
    && (state.pending === null || (Number.isFinite(state.pending.maximumCostUsd) && state.pending.maximumCostUsd >= 0
      && Number.isFinite(state.pending.maximumDurationMs) && Number.isFinite(state.pending.reservedAt)));
}

async function loadState(path, fresh, validate) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (!validate(state)) throw new Error('reviewer refused: saved budget is invalid or does not match the authorized limits');
    return state;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return fresh;
  }
}

export async function createReviewBudget({
  path,
  maxUsd = 0.50,
  totalMs = TOTAL_MS,
  stepMs = STEP_MS,
  maximumOutputTokens = MAX_OUTPUT_TOKENS,
  cardPath = null,
  cardMaxUsd = 1,
  startedAt = Date.now(),
  now = Date.now,
}) {
  if (!path) throw new Error('review budget needs a run-file path');
  if (maximumOutputTokens !== MAX_OUTPUT_TOKENS) throw new Error('review budget must match the 4096-token generation ceiling');
  const limits = { maxUsd, totalMs, stepMs };
  let state = await loadState(path, { startedAt, ...limits, spentUsd: 0, pending: null, responses: [] }, value => validState(value, limits));
  let card = cardPath ? await loadState(cardPath, { maxUsd: cardMaxUsd, spentUsd: 0, pending: null, responses: [] }, value => value?.maxUsd === cardMaxUsd
    && Number.isFinite(value.spentUsd) && value.spentUsd >= 0 && Array.isArray(value.responses) && value.responses.every(item => typeof item === 'string')
    && (value.pending === null || Number.isFinite(value.pending.maximumCostUsd))) : null;
  const save = () => durableWrite(path, `${JSON.stringify(state)}\n`);
  const saveCard = () => cardPath ? durableWrite(cardPath, `${JSON.stringify(card)}\n`) : Promise.resolve();
  await save();
  await saveCard();

  return {
    beforeRequest: async body => {
      if (state.pending) throw new Error('reviewer refused: saved budget has an unresolved paid request');
      if (card?.pending) throw new Error('reviewer refused: card budget has an unresolved paid request');
      const elapsedMs = now() - state.startedAt;
      if (elapsedMs + stepMs > totalMs) throw new Error(`reviewer refused: pending request would cross the ${totalMs / 60_000} minute limit`);
      const priced = maximumRequestCost(body);
      if (state.spentUsd + priced.maximumCostUsd > maxUsd) throw new Error(`reviewer refused: pending request would cross the $${maxUsd} limit`);
      if (card && card.spentUsd + priced.maximumCostUsd > cardMaxUsd) throw new Error(`reviewer refused: pending request would cross the $${cardMaxUsd} cumulative card limit`);
      state.pending = { ...priced, maximumDurationMs: stepMs, reservedAt: now() };
      if (card) card.pending = { ...state.pending };
      await saveCard();
      await save();
      return state.pending;
    },
    recordResponse: async ({ responseId, estimate }) => {
      if (!state.pending) throw new Error('reviewer refused: response arrived without a pending reservation');
      if (typeof responseId !== 'string' || !responseId || !Number.isFinite(estimate?.cost) || estimate.cost < 0) {
        throw new Error('reviewer refused: response cost evidence is missing or unknown');
      }
      if (state.responses.includes(responseId)) throw new Error(`reviewer refused: duplicate response ${responseId}`);
      if (estimate.cost > state.pending.maximumCostUsd || state.spentUsd + estimate.cost > maxUsd) {
        throw new Error('reviewer refused: returned usage exceeds the reserved or authorized cost');
      }
      if (card && (card.responses.includes(responseId) || estimate.cost > card.pending?.maximumCostUsd || card.spentUsd + estimate.cost > cardMaxUsd)) {
        throw new Error('reviewer refused: returned usage exceeds the cumulative card reservation');
      }
      state.spentUsd += estimate.cost;
      state.responses.push(responseId);
      state.pending = null;
      if (card) {
        card.spentUsd += estimate.cost;
        card.responses.push(responseId);
        card.pending = null;
        await saveCard();
      }
      await save();
    },
  };
}
