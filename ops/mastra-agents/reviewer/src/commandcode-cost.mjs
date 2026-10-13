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
