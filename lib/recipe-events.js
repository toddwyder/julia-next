import { captureApplicationError, sendAxiomEvent } from './delivery-events.js';

// What the browser may report about sign-in, saving and the move. Nothing else
// is accepted, so no recipe text or email address can reach Sentry or Axiom.
const ACTIONS = new Set(['sign-in', 'save', 'move']);
const OUTCOMES = new Set(['ok', 'turned-away', 'failed']);

/**
 * @param {unknown} body
 * @returns {{ action: string, outcome: string, code?: string, count?: number } | null}
 */
export function parseRecipeEvent(body) {
  if (!body || typeof body !== 'object') return null;
  const { action, outcome, code, count } = body;
  if (!ACTIONS.has(action) || !OUTCOMES.has(outcome)) return null;
  if (code !== undefined && !(typeof code === 'string' && /^[a-z][a-z/-]{0,59}$/.test(code))) return null;
  if (count !== undefined && !(Number.isInteger(count) && count >= 0 && count <= 100000)) return null;
  return { action, outcome, ...(code === undefined ? {} : { code }), ...(count === undefined ? {} : { count }) };
}

/** Every event goes to Axiom; a failure also goes to Sentry. */
export async function recordRecipeEvent(event, options) {
  const axiom = await sendAxiomEvent('julia-next.recipes', ['action', 'outcome', 'code', 'count'], event, options);
  if (event.outcome !== 'failed') return { axiom };
  const error = new Error(`julia-next: recipe ${event.action} failed (${event.code ?? 'unknown'})`);
  const sentry = await captureApplicationError(error, { routePath: '/api/recipe-events', routeType: 'route' }, options);
  return { axiom, sentry };
}
