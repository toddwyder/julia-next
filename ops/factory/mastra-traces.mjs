// mastra-traces.mjs -- issue #180: read Factory's trace costs and token
// details through Mastra's observability API and price them with the single-source
// price table.
//
// The supported surfaces:
//   Pinned authenticated Mastra routes under /api/observability/traces
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

/** Supported authenticated observability routes in pinned Mastra. */
export const MASTRA_TRACE_ROUTE = '/api/observability/traces';
const PAGE_SIZE = 20;
const MAX_PAGES = 500;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** List light roots/timelines, then hydrate individual billable spans and roots.
 * Reading full trace trees buffers every prompt; these supported routes keep
 * each request bounded to one span. No unauthenticated fallback is allowed.
 */
export async function readTraceSpans({ factoryUrl, token, from, to, fetchImpl = fetch, pageSize = PAGE_SIZE, log = () => {} }) {
  if (!token?.trim()) throw new Error('MONDAY_NOTE_TRACE_TOKEN is required to read authenticated traces');
  const base = factoryUrl.replace(/\/$/, '');
  async function get(path, query) {
    const url = new URL(`${base}${MASTRA_TRACE_ROUTE}${path}`);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    const response = await fetchImpl(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Mastra trace read ${url.pathname} returned HTTP ${response.status}`);
    return response.json();
  }
  const collected = [];
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await get('/light', {
      startedAt: { start: from, end: to, startExclusive: false, endExclusive: true },
      page, perPage: pageSize,
    });
    if (!isObject(body) || !Array.isArray(body.spans)) throw new Error('Mastra trace list did not include a spans array');
    const pagination = body.pagination;
    if (!isObject(pagination) || typeof pagination.hasMore !== 'boolean' || pagination.page !== page) throw new Error('Mastra trace list returned an unusable pagination object');
    if (pagination.hasMore && (body.spans.length === 0 || page === MAX_PAGES - 1)) throw new Error('Mastra trace pagination was incomplete; refusing a partial report');
    for (const root of body.spans) {
      if (!root.traceId || seen.has(root.traceId)) continue;
      seen.add(root.traceId);
      const trace = await get(`/${encodeURIComponent(root.traceId)}/light`);
      if (!Array.isArray(trace.spans) || trace.spans.length === 0) throw new Error(`Mastra trace ${root.traceId} has no timeline spans`);
      const { inputPreview, outputPreview, input, output, ...safeRoot } = root;
      const details = [safeRoot];
      const timeline = new Map(trace.spans.map(span => [span.spanId, span]));
      for (const span of trace.spans) {
        if (!isCostBearing(span)) continue;
        let billedByParent = false;
        const visited = new Set();
        for (let parent = timeline.get(span.parentSpanId); parent && !visited.has(parent.spanId); parent = timeline.get(parent.parentSpanId)) {
          visited.add(parent.spanId);
          if (parent.spanType === 'model_generation') billedByParent = true;
        }
        if (billedByParent) continue;
        const result = await get(`/${encodeURIComponent(root.traceId)}/spans/${encodeURIComponent(span.spanId)}`);
        if (!result.span?.spanId) throw new Error(`Mastra span ${span.spanId} returned no span detail`);
        // Keep only cost and identity fields; prompt text never enters reports.
        const { input, output, ...record } = result.span;
        // Provider/tool schemas are also unnecessary to cost accounting.
        record.attributes = Object.fromEntries(Object.entries(record.attributes ?? {}).filter(([key]) =>
          ['model', 'responseModel', 'selectedModel', 'provider', 'usage', 'costContext', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens', 'inputDetails', 'outputDetails', 'effort', 'effortLevel', 'sessionId', 'conversationId', 'threadId'].includes(key)));
        details.push(record);
      }
      const parent = details.find(span => span.spanId === root.spanId) ?? root;
      const identity = parent.threadId ?? parent.metadata?.threadId ?? parent.attributes?.threadId ?? parent.attributes?.conversationId ?? parent.metadata?.sessionId;
      for (const span of details) collected.push({ ...span, threadId: span.threadId ?? identity });
    }
    if (!pagination.hasMore) return collected;
    log(`mastra-traces page=${page} roots=${seen.size} spans=${collected.length}`);
  }
  throw new Error('Mastra trace list exceeded pagination limit');
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
  if (isObject(attributes.costContext) || isObject(attributes.usage)) return true;
  if (typeof attributes.inputTokens === 'number' || typeof attributes.outputTokens === 'number') return true;
  if (typeof span.name === 'string' && span.name.startsWith('llm:')) return true;
  return false;
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
 * @param {{cards?: Array<{number: number, sessions?: Record<string, unknown>, stageHistory?: Array<object>}>}} options
 */
export function normalizeTraceSpans(spans = [], { cards = [] } = {}) {
  const cardBySession = new Map();
  for (const card of cards) {
    if (card.number) {
      const reference = String(card.number).toLowerCase();
      if (/^pr-\d+$/.test(reference)) {
        cardBySession.set(reference, card.number);
        cardBySession.set(`factory/${reference}`, card.number);
      }
      cardBySession.set(String(card.number), card.number);
      cardBySession.set(`pr-${card.number}`, card.number);
      cardBySession.set(`issue-${card.number}`, card.number);
      cardBySession.set(`factory/pr-${card.number}`, card.number);
      cardBySession.set(`factory/issue-${card.number}`, card.number);
    }
    if (card.sessions && typeof card.sessions === 'object') {
      for (const [key, value] of Object.entries(card.sessions)) {
        if (!['triage', 'plan', 'work', 'review'].includes(key)) cardBySession.set(key, card.number);
        if (value && typeof value === 'object') {
          if (value.sessionId) cardBySession.set(value.sessionId, card.number);
          if (value.threadId) cardBySession.set(value.threadId, card.number);
          if (value.branch) {
            cardBySession.set(value.branch, card.number);
            const branchMatch = value.branch.match(/(?:pr|issue)[/-]?(\d+)/i);
            if (branchMatch) cardBySession.set(branchMatch[1], card.number);
          }
        } else if (typeof value === 'string' && value) {
          cardBySession.set(value, card.number);
        }
      }
    }
    if (Array.isArray(card.stageHistory)) {
      for (const stage of card.stageHistory) {
        if (stage && typeof stage === 'object') {
          if (stage.sessionId) cardBySession.set(stage.sessionId, card.number);
          if (stage.threadId) cardBySession.set(stage.threadId, card.number);
          if (stage.branch) cardBySession.set(stage.branch, card.number);
        }
      }
    }
  }

  const spansById = new Map(spans.map(span => [span.spanId ?? span.id, span]));
  return spans.map((span) => {
    const attributes = isObject(span.attributes) ? span.attributes : {};
    const costContext = isObject(attributes.costContext) ? attributes.costContext : {};
    const usage =
      isObject(attributes.usage)
        ? attributes.usage
        : (typeof attributes.inputTokens === 'number' || typeof attributes.outputTokens === 'number'
            ? {
                inputTokens: attributes.inputTokens,
                outputTokens: attributes.outputTokens,
                cachedInputTokens: attributes.cachedInputTokens,
                reasoningTokens: attributes.reasoningTokens,
                inputDetails: attributes.inputDetails,
                outputDetails: attributes.outputDetails,
              }
            : null);

    const sessionId =
      span.sessionId ??
      span.threadId ??
      span.scope?.sessionId ??
      span.metadata?.sessionId ??
      attributes.sessionId ??
      attributes.conversationId ??
      attributes.threadId ??
      attributes['thread.id'] ??
      null;

    let card = null;
    if (sessionId !== null) {
      card = cardBySession.get(sessionId) ?? null;
      if (card === null) {
        const numMatch = String(sessionId).match(/(?:^|\/)(pr|issue)[/-]?(\d+)(?:-|$)/i);
        if (numMatch) {
          card = cardBySession.get(`${numMatch[1].toLowerCase()}-${numMatch[2]}`) ?? null;
        }
      }
    }

    const modelMatch = typeof span.name === 'string' ? span.name.match(/^llm:\s*['"]?([^'"]+)['"]?/) : null;
    const model =
      attributes.model ??
      attributes.responseModel ??
      attributes.selectedModel ??
      attributes['ai.model.id'] ??
      costContext.model ??
      (modelMatch ? modelMatch[1] : null);

    const provider = attributes.provider ?? costContext.provider ?? (model ? getModelPrice(model)?.provider : null) ?? null;
    const snapshot = cards.find(item => item.number === card)?.phaseSnapshots
      ?.filter(item => item.threadId === sessionId && Date.parse(item.at) <= Date.parse(span.startedAt ?? span.startTime))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    const effortLevel = attributes.effort ?? attributes.effortLevel ?? span.metadata?.effort ?? snapshot?.effort ?? null;

    let aggregateParent = false;
    const seenParents = new Set();
    for (let parent = spansById.get(span.parentSpanId); parent && !seenParents.has(parent.spanId); parent = spansById.get(parent.parentSpanId)) {
      seenParents.add(parent.spanId);
      if (parent.spanType === 'model_generation' && (span.spanType === 'model_step' || span.spanType === 'model_inference')) aggregateParent = true;
    }
    const costBearing = isCostBearing(span) && !aggregateParent;
    let costResult = null;
    let costUsd = null;
    let faceCostUsd = null;
    let gap = null;

    if (costBearing) {
      if (usage && model) {
        costResult = calculateModelCost({ model, usage, provider, startedAt: span.startedAt ?? span.startTime });
        if (costResult.ok) {
          costUsd = costResult.whatYouPayUsd;
          faceCostUsd = costResult.faceCostUsd;
        } else {
          gap = costResult.error;
        }
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

