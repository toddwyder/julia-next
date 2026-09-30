// mastra-traces.mjs -- issue #140, blocker 3: read Factory's trace costs
// through Mastra's own observability API.
//
// The supported surface is the one the pinned `mastra` CLI wraps, and the same
// route `@mastra/core`'s observability route schema declares:
//
//   mastra api trace list --url <factory>   -> GET  <factory>/api/observability/traces
//   mastra api trace query '<json>'         -> POST <factory>/api/observability/traces/query
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
    url.searchParams.set('startedAt', from);
    url.searchParams.set('endedAt', to);
    url.searchParams.set('page', String(page));
    url.searchParams.set('perPage', String(pageSize));

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

    const pagination = isObject(body.pagination) ? body.pagination : {};
    const totalPages = Number(pagination.totalPages ?? pagination.total_pages ?? 1);
    const nextPage = Number(pagination.page ?? page) + 1;
    if (!Number.isFinite(totalPages) || totalPages <= 0 || body.spans.length === 0 || nextPage >= totalPages) {
      break;
    }
  }
  return collected;
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
      costUsd: spanCostUsd(span),
      outcome: failedOutcome(span) ?? 'passed',
    };
  });
}
