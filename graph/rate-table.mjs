// rate-table.mjs -- JUL-109 (UAT follow-up): what one token costs, per model, kept in the repo so a
// price change is a one-line edit with a date and a source, not a code change somewhere else.
//
// Data plus arithmetic only. No launch route, no secrets, no controller logic: the controller ticket
// that writes the per-worker cost line reads this table. A dollar figure from here is an API
// list-price equivalent. `runner` and `orchestrator-svc` sign in to Claude and Codex with
// subscription logins, which are not billed per token, so for those two seats this number is what the
// work would cost at list price, not an invoice line. DeepSeek is billed per token from a topped-up
// balance, so its figure is a real charge.
//
// Every entry says where its numbers came from and the day they were checked. Change a price by
// changing the entry and its `checkedOn`; graph/rate-table.test.mjs then re-proves the arithmetic
// against the recorded sessions in graph/fixtures/orca-1.4.205/.

export const RATE_TABLE = {
  asOf: '2026-09-20',
  unit: 'USD per million tokens',
  models: {
    // Anthropic list prices. Sonnet 5's $2 / $10 is the standard price now (introductory pricing
    // through 31 Aug 2026 became permanent; the planned $3 / $15 did not happen). Claude Code prices
    // every cache write at the 1-hour rate in its own cost record, so cacheWrite1h is the figure to
    // use when a record does not say which lifetime a write had.
    'claude-sonnet-5': {
      vendor: 'claude',
      input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      checkedOn: '2026-09-20',
    },
    'claude-opus-5': {
      vendor: 'claude',
      input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      checkedOn: '2026-09-20',
    },
    'claude-haiku-4-5-20251001': {
      vendor: 'claude',
      input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      checkedOn: '2026-09-20',
    },
    // OpenAI list prices for the model Codex runs on the server. Codex's token record counts
    // cached_input_tokens INSIDE input_tokens (total_tokens = input_tokens + output_tokens), so
    // the uncached part is input minus cached. Above 272,000 input tokens the whole request is
    // billed at 2x input and cache rates and 1.5x output.
    'gpt-6-astra': {
      vendor: 'codex',
      input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50,
      longContextThresholdTokens: 272000, longContextInputMultiplier: 2, longContextOutputMultiplier: 1.5,
      contextWindow: 258400, // model_context_window in the Codex session record
      source: 'https://developers.openai.com/api/docs/models/gpt-6-astra',
      checkedOn: '2026-09-20',
    },
    // DeepSeek, from DeepSeek's own price page. Peak hours are 01:00-04:00 and 06:00-10:00 UTC,
    // Monday to Friday (Chinese public holidays are off-peak but this table does not know them, so
    // it can only overstate on such a day); every other hour is off-peak, at half the peak price.
    // `piRegistry` is what Pi's built-in model list charges and what Pi prints as usage.cost.total.
    // The two DISAGREE (see graph/rate-table.test.mjs): Pi's dollar figure is lower than DeepSeek's
    // published price. Until DeepSeek's billing page settles it, cost lines use the published
    // price and say so.
    'deepseek-v4-pro': {
      vendor: 'pi-deepseek',
      offPeak: { input: 0.66, output: 1.98, cacheRead: 0.022 },
      peak: { input: 1.32, output: 3.96, cacheRead: 0.044 },
      piRegistry: { input: 0.435, output: 0.87, cacheRead: 0.003625 },
      contextWindow: 1000000,
      source: 'https://api-docs.deepseek.com/quick_start/pricing (page lists it as deepseek-v4-pro); Pi registry: pi-ai providers/data/deepseek.json',
      checkedOn: '2026-09-20',
    },
    'deepseek-v4-flash': {
      vendor: 'pi-deepseek',
      offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003 },
      peak: { input: 0.3, output: 1.2, cacheRead: 0.006 },
      piRegistry: { input: 0.14, output: 0.28, cacheRead: 0.0028 },
      contextWindow: 1000000,
      // The page names this model `deepseek-flash` (DeepSeek-V4.1-Flash). Our seat id is
      // `deepseek-v4-flash`. That they are the same billed model is NOT confirmed.
      unconfirmed: 'DeepSeek page lists deepseek-flash; treating it as our deepseek-v4-flash id is unconfirmed',
      source: 'https://api-docs.deepseek.com/quick_start/pricing; Pi registry: pi-ai providers/data/deepseek.json',
      checkedOn: '2026-09-20',
    },
  },
};

export function isDeepseekPeak(at) {
  const d = at instanceof Date ? at : new Date(at);
  const day = d.getUTCDay(); // 0 Sunday .. 6 Saturday
  if (day === 0 || day === 6) return false;
  const h = d.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

const PER = 1e6;

// usage, by vendor (use the field names the vendor's own record uses, mapped once here):
//   claude       { input, output, cacheRead, cacheWrite5m, cacheWrite1h }   (input excludes cache)
//   codex        { input, cachedInput, output }                              (input INCLUDES cached)
//   pi-deepseek  { input, output, cacheRead }                                (input excludes cache)
// `at` (a Date or timestamp) picks DeepSeek's peak or off-peak rate; pass the run's start time.
export function costOf(model, usage = {}, { at = new Date() } = {}) {
  const r = RATE_TABLE.models[model];
  if (!r) throw new Error(`costOf: no rate for model '${model}' in graph/rate-table.mjs`);
  const n = (k) => usage[k] ?? 0;
  if (r.vendor === 'claude') {
    return (n('input') * r.input + n('output') * r.output + n('cacheRead') * r.cacheRead
      + n('cacheWrite5m') * r.cacheWrite5m + n('cacheWrite1h') * r.cacheWrite1h) / PER;
  }
  if (r.vendor === 'codex') {
    const long = n('input') > r.longContextThresholdTokens;
    const inMul = long ? r.longContextInputMultiplier : 1;
    const outMul = long ? r.longContextOutputMultiplier : 1;
    const uncached = n('input') - n('cachedInput');
    return (uncached * r.input * inMul + n('cachedInput') * r.cachedInput * inMul + n('output') * r.output * outMul) / PER;
  }
  if (r.vendor === 'pi-deepseek') {
    const t = isDeepseekPeak(at) ? r.peak : r.offPeak;
    return (n('input') * t.input + n('output') * t.output + n('cacheRead') * t.cacheRead) / PER;
  }
  throw new Error(`costOf: unknown vendor '${r.vendor}' for model '${model}'`);
}

// What Pi itself would print as usage.cost.total, from its built-in registry rates. Used only to
// show how far Pi's figure is from the published price.
export function piReportedCostOf(model, usage = {}) {
  const r = RATE_TABLE.models[model];
  if (!r?.piRegistry) throw new Error(`piReportedCostOf: no Pi registry rate for '${model}'`);
  const n = (k) => usage[k] ?? 0;
  return (n('input') * r.piRegistry.input + n('output') * r.piRegistry.output + n('cacheRead') * r.piRegistry.cacheRead) / PER;
}

// Peak context for any vendor: the largest prompt any one model call carried. Each call's
// prompt = uncached input + cached input (read + written); output is not part of the prompt.
export function peakPromptTokens(calls) {
  return Math.max(0, ...calls.map((c) => (c.input ?? 0) + (c.cacheRead ?? 0) + (c.cacheWrite ?? 0)));
}
