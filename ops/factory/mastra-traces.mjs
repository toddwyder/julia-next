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

import { calculateModelCost, getModelPrice, PRICE_TABLE } from './price-table.mjs';

/** Supported authenticated observability routes in pinned Mastra. */
export const MASTRA_TRACE_ROUTE = '/api/observability/traces';
const PAGE_SIZE = 20;
const MAX_PAGES = 500;
const REVIEW_OVERHEAD_ROOTS = new Set([
  "workflow run: 'cross-maker-review'",
  "workflow run: 'pr-review-workflow'",
  "agent run: 'code-review-agent'",
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** List light roots/timelines, then hydrate billable spans in bounded batches.
 * Reading full trace trees buffers every prompt; these supported routes keep
 * each response bounded to twenty cost-only spans. No unauthenticated fallback is allowed.
 */
export async function readTraceSpans({ factoryUrl, token, from, to, fetchImpl = fetch, pageSize = PAGE_SIZE, log = () => {} }) {
  if (!token?.trim()) throw new Error('MONDAY_NOTE_TRACE_TOKEN is required to read authenticated traces');
  const fromMs = Date.parse(from);
  if (!Number.isFinite(fromMs)) throw new Error('Monday note start time is invalid');
  const toMs = Date.parse(to);
  if (!Number.isFinite(toMs) || toMs <= fromMs) throw new Error('Monday note end time is invalid');
  // The supported store retains spans for 14 days. Thirty days includes roots
  // opened before this week while bounding the weekly scan and HTTP reads.
  const rootStart = new Date(fromMs - 30 * 24 * 60 * 60 * 1000).toISOString();
  const base = factoryUrl.replace(/\/$/, '');
  async function get(path, query) {
    const url = new URL(`${base}${path.startsWith('/julia/') ? path : MASTRA_TRACE_ROUTE + path}`);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    let response;
    try {
      response = await fetchImpl(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(120000) });
    } catch (error) {
      throw new Error(`Mastra trace read ${url.pathname} transport failed (${error?.name ?? 'Error'})`);
    }
    if (!response.ok) throw new Error(`Mastra trace read ${url.pathname} returned HTTP ${response.status}`);
    try { return await response.json(); }
    catch { throw new Error(`Mastra trace read ${url.pathname} returned invalid JSON`); }
  }
  const collected = [];
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await get('/light', {
      // Roots can start before this week and contain calls inside it. Window
      // calls by their own start after loading a bounded set of retained roots.
      startedAt: { start: rootStart, end: to, endExclusive: true },
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
      delete safeRoot.requestContext;
      safeRoot.metadata = Object.fromEntries(Object.entries(safeRoot.metadata ?? {}).filter(([key]) => ['threadId', 'sessionId', 'runId', 'factory_stage', 'effort'].includes(key)));
      const details = [safeRoot];
      const billableIds = [];
      const timeline = new Map(trace.spans.map(span => [span.spanId, span]));
      const aggregates = new Set();
      for (const inference of trace.spans.filter(span => span.spanType === 'model_inference')) {
        const visited = new Set();
        for (let parent = timeline.get(inference.parentSpanId); parent && !visited.has(parent.spanId); parent = timeline.get(parent.parentSpanId)) {
          visited.add(parent.spanId);
          if (parent.spanType === 'model_generation' || parent.spanType === 'model_step') aggregates.add(parent.spanId);
        }
      }
      for (const span of trace.spans) {
        if (!isCostBearing(span)) continue;
        const at = Date.parse(span.startedAt);
        if (!Number.isFinite(at) || at < fromMs || at >= toMs) continue;
        if (aggregates.has(span.spanId)) {
          if (span.spanType === 'model_step') details.push({
            traceId: root.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId,
            spanType: span.spanType, startedAt: span.startedAt, endedAt: span.endedAt,
            includedInGeneration: true,
          });
          continue;
        }
        billableIds.push(span.spanId);
      }
      for (let offset = 0; offset < billableIds.length; offset += 20) {
        const ids = billableIds.slice(offset, offset + 20);
        const result = await get(`/julia/cost-traces/${encodeURIComponent(root.traceId)}/spans`, { ids: ids.join(',') });
        if (!Array.isArray(result.spans) || result.spans.length !== ids.length ||
          result.spans.some((span, index) => span?.spanId !== ids[index])) {
          throw new Error(`Mastra trace ${root.traceId} returned incomplete span details`);
        }
        for (const costSpan of result.spans) {
          // Keep only cost and identity fields; prompt text never enters reports.
          const { input, output, ...record } = costSpan;
          delete record.requestContext;
          record.metadata = Object.fromEntries(Object.entries(record.metadata ?? {}).filter(([key]) => ['threadId', 'sessionId', 'runId', 'factory_stage', 'effort'].includes(key)));
          record.attributes = { ...record.attributes,
            effort: record.attributes?.effort ?? record.attributes?.parameters?.reasoning?.effort ??
              record.attributes?.parameters?.reasoningEffort ?? record.attributes?.parameters?.reasoning_effort };
          if (record.error !== null && record.error !== undefined) record.error = { message: 'model call failed; details retained on server' };
          // Provider/tool schemas are also unnecessary to cost accounting.
          record.attributes = Object.fromEntries(Object.entries(record.attributes ?? {}).filter(([key]) =>
            ['model', 'responseModel', 'selectedModel', 'provider', 'usage', 'costContext', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens', 'inputDetails', 'outputDetails', 'effort', 'effortLevel', 'sessionId', 'conversationId', 'threadId'].includes(key)));
          details.push(record);
        }
      }
      if (aggregates.has(root.spanId)) safeRoot.includedInGeneration = true;
      const distinct = [...new Map(details.map(span => [span.spanId, span])).values()];
      const parent = distinct.find(span => span.spanId === root.spanId) ?? root;
      const identity = parent.threadId ?? parent.metadata?.threadId ?? parent.attributes?.threadId ?? parent.attributes?.conversationId ?? parent.metadata?.sessionId;
      for (const span of distinct) collected.push({ ...span, threadId: span.threadId ?? identity,
        factoryPhase: spanPhase(root), runId: root.runId ?? root.metadata?.runId ?? null,
        projectOverhead: REVIEW_OVERHEAD_ROOTS.has(root.name) });
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

function recordedFactoryPhase(value) {
  const phase = String(value ?? '').trim().toLowerCase();
  return ({ intake: 'triage', triage: 'triage', planning: 'plan', plan: 'plan',
    execute: 'build', executing: 'build', work: 'build', working: 'build', build: 'build', building: 'build',
    review: 'review', reviewing: 'review' })[phase] ?? null;
}

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
  return null;
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
export function normalizeTraceSpans(spans = [], { cards = [], priceTable = PRICE_TABLE, projectId } = {}) {
  const cardBySession = new Map();
  const bindingsBySession = new Map();
  for (const card of cards) {
    for (const binding of card.sessionBindings ?? []) {
      for (const id of [binding.threadId, binding.sessionId].filter(Boolean)) {
        cardBySession.set(id, card.number);
        bindingsBySession.set(id, [...(bindingsBySession.get(id) ?? []), binding]);
      }
    }
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
  const inferenceAncestors = new Set();
  for (const child of spans.filter(span => span.spanType === 'model_inference')) {
    const visited = new Set();
    for (let parent = spansById.get(child.parentSpanId); parent && !visited.has(parent.spanId); parent = spansById.get(parent.parentSpanId)) {
      visited.add(parent.spanId);
      if (parent.spanType === 'model_generation' || parent.spanType === 'model_step') inferenceAncestors.add(parent.spanId);
    }
  }
  return spans.map((span) => {
    const attributes = isObject(span.attributes) ? span.attributes : {};
    const costContext = isObject(attributes.costContext) ? attributes.costContext : {};
    const usage =
      isObject(attributes.usage) && Object.keys(attributes.usage).length > 0
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

    const rawProvider = attributes.provider ?? costContext.provider ?? (model ? getModelPrice(model, undefined, priceTable)?.provider : null) ?? null;
    // AI SDK records the OpenAI API transport as its provider identifier.
    const provider = typeof rawProvider === 'string' ? rawProvider.replace(/^openai\.(?:responses|chat)$/, 'openai') : rawProvider;
    const snapshot = cards.find(item => item.number === card)?.phaseSnapshots
      ?.filter(item => item.threadId === sessionId && Date.parse(item.at) <= Date.parse(span.startedAt ?? span.startTime))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    const effortLevel = attributes.effort ?? attributes.effortLevel ?? span.metadata?.effort ?? snapshot?.effort ?? null;

    let aggregateParent = false;
    const seenParents = new Set();
    for (let parent = spansById.get(span.parentSpanId); parent && !seenParents.has(parent.spanId); parent = spansById.get(parent.parentSpanId)) {
      seenParents.add(parent.spanId);
      if (parent.spanType === 'model_generation' && span.spanType === 'model_step') aggregateParent = true;
    }
    const binding = bindingsBySession.get(sessionId)?.filter(item => Date.parse(item.at) <= Date.parse(span.startedAt ?? span.startTime))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    const recordedPhase = snapshot?.phase ? recordedFactoryPhase(snapshot.phase) :
      binding?.role ? recordedFactoryPhase(binding.role) : null;
    const costBearing = isCostBearing(span) && !aggregateParent && !inferenceAncestors.has(span.spanId) && !span.includedInGeneration;
    let costResult = null;
    let costUsd = null;
    let faceCostUsd = null;
    let gap = null;

    if (costBearing) {
      if (usage && model) {
        costResult = calculateModelCost({ model, usage, provider, startedAt: span.startedAt ?? span.startTime, priceTable });
        if (costResult.ok) {
          costUsd = costResult.whatYouPayUsd;
          faceCostUsd = costResult.faceCostUsd;
        } else {
          gap = costResult.error;
        }
      } else {
        gap = usage && !model ? 'no_recorded_model' : 'no_token_count';
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
      projectOverhead: Boolean(span.projectOverhead || (projectId && sessionId === `factory-supervisor:${projectId}`)),
      correlated: card !== null,
      phase: recordedPhase ?? span.factoryPhase ?? spanPhase(span),
      runId: span.runId ?? null,
      modelStep: span.spanType === 'model_step',
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
      namedGaps: [...new Set([
        ...(gap ? [gap] : []),
        ...(costBearing && model && !getModelPrice(model, provider, priceTable) ? ['unpriced_model'] : []),
        ...(costBearing && !model ? ['no_recorded_model'] : []),
      ])],
      outcome: failedOutcome(span) ?? 'passed',
    };
  });
}
