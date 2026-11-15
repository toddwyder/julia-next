// Reads the card's cost total and agent/model split from Mastra's observability
// store and sends one cost record to Axiom when a card ends (stopped or finished).

const TOKEN_TOTAL_METRICS = ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'];
const AXIOM_EVENT = 'julia-next.card-cost';

const roundUsd = value => Number((Number(value) || 0).toFixed(6));

export async function buildCardCostRecord({ mastra, card, status }) {
  const obs = await mastra?.getStorage?.()?.getStore?.('observability');
  if (!obs?.getMetricAggregate) return null;

  const totalAgg = await obs.getMetricAggregate({
    name: TOKEN_TOTAL_METRICS,
    aggregation: 'sum',
    filters: { resourceId: card },
  });
  const breakdown = obs.getMetricBreakdown
    ? await obs.getMetricBreakdown({
        name: TOKEN_TOTAL_METRICS,
        groupBy: ['entityId', 'provider', 'model'],
        aggregation: 'sum',
        filters: { resourceId: card },
        limit: 100,
      })
    : { groups: [] };

  const byAgentModel = (breakdown?.groups ?? []).map(group => ({
    agent: group.dimensions?.entityId ?? 'unknown',
    provider: group.dimensions?.provider ?? 'unknown',
    model: group.dimensions?.model ?? 'unknown',
    usd: roundUsd(group.estimatedCost),
    tokens: Number(group.value) || 0,
  }));

  return {
    event: AXIOM_EVENT,
    _time: new Date().toISOString(),
    card,
    status,
    totalUsd: roundUsd(totalAgg?.estimatedCost),
    costUnit: totalAgg?.costUnit ?? 'USD',
    totalTokens: Number(totalAgg?.value) || 0,
    byAgentModel,
  };
}

export async function sendCardCostRecord({ mastra, card, status, env = process.env, fetchImpl = fetch }) {
  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) return { status: 'unconfigured' };
  const record = await buildCardCostRecord({ mastra, card, status }).catch(() => null);
  if (!record) return { status: 'skipped' };

  try {
    const response = await fetchImpl(
      `https://api.axiom.co/v1/datasets/${encodeURIComponent(env.AXIOM_DATASET)}/ingest`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AXIOM_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([record]),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return { status: 'failed', httpStatus: response.status };
    const result = await response.json();
    return result.ingested === 1 && result.failed === 0
      ? { status: 'sent', record }
      : { status: 'failed', reason: 'ingestion did not confirm one accepted event' };
  } catch {
    return { status: 'failed', reason: 'Axiom ingestion failed' };
  }
}
