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
    freshInputPerMillion: 0.27,
    cachedInputPerMillion: 0.07,
    outputPerMillion: 1.10,
    provider: 'deepseek',
    payFactor: 1.0,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
  },
  'deepseek/deepseek-v4-flash': {
    freshInputPerMillion: 0.27,
    cachedInputPerMillion: 0.07,
    outputPerMillion: 1.10,
    provider: 'deepseek',
    payFactor: 1.0,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
  },
  'deepseek/deepseek-flash': {
    freshInputPerMillion: 0.27,
    cachedInputPerMillion: 0.07,
    outputPerMillion: 1.10,
    provider: 'deepseek',
    payFactor: 1.0,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
  },
  'deepseek/deepseek-chat': {
    freshInputPerMillion: 0.27,
    cachedInputPerMillion: 0.07,
    outputPerMillion: 1.10,
    provider: 'deepseek',
    payFactor: 1.0,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
  },
  'deepseek/deepseek-reasoner': {
    freshInputPerMillion: 0.55,
    cachedInputPerMillion: 0.14,
    outputPerMillion: 2.19,
    provider: 'deepseek',
    payFactor: 1.0,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
  },
  'deepseek/deepseek-r1': {
    freshInputPerMillion: 0.55,
    cachedInputPerMillion: 0.14,
    outputPerMillion: 2.19,
    provider: 'deepseek',
    payFactor: 1.0,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
  },

  // Command Code (1/7 of face value)
  'commandcode/claude-3-7-sonnet': {
    freshInputPerMillion: 3.00,
    cachedInputPerMillion: 0.30,
    outputPerMillion: 15.00,
    provider: 'commandcode',
    payFactor: 10 / 70,
    sourceUrl: 'https://www.anthropic.com/pricing',
    dateChecked: '2026-10-01',
  },
  'commandcode/claude-3-5-sonnet': {
    freshInputPerMillion: 3.00,
    cachedInputPerMillion: 0.30,
    outputPerMillion: 15.00,
    provider: 'commandcode',
    payFactor: 10 / 70,
    sourceUrl: 'https://www.anthropic.com/pricing',
    dateChecked: '2026-10-01',
  },
  'commandcode/gpt-4o': {
    freshInputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
    provider: 'commandcode',
    payFactor: 10 / 70,
    sourceUrl: 'https://openai.com/api/pricing/',
    dateChecked: '2026-10-01',
  },
  'commandcode/deepseek-chat': {
    freshInputPerMillion: 0.27,
    cachedInputPerMillion: 0.07,
    outputPerMillion: 1.10,
    provider: 'commandcode',
    payFactor: 10 / 70,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    dateChecked: '2026-10-01',
  },

  // OpenAI Subscriptions / Codex Sign-in (what-you-pay = $0)
  'openai/gpt-6-sol': {
    freshInputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://openai.com/api/pricing/',
    dateChecked: '2026-10-01',
  },
  'openai/gpt-4o': {
    freshInputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://openai.com/api/pricing/',
    dateChecked: '2026-10-01',
  },
  'openai/gpt-4o-mini': {
    freshInputPerMillion: 0.15,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 0.60,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://openai.com/api/pricing/',
    dateChecked: '2026-10-01',
  },
  'openai/o1': {
    freshInputPerMillion: 15.00,
    cachedInputPerMillion: 7.50,
    outputPerMillion: 60.00,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://openai.com/api/pricing/',
    dateChecked: '2026-10-01',
  },
  'openai/o3-mini': {
    freshInputPerMillion: 1.10,
    cachedInputPerMillion: 0.55,
    outputPerMillion: 4.40,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://openai.com/api/pricing/',
    dateChecked: '2026-10-01',
  },
  'openai/codex': {
    freshInputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
    provider: 'openai',
    payFactor: 0.0,
    sourceUrl: 'https://openai.com/api/pricing/',
    dateChecked: '2026-10-01',
  },

  // Google Subscriptions (Gemini) (what-you-pay = $0)
  'google/gemini-2.5-flash': {
    freshInputPerMillion: 0.10,
    cachedInputPerMillion: 0.025,
    outputPerMillion: 0.40,
    provider: 'google',
    payFactor: 0.0,
    sourceUrl: 'https://ai.google.dev/pricing',
    dateChecked: '2026-10-01',
  },
  'google/gemini-2.5-pro': {
    freshInputPerMillion: 1.25,
    cachedInputPerMillion: 0.3125,
    outputPerMillion: 5.00,
    provider: 'google',
    payFactor: 0.0,
    sourceUrl: 'https://ai.google.dev/pricing',
    dateChecked: '2026-10-01',
  },
  'google/gemini-1.5-flash': {
    freshInputPerMillion: 0.075,
    cachedInputPerMillion: 0.01875,
    outputPerMillion: 0.30,
    provider: 'google',
    payFactor: 0.0,
    sourceUrl: 'https://ai.google.dev/pricing',
    dateChecked: '2026-10-01',
  },
  'google/gemini-1.5-pro': {
    freshInputPerMillion: 1.25,
    cachedInputPerMillion: 0.3125,
    outputPerMillion: 5.00,
    provider: 'google',
    payFactor: 0.0,
    sourceUrl: 'https://ai.google.dev/pricing',
    dateChecked: '2026-10-01',
  },

  // Anthropic Direct API
  'anthropic/claude-3-7-sonnet': {
    freshInputPerMillion: 3.00,
    cachedInputPerMillion: 0.30,
    outputPerMillion: 15.00,
    provider: 'anthropic',
    payFactor: 1.0,
    sourceUrl: 'https://www.anthropic.com/pricing',
    dateChecked: '2026-10-01',
  },
  'anthropic/claude-3-5-sonnet': {
    freshInputPerMillion: 3.00,
    cachedInputPerMillion: 0.30,
    outputPerMillion: 15.00,
    provider: 'anthropic',
    payFactor: 1.0,
    sourceUrl: 'https://www.anthropic.com/pricing',
    dateChecked: '2026-10-01',
  },
  'anthropic/claude-3-5-haiku': {
    freshInputPerMillion: 0.80,
    cachedInputPerMillion: 0.08,
    outputPerMillion: 4.00,
    provider: 'anthropic',
    payFactor: 1.0,
    sourceUrl: 'https://www.anthropic.com/pricing',
    dateChecked: '2026-10-01',
  },
  'anthropic/claude-3-opus': {
    freshInputPerMillion: 15.00,
    cachedInputPerMillion: 1.50,
    outputPerMillion: 75.00,
    provider: 'anthropic',
    payFactor: 1.0,
    sourceUrl: 'https://www.anthropic.com/pricing',
    dateChecked: '2026-10-01',
  },

  // OpenRouter (1.0 pay factor)
  'openrouter/deepseek/deepseek-chat': {
    freshInputPerMillion: 0.27,
    cachedInputPerMillion: 0.07,
    outputPerMillion: 1.10,
    provider: 'openrouter',
    payFactor: 1.0,
    sourceUrl: 'https://openrouter.ai/models',
    dateChecked: '2026-10-01',
  },
  'openrouter/deepseek/deepseek-r1': {
    freshInputPerMillion: 0.55,
    cachedInputPerMillion: 0.14,
    outputPerMillion: 2.19,
    provider: 'openrouter',
    payFactor: 1.0,
    sourceUrl: 'https://openrouter.ai/models',
    dateChecked: '2026-10-01',
  },
  'openrouter/anthropic/claude-3.5-sonnet': {
    freshInputPerMillion: 3.00,
    cachedInputPerMillion: 0.30,
    outputPerMillion: 15.00,
    provider: 'openrouter',
    payFactor: 1.0,
    sourceUrl: 'https://openrouter.ai/models',
    dateChecked: '2026-10-01',
  },
  'openrouter/openai/gpt-4o': {
    freshInputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
    provider: 'openrouter',
    payFactor: 1.0,
    sourceUrl: 'https://openrouter.ai/models',
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
export function getModelPrice(modelId, provider) {
  if (!modelId || typeof modelId !== 'string') return null;
  const normalized = modelId.toLowerCase().trim();

  if (provider) {
    const prov = provider.toLowerCase().trim();
    if (PRICE_TABLE[`${prov}/${normalized}`]) return PRICE_TABLE[`${prov}/${normalized}`];
    const withoutPrefix = normalized.replace(/^[^/]+\//, '');
    if (PRICE_TABLE[`${prov}/${withoutPrefix}`]) return PRICE_TABLE[`${prov}/${withoutPrefix}`];
  }

  const direct = PRICE_TABLE[normalized];
  if (direct) return direct;

  // Try canonical provider prefix if bare model name
  if (!normalized.includes('/')) {
    for (const { prefix, test } of CANONICAL_PREFIXES) {
      if (test(normalized) && PRICE_TABLE[`${prefix}${normalized}`]) {
        return PRICE_TABLE[`${prefix}${normalized}`];
      }
    }
  }

  // Exact suffix match on canonical providers first
  for (const [key, entry] of Object.entries(PRICE_TABLE)) {
    if (entry.provider !== 'commandcode' && (key.endsWith(`/${normalized}`) || key.replace(/^[^/]+\//, '') === normalized)) {
      return entry;
    }
  }

  // Fallback match
  for (const [key, entry] of Object.entries(PRICE_TABLE)) {
    if (key === normalized || key.endsWith(`/${normalized}`) || key.replace(/^[^/]+\//, '') === normalized) {
      return entry;
    }
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
export function calculateModelCost({ model, usage, provider: requestedProvider }) {
  if (!usage || typeof usage !== 'object') {
    return { ok: false, error: 'no_token_count', model };
  }

  const rawInput = usage.inputTokens ?? usage.promptTokens;
  const rawOutput = usage.outputTokens ?? usage.completionTokens;

  if (typeof rawInput !== 'number' && typeof rawOutput !== 'number') {
    return { ok: false, error: 'no_token_count', model };
  }

  const totalInput = rawInput ?? 0;
  const cachedInputTokens = usage.cachedInputTokens ?? usage.inputDetails?.cacheRead ?? 0;
  const freshInputTokens = Math.max(0, totalInput - cachedInputTokens);
  const rawOutputTokens = rawOutput ?? 0;
  const thinkingTokens = usage.reasoningTokens ?? usage.outputDetails?.reasoning ?? 0;
  const outputTokens = rawOutputTokens >= thinkingTokens ? rawOutputTokens : (rawOutputTokens + thinkingTokens);

  const priceEntry = getModelPrice(model, requestedProvider);
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

  const provider = requestedProvider ?? priceEntry.provider;
  const payFactor = requestedProvider === 'commandcode' ? (10 / 70) : priceEntry.payFactor;

  const freshCost = (freshInputTokens / 1_000_000) * priceEntry.freshInputPerMillion;
  const cachedCost = (cachedInputTokens / 1_000_000) * priceEntry.cachedInputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * priceEntry.outputPerMillion;
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
