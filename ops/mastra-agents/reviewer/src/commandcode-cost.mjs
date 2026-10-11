export const COMMANDCODE_PRICING = Object.freeze({
  checkedOn: '2026-10-11',
  source: 'https://commandcode.ai/docs/resources/pricing-limits',
  model: 'deepseek/deepseek-v4.1-flash',
  perMillion: Object.freeze({
    offPeak: Object.freeze({ input: 0.15, output: 0.60, cacheRead: 0.003 }),
    peak: Object.freeze({ input: 0.30, output: 1.20, cacheRead: 0.003 }),
  }),
});

function requiredUsageNumber(usage, field) {
  const value = usage?.[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`reviewer refused: CommandCode usage.${field} is missing or unknown`);
  }
  return value;
}

function priceBand(at) {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)) ? 'peak' : 'off-peak';
}

export function commandCodeCostEstimate(usage, at = new Date()) {
  const input = requiredUsageNumber(usage, 'prompt_tokens');
  const output = requiredUsageNumber(usage, 'completion_tokens');
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (typeof cached !== 'number' || !Number.isFinite(cached) || cached < 0 || cached > input) {
    throw new Error('reviewer refused: CommandCode cached token count is invalid');
  }
  const band = priceBand(at);
  const rates = band === 'peak' ? COMMANDCODE_PRICING.perMillion.peak : COMMANDCODE_PRICING.perMillion.offPeak;
  const cost = ((input - cached) * rates.input + cached * rates.cacheRead + output * rates.output) / 1_000_000;
  return { cost, kind: 'estimated', source: `commandcode.pricing.${COMMANDCODE_PRICING.checkedOn}`, priceBand: band };
}

export async function commandCodeUsageSummary({ key, fetchImpl = fetch, baseURL = 'https://api.commandcode.ai' } = {}) {
  if (!key || key.startsWith('op://')) throw new Error('CommandCode credential was not resolved by the launcher');
  const response = await fetchImpl(`${baseURL}/alpha/usage/summary`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`CommandCode usage summary returned HTTP ${response.status}`);
  const body = await response.json();
  const snapshot = {};
  for (const field of ['totalCount', 'totalCost', 'totalTokensIn', 'totalTokensOut']) {
    const value = body?.[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`CommandCode usage summary ${field} is missing or unknown`);
    snapshot[field] = value;
  }
  return snapshot;
}

export function usageSummaryDelta(before, after) {
  const difference = field => {
    const value = after[field] - before[field];
    if (!Number.isFinite(value) || value < 0) throw new Error(`CommandCode usage summary ${field} moved backwards`);
    return value;
  };
  return {
    kind: 'actual',
    cost: difference('totalCost'),
    requestCount: difference('totalCount'),
    tokensIn: difference('totalTokensIn'),
    tokensOut: difference('totalTokensOut'),
    mayIncludeOtherUsage: true,
  };
}

export function requireUsageSummaryCoverage(before, after, attemptedCalls) {
  if (!Number.isInteger(attemptedCalls) || attemptedCalls < 0) {
    throw new Error('reviewer refused: attempted provider call count is invalid');
  }
  if (after.totalCount < before.totalCount + attemptedCalls) {
    throw new Error('reviewer refused: CommandCode usage summary has not reported every attempted provider call');
  }
  return after;
}
