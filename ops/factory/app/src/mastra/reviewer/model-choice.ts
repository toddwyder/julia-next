const KNOWN_GATEWAYS = new Set(['commandcode', 'openrouter', 'litellm', 'proxy', 'custom', 'gateway']);

const MAKER_PATTERNS: Array<{ pattern: RegExp; maker: string }> = [
  { pattern: /^(deepseek)/i, maker: 'deepseek' },
  { pattern: /^(moonshot|kimi)/i, maker: 'moonshot' },
  { pattern: /^(openai|gpt|o[1-9]|chatgpt)/i, maker: 'openai' },
  { pattern: /^(anthropic|claude)/i, maker: 'anthropic' },
  { pattern: /^(google|gemini)/i, maker: 'google' },
  { pattern: /^(zai-org|z-ai|zhipu|glm)/i, maker: 'zhipu' },
  { pattern: /^(minimax)/i, maker: 'minimax' },
  { pattern: /^(xiaomi|mimo)/i, maker: 'xiaomi' },
  { pattern: /^(qwen|alibaba)/i, maker: 'qwen' },
  { pattern: /^(xai|grok)/i, maker: 'xai' },
  { pattern: /^(meta|llama|muse)/i, maker: 'meta' },
  { pattern: /^(mistral|codestral|pixtral)/i, maker: 'mistral' },
  { pattern: /^(cohere|command-r)/i, maker: 'cohere' },
];

/**
 * Extract the canonical AI maker / model family from a model identifier,
 * ignoring routing gateways like `commandcode/` or `openrouter/`.
 */
export function modelMaker(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Invalid model identifier: "${modelId}"`);
  }

  // Filter out leading gateways/routes if followed by more segments
  const nonGatewaySegments = segments.filter((seg, idx) => {
    if (idx === 0 && segments.length > 1 && KNOWN_GATEWAYS.has(seg)) {
      return false;
    }
    return true;
  });

  // Check each non-gateway segment against known maker patterns
  for (const seg of nonGatewaySegments) {
    for (const { pattern, maker } of MAKER_PATTERNS) {
      if (pattern.test(seg)) {
        return maker;
      }
    }
  }

  // Fallback: return the first non-gateway segment
  const fallback = nonGatewaySegments[0] ?? segments[0];
  if (!fallback) {
    throw new Error(`Invalid model identifier: "${modelId}"`);
  }
  return fallback;
}

export function builderModel(env: NodeJS.ProcessEnv = process.env): string {
  const builder = env.JULIA_BUILDER_MODEL?.trim();
  if (!builder) {
    throw new Error('JULIA_BUILDER_MODEL is required and must not be empty.');
  }
  if (!builder.includes('/')) {
    throw new Error(`Builder model must use a provider/model identifier: "${builder}"`);
  }
  return builder;
}

export function cheapModel(env: NodeJS.ProcessEnv = process.env): string {
  const cheap = env.JULIA_CHEAP_MODEL?.trim();
  if (!cheap) {
    throw new Error('JULIA_CHEAP_MODEL is required and must not be empty.');
  }
  if (!cheap.includes('/')) {
    throw new Error(`Cheap model must use a provider/model identifier: "${cheap}"`);
  }
  return cheap;
}

export function fallbackModel(env: NodeJS.ProcessEnv = process.env): string {
  const fallback = env.JULIA_FALLBACK_MODEL?.trim();
  if (!fallback) {
    throw new Error('JULIA_FALLBACK_MODEL is required and must not be empty.');
  }
  if (!fallback.includes('/')) {
    throw new Error(`Fallback model must use a provider/model identifier: "${fallback}"`);
  }
  return fallback;
}

export type ResolvedModel =
  | `${string}/${string}`
  | {
      id: `${string}/${string}`;
      url?: string;
      apiKey?: string;
      headers?: Record<string, string>;
    };

export function resolveLanguageModel(modelId: string, env: NodeJS.ProcessEnv = process.env): ResolvedModel {
  const trimmed = modelId.trim();
  if (!trimmed.includes('/')) {
    throw new Error(`Model identifier must use a provider/model format: "${modelId}"`);
  }
  if (env.COMMANDCODE_API_KEY?.trim() && !env.MASTRA_DISABLE_COMMANDCODE_ROUTER) {
    const baseURL = env.COMMANDCODE_BASE_URL?.trim() || 'https://api.commandcode.ai/provider/v1';
    const targetModel = (trimmed.startsWith('commandcode/') ? trimmed : `commandcode/${trimmed}`) as `${string}/${string}`;
    return {
      id: targetModel,
      url: baseURL,
      apiKey: env.COMMANDCODE_API_KEY.trim(),
    };
  }
  return trimmed as `${string}/${string}`;
}

export function reviewerModels(env: NodeJS.ProcessEnv = process.env): Array<{ model: ResolvedModel; maxRetries: number }> {
  const builder = builderModel(env);
  const builderMaker = modelMaker(builder);
  const rawReviewers = env.JULIA_REVIEWER_MODELS?.trim();
  if (!rawReviewers) {
    throw new Error('JULIA_REVIEWER_MODELS is required and must not be empty.');
  }
  const models = rawReviewers
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (models.length === 0 || models.some(model => !model.includes('/'))) {
    throw new Error('Builder and reviewer models must use provider/model identifiers.');
  }
  for (const model of models) {
    const reviewerMaker = modelMaker(model);
    if (reviewerMaker === builderMaker) {
      throw new Error(
        `Every reviewer model, including backups, must be from a different maker than the builder (${builderMaker}). Model '${model}' is from the same maker.`,
      );
    }
  }
  return models.map(model => ({
    model: resolveLanguageModel(model, env),
    maxRetries: 1,
  }));
}

export function validateModelSettings(env: NodeJS.ProcessEnv = process.env) {
  const builder = builderModel(env);
  const reviewers = reviewerModels(env);
  const cheap = cheapModel(env);
  const fallback = fallbackModel(env);
  const reviewerModelIds = env.JULIA_REVIEWER_MODELS!.split(',').map(m => m.trim()).filter(Boolean);
  return {
    builder,
    reviewerModels: reviewerModelIds,
    cheap,
    fallback,
  };
}

const SECRET_PATTERNS = [
  /(?:^|[\/\-_:])(?:sk|pk|ghp|gho|ghu|ghs|ghr|glpat|xox[baprs]|cf[_-])[a-zA-Z0-9_\-=]{10,}/i,
  /(?:bearer\s+|token\s+|auth(?:orization)?\s*:)/i,
  /(?:api[-_]?key|secret[-_]?key|access[-_]?token)\s*[:=]/i,
  /(?:^|\/)[a-f0-9]{40,}(?:$|\/)/i,
  /(?:^|[\/\-_:])(?:secret[-_]?key|password|credential)[a-zA-Z0-9_\-=]*/i,
];

export function formatModelReadback(settings: {
  builder: string;
  reviewerModels: string[];
  cheap: string;
  fallback: string;
}): string {
  const allModels = [settings.builder, ...settings.reviewerModels, settings.cheap, settings.fallback];
  for (const m of allModels) {
    for (const pat of SECRET_PATTERNS) {
      if (pat.test(m)) {
        throw new Error(`Potential secret key detected in model identifier: "${m}"`);
      }
    }
  }
  return `[Models] Configured models - builder: ${settings.builder}, reviewer: ${settings.reviewerModels.join(', ')}, cheap: ${settings.cheap}, fallback: ${settings.fallback}`;
}


