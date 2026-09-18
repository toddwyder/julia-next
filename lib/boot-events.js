// Boot telemetry for the minimal Julia web app.
//
// This module is deliberately dependency-injectable: the network client
// (`fetchImpl`) and the Sentry client (`sentryImpl`) can both be supplied by
// the caller, which keeps it unit-testable without touching the network or
// initializing a real Sentry client. Nothing here ever throws: a missing
// configuration or a failing external call must never break page rendering,
// so every external call is wrapped and downgraded to a `console.warn`.

const SENTRY_BOOT_MESSAGE = 'julia-next: boot';
const AXIOM_EVENT_NAME = 'julia-next.boot';
const AXIOM_INGEST_BASE = 'https://api.axiom.co/v1/datasets';

/**
 * Emit the minimal boot telemetry, one half per configured vendor.
 *
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env] environment to read
 *   configuration from (defaults to `process.env`)
 * @param {typeof fetch} [options.fetchImpl] fetch implementation for the Axiom POST
 * @param {{ init: Function, captureMessage: Function }} [options.sentryImpl] Sentry
 *   client; when omitted, `@sentry/node` is imported lazily
 * @returns {Promise<{ sentry: boolean, axiom: boolean }>} which halves were attempted
 */
export async function emitBootEvents({ env = process.env, fetchImpl = fetch, sentryImpl } = {}) {
  const attempted = { sentry: false, axiom: false };

  if (env.NEXT_PUBLIC_SENTRY_DSN) {
    attempted.sentry = true;
    try {
      const sentry = sentryImpl ?? (await import('@sentry/node'));
      sentry.init({ dsn: env.NEXT_PUBLIC_SENTRY_DSN });
      // `captureMessage` returns a string for @sentry/node, but injected
      // implementations may return a rejected promise. Await it so a rejection
      // is caught here instead of escaping as an unhandled rejection.
      await sentry.captureMessage(SENTRY_BOOT_MESSAGE, 'info');
    } catch (err) {
      console.warn('julia-next: sentry boot event failed:', err?.message ?? err);
    }
  }

  if (env.AXIOM_TOKEN && env.AXIOM_DATASET) {
    attempted.axiom = true;
    try {
      const event = {
        event: AXIOM_EVENT_NAME,
        _time: new Date().toISOString(),
      };
      await fetchImpl(`${AXIOM_INGEST_BASE}/${env.AXIOM_DATASET}/ingest`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AXIOM_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify([event]),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      console.warn('julia-next: axiom boot event failed:', err?.message ?? err);
    }
  }

  return attempted;
}
