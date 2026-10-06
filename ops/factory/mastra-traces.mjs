// mastra-traces.mjs -- issue #140, blocker 3: read Factory's trace costs
// through Mastra's own observability API.
//
// The supported surface is the one the pinned `mastra` CLI wraps, and the same
// route `@mastra/core`'s observability route schema declares:
//
//   mastra api trace list --verbose --url <factory>  -> GET <factory>/api/observability/traces
//   mastra api trace query '<json>'                 -> POST <factory>/api/observability/traces/query
//
// The non-verbose `trace list` hits `/observability/traces/light`, whose
// LightSpanRecord omits `attributes`, so it cannot carry cost; the full route
// (`GET /observability/traces`, the CLI's `--verbose` route) includes
// `attributes.costContext.estimatedCost` and `sessionId`, which is what the
// note needs.
//
// (`mastra@1.31.3` `dist/index.js`, the "api trace" command; the route schema
// lives in the installed `@mastra/core` `observability/types` route table.) We
// read that HTTP route directly with the project's own `fetch`, exactly as the
// CLI does, so a test can drive a fake `fetch` and nothing queries the DuckDB
// file by hand.
//
// Schema normalisation is deliberately strict. A response with no `spans`
// array is not a "quiet week" -- it is an unsupported shape, and the caller
// must fail closed rather than print a $0.00 note. A span without a cost is
// reported as unknown (`null`), never as zero. A span that names no Factory
// card is reported as uncorrelated, never guessed onto one.

/** The observability route the pinned `mastra api trace list` command calls. */
export const MASTRA_TRACE_ROUTE = '/api/observability/traces';

const PAGE_SIZE = 100;
const MAX_PAGES = 200;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read the trace spans for `[from, to)` through the supported route.
 *
 * `factoryUrl` is the deployment's base URL (the same value the README's
 * `--url <factory>` takes). Pages until the store reports no more, bounded so a
 * broken pagination contract cannot spin forever. Any transport error, HTTP
 * error, or unrecognised body throws: the caller must not turn a failed read
 * into a fabricated all-clear.
 *
 * @returns {Promise<Array<object>>} raw span records as the store returned them
 */
export async function readTraceSpans({ factoryUrl, from, to, fetchImpl = fetch, pageSize = PAGE_SIZE }) {
  const base = factoryUrl.replace(/\/$/, '');
  const collected = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${base}${MASTRA_TRACE_ROUTE}`);
    // The route's filters are objects, and the pinned mastra CLI puts an object
    // in the query string as JSON (`buildUrl` -> `JSON.stringify(value)`).
    // `startedAt` is the trace's start range; `endExclusive` makes the window
    // half-open `[from, to)`, matching the note's week semantics.
    url.searchParams.set('startedAt', JSON.stringify({ start: from, end: to, startExclusive: false, endExclusive: true }));
    url.searchParams.set('pagination', JSON.stringify({ page, perPage: pageSize }));

    const response = await fetchImpl(url.toString(), { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Mastra trace list returned HTTP ${response.status}`);
    }
    const body = await response.json();
    if (!isObject(body) || !Array.isArray(body.spans)) {
      throw new Error(
        'Mastra trace list response did not include a spans array; refusing to read cost from an unsupported shape',
      );
    }
    collected.push(...body.spans);

    // The response pagination is `{ total, page, perPage, hasMore }`
    // (listTracesResponseSchema in @mastra/core observability tracing).
    const pagination = body.pagination;
    if (!isObject(pagination) || typeof pagination.hasMore !== 'boolean' || pagination.page !== page) {
      throw new Error('Mastra trace list returned an unusable pagination object');
    }
    if (!pagination.hasMore) return collected;
    if (body.spans.length === 0 || page === MAX_PAGES - 1) {
      throw new Error('Mastra trace list pagination was incomplete; refusing a partial cost report');
    }
  }
  throw new Error('Mastra trace list exceeded pagination limit; refusing a partial cost report');
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * The cost Mastra attached to a model span.
 *
 * `costContext.estimatedCost` is what `@mastra/core` puts on a
 * `MODEL_GENERATION`/`MODEL_INFERENCE` span. The value is a number of
 * `costUnit` (USD for the models Factory runs). Anything else is unknown.
 */
function spanCostUsd(span) {
  const attributes = isObject(span.attributes) ? span.attributes : {};
  const costContext = isObject(attributes.costContext) ? attributes.costContext : {};
  const cost = costContext.estimatedCost;
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null;
  return cost;
}

function finiteUsage(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Mastra's UsageStats carries fresh input, cache-read, output and reasoning
 * detail. Keep an absent or malformed usage object as `null`: #211 records a
 * named gap rather than silently reporting zero tokens.
 */
function spanUsage(span) {
  const attributes = isObject(span.attributes) ? span.attributes : {};
  const usage = isObject(attributes.usage) ? attributes.usage : isObject(span.usage) ? span.usage : null;
  if (!usage) return null;
  const input = finiteUsage(usage.inputTokens ?? usage.input);
  const cached = finiteUsage(usage.inputTokenDetails?.cacheRead ?? usage.cachedInputTokens);
  const output = finiteUsage(usage.outputTokens ?? usage.output);
  const thinking = finiteUsage(usage.outputTokenDetails?.reasoning ?? usage.reasoningTokens);
  if ([input, cached, output, thinking].some((value) => value === null) || input < cached) return null;
  return { freshInputTokens: input - cached, cachedInputTokens: cached, outputTokens: output, thinkingTokens: thinking };
}

function spanProviderModel(span) {
  const attributes = isObject(span.attributes) ? span.attributes : {};
  const costContext = isObject(attributes.costContext) ? attributes.costContext : {};
  return { provider: costContext.provider ?? attributes.provider ?? null, model: costContext.model ?? attributes.model ?? null };
}

/** Factory's working phases, so a trace reads as "plan" / "build" / "review". */
const PHASE_BY_STAGE = {
  triage: 'triage',
  planning: 'plan',
  execute: 'build',
  review: 'review',
};

/**
 * Map a span's name/entity onto a Factory phase. The store does not stamp the
 * card's pipeline stage on the span, so this is derived and only labels the
 * line; it never decides which card or which week the cost belongs to.
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
 * The span types Mastra bills. Any model span is cost-bearing even when its
 * `costContext` is absent, so a missing cost on one is a failed read, never a
 * free run. `@mastra/core` `SpanType` (observability/types/tracing).
 */
const MODEL_SPAN_TYPES = new Set(['model_generation', 'model_step', 'model_inference']);

/**
 * Is this span one that should carry a cost? A model span is cost-bearing by
 * type; a span that carries `costContext` is cost-bearing by its own payload.
 * Everything else (tool, RAG, processor, generic) is not billed, so it is not
 * required to have a numeric cost.
 */
function isCostBearing(span) {
  const type = span.spanType ?? span.type;
  if (typeof type === 'string' && MODEL_SPAN_TYPES.has(type)) return true;
  const attributes = isObject(span.attributes) ? span.attributes : {};
  return isObject(attributes.costContext);
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

    return {
      id: span.spanId ?? span.id ?? null,
      traceId: span.traceId ?? null,
      sessionId,
      card,
      correlated: card !== null,
      phase: spanPhase(span),
      // Every span in the trace store runs on Factory's own machines; the one
      // human action (Todd's Intake tap) is a card movement, not a trace.
      actor: 'Factory',
      startedAt: toIso(span.startedAt ?? span.startTime),
      endedAt: toIso(span.endedAt ?? span.endTime),
      // Whether Mastra bills this span. A cost-bearing span with no numeric
      // cost is a failed read, never a free run; the note fails closed on it.
      costBearing: isCostBearing(span),
      costUsd: spanCostUsd(span),
      ...spanProviderModel(span),
      usage: spanUsage(span),
      outcome: failedOutcome(span) ?? 'passed',
    };
  });
}
