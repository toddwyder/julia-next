// price-table.mjs -- issue #180: single source of truth for model token rates
// and what-you-pay factors.
//
// Per model:
//   - fresh-input rate (per 1M tokens)
//   - cached-input rate (per 1M tokens)
//   - output rate (per 1M tokens, thinking/reasoning tokens count as output)
//   - provider pay factor:
//       * DeepSeek direct key: 1.0 (full rate)
//       * Command Code: 10/70 (~1/7 of face value, $10 buys $70 of credit)
//       * Subscriptions (ChatGPT/Codex, Gemini): 0.0 ($0 what-you-pay, tokens still shown)
//   - source URL (provider price page)
//   - date checked (ISO string)
//
// DeepSeek entry prices cached input lower than fresh input (fixing Mastra's
// bundled price list bug).

export const PRICE_TABLE = {
  // DeepSeek Direct API
  'deepseek/deepseek-v4-pro': {
    freshInputPerMillion: .66,
    cachedInputPerMillion: .022,
    outputPerMillion: 1.98,
    provider: 'deepseek',
    payFactor: 1.0,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
    peakMultiplier: 2,
  },
  'deepseek/deepseek-v4-flash': {
    freshInputPerMillion: .15,
    cachedInputPerMillion: .003,
    outputPerMillion: .6,
    provider: 'deepseek',
    payFactor: 1.0,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
    peakMultiplier: 2,
  },
  'deepseek/deepseek-flash': {
    freshInputPerMillion: .15,
    cachedInputPerMillion: .003,
    outputPerMillion: .6,
    provider: 'deepseek',
    payFactor: 1.0,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
    peakMultiplier: 2,
  },

  // Command Code's own advertised rates, paid from discounted credits.
  'commandcode/deepseek-v4-pro': {
    freshInputPerMillion: .66, cachedInputPerMillion: .022, outputPerMillion: 1.98,
    provider: 'commandcode', payFactor: 10 / 70,
    sourceUrl: 'https://commandcode.ai/models', dateChecked: '2026-10-01', peakMultiplier: 2,
  },
  'commandcode/deepseek-v4-flash': {
    freshInputPerMillion: .15, cachedInputPerMillion: .003, outputPerMillion: .6,
    provider: 'commandcode', payFactor: 10 / 70,
    sourceUrl: 'https://commandcode.ai/models', dateChecked: '2026-10-01', peakMultiplier: 2,
  },

  // OpenAI Subscriptions / Codex Sign-in (what-you-pay = $0)
  'openai/gpt-6-sol': {
    freshInputPerMillion: 2,
    cachedInputPerMillion: .2,
    outputPerMillion: 10,
    provider: 'openai',
    payFactor: 0,
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6-sol',
    dateChecked: '2026-10-01',
    longContextThreshold: 272000,
  },
  'openai/gpt-4o': {
    freshInputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    dateChecked: '2026-10-01',
  },
  'openai/gpt-4o-mini': {
    freshInputPerMillion: 0.15,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 0.60,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    dateChecked: '2026-10-01',
  },
  'openai/o1': {
    freshInputPerMillion: 15.00,
    cachedInputPerMillion: 7.50,
    outputPerMillion: 60.00,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    dateChecked: '2026-10-01',
  },
  'openai/o3-mini': {
    freshInputPerMillion: 1.10,
    cachedInputPerMillion: 0.55,
    outputPerMillion: 4.40,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    dateChecked: '2026-10-01',
  },

  // Google Subscriptions (Gemini) (what-you-pay = $0)
  'google/gemini-2.5-flash': {
    freshInputPerMillion: .30,
    cachedInputPerMillion: .03,
    outputPerMillion: 2.50,
    provider: 'google',
    payFactor: 0.0,
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    dateChecked: '2026-10-01',
  },
  'google/gemini-2.5-pro': {
    freshInputPerMillion: 1.25,
    cachedInputPerMillion: .125,
    outputPerMillion: 10.00,
    provider: 'google',
    payFactor: 0.0,
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    dateChecked: '2026-10-01',
  },

  // Anthropic Direct API. Retired models with unverified current rates are gaps.
  'anthropic/claude-sonnet-4-6': {
    freshInputPerMillion: 3, cachedInputPerMillion: .30, outputPerMillion: 15,
    provider: 'anthropic', payFactor: 1,
    sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing', dateChecked: '2026-10-01',
  },

  // OpenRouter (1.0 pay factor)
  'openrouter/deepseek/deepseek-chat': {
    freshInputPerMillion: .2574,
    cachedInputPerMillion: null,
    outputPerMillion: 1.0287,
    provider: 'openrouter',
    payFactor: 1.0,
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    dateChecked: '2026-10-01',
  },
  'openrouter/deepseek/deepseek-r1': {
    freshInputPerMillion: .70,
    cachedInputPerMillion: null,
    outputPerMillion: 2.50,
    provider: 'openrouter',
    payFactor: 1.0,
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    dateChecked: '2026-10-01',
  },
  'openrouter/openai/gpt-4o': {
    freshInputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
    provider: 'openrouter',
    payFactor: 1.0,
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    dateChecked: '2026-10-01',
  },
};

const CANONICAL_PREFIXES = [
  { prefix: 'openai/', test: (m) => /^(gpt-|o1|o3|chatgpt)/i.test(m) },
  { prefix: 'anthropic/', test: (m) => /^claude/i.test(m) },
  { prefix: 'deepseek/', test: (m) => /^deepseek/i.test(m) },
  { prefix: 'google/', test: (m) => /^gemini/i.test(m) },
];

/**
 * Find model price entry by model ID or normalized name and optional provider.
 */
export function getModelPrice(modelId, provider, priceTable = PRICE_TABLE) {
  if (!modelId || typeof modelId !== 'string') return null;
  const normalized = modelId.toLowerCase().trim();

  if (provider) {
    const prov = provider.toLowerCase().trim().replace(/^openai\.(responses|chat)$/, 'openai');
    const bare = normalized.replace(/^[^/]+\//, '');
    const qualified = priceTable[`${prov}/${normalized}`] ?? priceTable[`${prov}/${bare}`];
    if (qualified) return qualified;
    // An explicit transport provider must not borrow another provider's rate.
    if (!normalized.startsWith(`${prov}/`)) return null;
  }
  if (priceTable[normalized]) return priceTable[normalized];
  if (!normalized.includes('/')) {
    const canonical = CANONICAL_PREFIXES.find(({ test }) => test(normalized));
    return canonical ? priceTable[`${canonical.prefix}${normalized}`] ?? null : null;
  }
  return null;
}

/**
 * Calculate token counts, face cost, and what-you-pay cost for a model usage record.
 * Thinking/reasoning tokens count as output tokens.
 *
 * @param {{
 *   model: string,
 *   usage?: {
 *     inputTokens?: number,
 *     promptTokens?: number,
 *     cachedInputTokens?: number,
 *     inputDetails?: { cacheRead?: number },
 *     outputTokens?: number,
 *     completionTokens?: number,
 *     reasoningTokens?: number,
 *     outputDetails?: { reasoning?: number },
 *   },
 *   provider?: string,
 * }} input
 */
export function calculateModelCost({ model, usage, provider: requestedProvider, startedAt, priceTable = PRICE_TABLE }) {
  requestedProvider = typeof requestedProvider === 'string'
    ? requestedProvider.toLowerCase().trim().replace(/^openai\.(responses|chat)$/, 'openai')
    : requestedProvider;
  if (!usage || typeof usage !== 'object') {
    return { ok: false, error: 'no_token_count', model };
  }

  const rawInput = usage.inputTokens ?? usage.promptTokens;
  const rawOutput = usage.outputTokens ?? usage.completionTokens;

  if (typeof rawInput !== 'number' || typeof rawOutput !== 'number') {
    return { ok: false, error: 'no_token_count', model };
  }

  const totalInput = rawInput ?? 0;
  const cachedInputTokens = usage.cachedInputTokens ?? usage.inputDetails?.cacheRead ?? 0;
  const freshInputTokens = Math.max(0, totalInput - cachedInputTokens);
  const rawOutputTokens = rawOutput ?? 0;
  const thinkingTokens = usage.reasoningTokens ?? usage.outputDetails?.reasoning ?? 0;
  // Mastra's normalized AI SDK output is the total, including reasoning.
  const outputTokens = rawOutputTokens;
  if (![totalInput, cachedInputTokens, outputTokens, thinkingTokens].every(value => Number.isSafeInteger(value) && value >= 0) || cachedInputTokens > totalInput || thinkingTokens > outputTokens) {
    return { ok: false, error: 'invalid_token_count', model, freshInputTokens, cachedInputTokens, outputTokens, thinkingTokens };
  }

  const priceEntry = getModelPrice(model, requestedProvider, priceTable);
  if (!priceEntry) {
    return {
      ok: false,
      error: 'unpriced_model',
      model,
      freshInputTokens,
      cachedInputTokens,
      outputTokens,
      thinkingTokens,
    };
  }

  if (cachedInputTokens > 0 && !Number.isFinite(priceEntry.cachedInputPerMillion)) {
    return { ok: false, error: 'no_cached_input_price', model, freshInputTokens, cachedInputTokens, outputTokens, thinkingTokens };
  }
  // A cache write can use different TTL rates. Missing write pricing is a gap.
  if ((usage.inputDetails?.cacheWrite ?? 0) > 0) {
    return { ok: false, error: 'no_cache_write_price_context', model, freshInputTokens, cachedInputTokens, outputTokens, thinkingTokens };
  }

  const provider = requestedProvider ?? priceEntry.provider;
  const payFactor = requestedProvider === 'commandcode' ? (10 / 70) : priceEntry.payFactor;

  let rateFactor = 1;
  if (priceEntry.peakMultiplier) {
    const at = new Date(startedAt);
    // Verified calendar covers observability switch-on through end of 2026.
    // Future calendars and earlier price regimes are explicitly unmeasured.
    if (!Number.isFinite(at.getTime()) || at < new Date('2026-09-28T00:00:00Z') || at >= new Date('2027-01-01T00:00:00Z')) return { ok: false, error: 'no_price_window', model, freshInputTokens, cachedInputTokens, outputTokens, thinkingTokens };
    const day = at.toISOString().slice(0, 10);
    const holiday = day >= '2026-10-01' && day <= '2026-10-07';
    // DeepSeek explicitly defines 01:00-04:00 and 06:00-10:00 in UTC:
    // https://api-docs.deepseek.com/quick_start/pricing/ (pricing footnote 2).
    const hour = at.getUTCHours();
    const weekday = at.getUTCDay() >= 1 && at.getUTCDay() <= 5;
    if (weekday && !holiday && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))) rateFactor = priceEntry.peakMultiplier;
  }
  const longContext = totalInput > (priceEntry.longContextThreshold ?? (model.includes('gemini-2.5-pro') ? 200000 : Infinity));
  const freshCost = (freshInputTokens / 1_000_000) * priceEntry.freshInputPerMillion * rateFactor * (longContext ? 2 : 1);
  const cachedCost = (cachedInputTokens / 1_000_000) * (priceEntry.cachedInputPerMillion ?? 0) * rateFactor * (longContext ? 2 : 1);
  const outputCost = (outputTokens / 1_000_000) * priceEntry.outputPerMillion * rateFactor * (longContext ? 1.5 : 1);
  const faceCostUsd = freshCost + cachedCost + outputCost;
  const whatYouPayUsd = faceCostUsd * payFactor;

  return {
    ok: true,
    model,
    provider,
    freshInputTokens,
    cachedInputTokens,
    outputTokens,
    thinkingTokens,
    faceCostUsd,
    whatYouPayUsd,
    payFactor,
    freshInputPerMillion: priceEntry.freshInputPerMillion,
    cachedInputPerMillion: priceEntry.cachedInputPerMillion,
    outputPerMillion: priceEntry.outputPerMillion,
  };
}
