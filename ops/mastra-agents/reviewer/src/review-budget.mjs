import { durableWrite, withFileLock } from './run-file.mjs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

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
      && Number.isFinite(state.pending.maximumDurationMs) && Number.isFinite(state.pending.reservedAt)
      && typeof state.pending.reservationId === 'string' && state.pending.reservationId));
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
  const freshCard = { maxUsd: cardMaxUsd, spentUsd: 0, pending: null, responses: [] };
  const validCard = value => value?.maxUsd === cardMaxUsd
    && Number.isFinite(value.spentUsd) && value.spentUsd >= 0 && Array.isArray(value.responses) && value.responses.every(item => typeof item === 'string')
    && (value.pending === null || (Number.isFinite(value.pending.maximumCostUsd) && typeof value.pending.reservationId === 'string' && value.pending.reservationId));
  const save = () => durableWrite(path, `${JSON.stringify(state)}\n`);
  const withCard = operation => cardPath ? withFileLock(`${cardPath}.lock`, async () => {
    const card = await loadState(cardPath, freshCard, validCard);
    return operation(card, () => durableWrite(cardPath, `${JSON.stringify(card)}\n`));
  }) : operation(null, async () => {});
  await save();
  await withCard(async (card, saveCard) => { if (card) await saveCard(); });

  return {
    beforeRequest: async body => {
      if (state.pending) throw new Error('reviewer refused: saved budget has an unresolved paid request');
      const elapsedMs = now() - state.startedAt;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('reviewer refused: elapsed review time is invalid');
      if (elapsedMs + stepMs > totalMs) throw new Error(`reviewer refused: pending request would cross the ${totalMs / 60_000} minute limit`);
      const priced = maximumRequestCost(body);
      if (state.spentUsd + priced.maximumCostUsd > maxUsd) throw new Error(`reviewer refused: pending request would cross the $${maxUsd} limit`);
      const pending = { ...priced, maximumDurationMs: stepMs, reservedAt: now(), reservationId: randomUUID() };
      await withCard(async (card, saveCard) => {
        if (!card) return;
        if (card.pending) throw new Error('reviewer refused: card budget has an unresolved paid request');
        if (card.spentUsd + priced.maximumCostUsd > cardMaxUsd) throw new Error(`reviewer refused: pending request would cross the $${cardMaxUsd} cumulative card limit`);
        card.pending = { ...pending };
        await saveCard();
      });
      state.pending = pending;
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
      await withCard(async (card, saveCard) => {
        if (!card) return;
        if (card.pending?.reservationId !== state.pending.reservationId || card.responses.includes(responseId)
          || estimate.cost > card.pending.maximumCostUsd || card.spentUsd + estimate.cost > cardMaxUsd) {
          throw new Error('reviewer refused: returned usage does not match the cumulative card reservation');
        }
        card.spentUsd += estimate.cost;
        card.responses.push(responseId);
        card.pending = null;
        await saveCard();
      });
      state.spentUsd += estimate.cost;
      state.responses.push(responseId);
      state.pending = null;
      await save();
    },
  };
}
