// Selected delivery facts only: never worker streams, prompts or credentials.
export async function emitOperationalEvent(fields, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) return { status: 'unconfigured' };
  const event = { event: 'julia-next.delivery', _time: new Date().toISOString() };
  for (const key of ['issueId', 'stage', 'outcome', 'round', 'commit', 'problemId', 'deploymentId']) {
    if (['string', 'number'].includes(typeof fields[key])) event[key] = fields[key];
  }
  try {
    const response = await fetchImpl(`https://api.axiom.co/v1/datasets/${encodeURIComponent(env.AXIOM_DATASET)}/ingest`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.AXIOM_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([event]), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { status: 'failed', httpStatus: response.status };
    const result = await response.json();
    return result.ingested === 1 && result.failed === 0 ? { status: 'sent' } : { status: 'failed', reason: 'ingestion did not confirm one accepted event' };
  } catch { return { status: 'failed', reason: 'Axiom ingestion failed' }; }
}

export async function captureApplicationError(error, context, { env = process.env, sentryImpl } = {}) {
  if (!env.NEXT_PUBLIC_SENTRY_DSN) return { status: 'unconfigured' };
  try {
    const sentry = sentryImpl ?? await import('@sentry/node');
    if (!sentry.isInitialized?.()) sentry.init({ dsn: env.NEXT_PUBLIC_SENTRY_DSN, sendDefaultPii: false });
    const eventId = sentry.captureException(error, { tags: { route: context.routePath, routeType: context.routeType } });
    if (!eventId || !await sentry.flush(5000)) return { status: 'failed', reason: 'Sentry did not flush the application exception' };
    return { status: 'sent', eventId };
  } catch { return { status: 'failed', reason: 'Sentry application exception failed' }; }
}
