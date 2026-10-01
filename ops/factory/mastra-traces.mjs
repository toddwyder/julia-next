// mastra-traces.mjs -- issue #180: read Factory's trace costs and token
// details through Mastra's observability API and price them with the single-source
// price table.
//
// The supported surfaces:
//   1. Factory internal route: GET <factory>/julia/observability/traces (requiresAuth: false)
//   2. Pinned Mastra route:   GET <factory>/api/observability/traces
//
// Token breakdown:
//   - fresh input tokens: input - cached
//   - cached input tokens: cachedInputTokens / inputDetails.cacheRead
//   - output tokens: outputTokens (includes thinking / reasoning tokens)
//   - thinking tokens: reasoningTokens / outputDetails.reasoning
//
// Priced using ops/factory/price-table.mjs in what-you-pay dollars.
// Named gaps:
//   - no_token_count (when a model span lacks usage/tokens)
//   - unpriced_model (when a model is not listed in price table)

import { calculateModelCost, getModelPrice } from './price-table.mjs';

/** Internal authenticated/unauthenticated localhost route. */
export const MASTRA_INTERNAL_TRACE_ROUTE = '/julia/observability/traces';

/** The observability route the pinned `mastra api trace list` command calls. */
export const MASTRA_TRACE_ROUTE = '/api/observability/traces';

const PAGE_SIZE = 25;
const MAX_PAGES = 500;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read the trace spans for `[from, to)` through the supported route.
 * Attempts the internal `/julia/observability/traces` route first; falls back
 * to `/api/observability/traces` if 404 or unsupported.
 *
 * @returns {Promise<Array<object>>} raw span records as the store returned them
 */
export async function readTraceSpans({ factoryUrl, from, to, fetchImpl = fetch, pageSize = PAGE_SIZE }) {
  const base = factoryUrl.replace(/\/$/, '');
  const candidateRoutes = [MASTRA_INTERNAL_TRACE_ROUTE, MASTRA_TRACE_ROUTE];

  for (let r = 0; r < candidateRoutes.length; r += 1) {
    const route = candidateRoutes[r];
    const isLastRoute = r === candidateRoutes.length - 1;

    try {
      const collected = [];
      let routeAccepted = false;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL(`${base}${route}`);
        url.searchParams.set('startedAt', JSON.stringify({ start: from, end: to, startExclusive: false, endExclusive: true }));
        url.searchParams.set('pagination', JSON.stringify({ page, perPage: pageSize }));

        const response = await fetchImpl(url.toString(), { method: 'GET' });
        if (!response.ok) {
          if (response.status === 404 && !isLastRoute && page === 0) {
            // Route not found, try fallback
            break;
          }
          throw new Error(`Mastra trace list returned HTTP ${response.status}`);
        }

        const body = await response.json();
        if (!isObject(body) || !Array.isArray(body.spans)) {
          throw new Error(
            'Mastra trace list response did not include a spans array; refusing to read cost from an unsupported shape',
          );
        }

        routeAccepted = true;
        collected.push(...body.spans);

        const pagination = body.pagination;
        if (!isObject(pagination) || typeof pagination.hasMore !== 'boolean' || pagination.page !== page) {
          throw new Error('Mastra trace list returned an unusable pagination object');
        }
        if (!pagination.hasMore) return collected;
        if (body.spans.length === 0 || page === MAX_PAGES - 1) {
          throw new Error('Mastra trace list pagination was incomplete; refusing a partial cost report');
        }
      }

      if (routeAccepted) {
        return collected;
      }
    } catch (err) {
      throw err;
    }
  }

  throw new Error('Mastra trace list exceeded pagination limit; refusing a partial cost report');
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Factory's working phases, so a trace reads as "plan" / "build" / "review". */
const PHASE_BY_STAGE = {
  triage: 'triage',
  planning: 'plan',
  execute: 'build',
  review: 'review',
};

/**
 * Map a span's name/entity onto a Factory phase.
 */
function spanPhase(span) {
  const haystack = `${span.name ?? ''} ${span.entityName ?? ''} ${span.metadata?.factory_stage ?? ''}`.toLowerCase();
  for (const [stage, phase] of Object.entries(PHASE_BY_STAGE)) {
    if (haystack.includes(stage) || haystack.includes(phase)) return phase;
  }
  if (haystack.includes('plan')) return 'plan';
  if (haystack.includes('review')) return 'review';
  return 'build';
}

/**
 * The span types Mastra bills.
 */
const MODEL_SPAN_TYPES = new Set(['model_generation', 'model_step', 'model_inference']);

/**
 * Is this span one that should carry a cost?
 */
function isCostBearing(span) {
  const type = span.spanType ?? span.type;
  if (typeof type === 'string' && MODEL_SPAN_TYPES.has(type)) return true;
  const attributes = isObject(span.attributes) ? span.attributes : {};
  return isObject(attributes.costContext) || isObject(attributes.usage);
}

function failedOutcome(span) {
  if (span.error !== undefined && span.error !== null) return 'failed-attempt';
  const status = typeof span.status === 'string' ? span.status.toLowerCase() : '';
  if (status === 'error' || status === 'failed') return 'failed-attempt';
  return null;
}

/**
 * Normalise raw spans into the records the note builds on.
 *
 * @param {Array<object>} spans
 * @param {{cards?: Array<{number: number, sessions?: Record<string, unknown>}>}} options
 */
export function normalizeTraceSpans(spans = [], { cards = [] } = {}) {
  const cardBySession = new Map();
  for (const card of cards) {
    for (const sessionId of Object.keys(card.sessions ?? {})) {
      cardBySession.set(sessionId, card.number);
    }
  }

  return spans.map((span) => {
    const sessionId = span.sessionId ?? span.scope?.sessionId ?? span.metadata?.sessionId ?? null;
    const card = sessionId !== null ? cardBySession.get(sessionId) ?? null : null;
    const attributes = isObject(span.attributes) ? span.attributes : {};
    const costContext = isObject(attributes.costContext) ? attributes.costContext : {};
    const usage = isObject(attributes.usage) ? attributes.usage : null;

    const model = attributes.model ?? attributes.responseModel ?? costContext.model ?? null;
    const provider = attributes.provider ?? costContext.provider ?? (model ? getModelPrice(model)?.provider : null) ?? null;
    const effortLevel = attributes.effort ?? attributes.effortLevel ?? span.metadata?.effort ?? null;

    const costBearing = isCostBearing(span);
    let costResult = null;
    let costUsd = null;
    let faceCostUsd = null;
    let gap = null;

    if (costBearing) {
      if (usage && model) {
        costResult = calculateModelCost({ model, usage, provider });
        if (costResult.ok) {
          costUsd = costResult.whatYouPayUsd;
          faceCostUsd = costResult.faceCostUsd;
        } else {
          gap = costResult.error;
        }
      } else if (typeof costContext.estimatedCost === 'number' && Number.isFinite(costContext.estimatedCost)) {
        // Fallback when estimatedCost is pre-attached
        costUsd = costContext.estimatedCost;
        faceCostUsd = costContext.estimatedCost;
      } else {
        gap = 'no_token_count';
      }
    }

    const freshInputTokens = costResult?.freshInputTokens ?? (usage?.inputTokens ? Math.max(0, usage.inputTokens - (usage.cachedInputTokens ?? usage?.inputDetails?.cacheRead ?? 0)) : 0);
    const cachedInputTokens = costResult?.cachedInputTokens ?? (usage?.cachedInputTokens ?? usage?.inputDetails?.cacheRead ?? 0);
    const outputTokens = costResult?.outputTokens ?? (usage?.outputTokens ?? 0);
    const thinkingTokens = costResult?.thinkingTokens ?? (usage?.reasoningTokens ?? usage?.outputDetails?.reasoning ?? 0);
    const totalTokens = freshInputTokens + cachedInputTokens + outputTokens;
    const totalInput = freshInputTokens + cachedInputTokens;
    const cachedShare = totalInput > 0 ? cachedInputTokens / totalInput : 0;

    const tokensObj = {
      freshInput: freshInputTokens,
      cachedInput: cachedInputTokens,
      output: outputTokens,
      thinking: thinkingTokens,
      total: totalTokens,
    };


    return {
      id: span.spanId ?? span.id ?? null,
      traceId: span.traceId ?? null,
      sessionId,
      card,
      correlated: card !== null,
      phase: spanPhase(span),
      actor: 'Factory',
      startedAt: toIso(span.startedAt ?? span.startTime),
      endedAt: toIso(span.endedAt ?? span.endTime),
      costBearing,
      costUsd,
      whatYouPayCost: costUsd,
      faceCost: faceCostUsd,
      faceCostUsd,
      model,
      provider,
      effortLevel,
      effort: effortLevel,
      freshInputTokens,
      cachedInputTokens,
      outputTokens,
      thinkingTokens,
      tokens: tokensObj,
      totalTokens,
      cachedShare,
      gap,
      namedGaps: gap ? [gap] : [],
      outcome: failedOutcome(span) ?? 'passed',
    };
  });
}

