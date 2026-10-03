/** Route prefixes that are not a model maker; the maker check looks through them. */
const KNOWN_GATEWAYS = new Set(['command-code', 'commandcode', 'openrouter', 'litellm', 'proxy', 'custom', 'gateway']);

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
 * Factory's registered Command Code custom provider. The pinned @mastra/code-sdk
 * resolves the first segment of a model id as the provider, so a model reaches
 * Command Code only when its id starts with this provider's id
 * (`getCustomProviderId('Command Code')`). A bare `deepseek/...` id resolves to
 * the direct DeepSeek key.
 */
export const COMMAND_CODE_PROVIDER_NAME = 'Command Code';
export const COMMAND_CODE_PROVIDER_ID = 'command-code';
export const COMMAND_CODE_DEFAULT_URL = 'https://api.commandcode.ai/provider/v1';

const SETTING_NAMES = {
  builder: 'JULIA_BUILDER_MODEL',
  reviewer: 'JULIA_REVIEWER_MODELS',
  cheap: 'JULIA_CHEAP_MODEL',
  fallback: 'JULIA_FALLBACK_MODEL',
} as const;

/**
 * Extract the canonical AI maker / model family from a model identifier,
 * ignoring routing gateways like `command-code/` or `openrouter/`.
 * Errors never echo the identifier: it may be a pasted credential.
 */
export function modelMaker(modelId: string): string {
  const segments = modelId.trim().toLowerCase().split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('Invalid model identifier.');
  }

  // Filter out leading gateways/routes if followed by more segments
  const nonGatewaySegments = segments.filter((seg, idx) => !(idx === 0 && segments.length > 1 && KNOWN_GATEWAYS.has(seg)));

  // Check each non-gateway segment against known maker patterns
  for (const seg of nonGatewaySegments) {
    for (const { pattern, maker } of MAKER_PATTERNS) {
      if (pattern.test(seg)) {
        return maker;
      }
    }
  }

  // Fallback: return the first non-gateway segment
  return nonGatewaySegments[0] ?? segments[0]!;
}

const SECRET_PATTERNS = [
  /(?:^|[\/\-_:])(?:sk|pk|ghp|gho|ghu|ghs|ghr|glpat|xox[baprs]|cf[_-])[a-zA-Z0-9_\-=]{10,}/i,
  /(?:bearer\s+|token\s+|auth(?:orization)?\s*:)/i,
  /(?:api[-_]?key|secret[-_]?key|access[-_]?token)\s*[:=]/i,
  /(?:^|\/)[a-f0-9]{40,}(?:$|\/)/i,
  /(?:^|[\/\-_:])(?:secret[-_]?key|password|credential)[a-zA-Z0-9_\-=]*/i,
];

/** Values of every environment variable that looks like a credential (8+ characters). */
function environmentSecrets(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([key, value]) => Boolean(value?.trim()) && /(?:KEY|SECRET|TOKEN|PASSWORD|AUTH|CREDENTIAL)/i.test(key))
    .map(([, value]) => value!.trim())
    .filter(value => value.length >= 8);
}

function looksLikeCredential(value: string, env: NodeJS.ProcessEnv): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(value)) || environmentSecrets(env).some(secret => value.includes(secret));
}

/** Replace any environment credential inside free text, for logs and error messages. */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let redacted = text;
  for (const secret of environmentSecrets(env)) redacted = redacted.split(secret).join('[redacted]');
  return redacted;
}

function rejectCredentialLike(settingName: string, value: string, env: NodeJS.ProcessEnv): void {
  if (looksLikeCredential(value, env)) {
    throw new Error(`${settingName} holds a credential-like value; it takes a model identifier only.`);
  }
}

/** Read one single-model setting. Errors name the setting and never include its value. */
function readModelSetting(settingName: string, env: NodeJS.ProcessEnv): string {
  const value = env[settingName]?.trim();
  if (!value) {
    throw new Error(`${settingName} is required and must not be empty.`);
  }
  rejectCredentialLike(settingName, value, env);
  if (!value.includes('/')) {
    throw new Error(`${settingName} must use a provider/model identifier.`);
  }
  return value;
}

/** True when the id names Command Code, in the custom-provider spelling or the gateway spelling. */
export function isCommandCodeRoute(modelId: string): boolean {
  const first = modelId.trim().toLowerCase().split('/')[0];
  return first === COMMAND_CODE_PROVIDER_ID || first === 'commandcode';
}

/** The model id with its Command Code route prefix removed (`command-code/deepseek/x` -> `deepseek/x`). */
function withoutCommandCodePrefix(modelId: string): string {
  const trimmed = modelId.trim();
  return isCommandCodeRoute(trimmed) ? trimmed.slice(trimmed.indexOf('/') + 1) : trimmed;
}

function providerRoute(modelId: string): string {
  return isCommandCodeRoute(modelId) ? COMMAND_CODE_PROVIDER_ID : modelId.trim().toLowerCase().split('/')[0]!;
}

/** Factory's project model. Use the Command Code provider id as the first segment to go through Command Code. */
export function builderModel(env: NodeJS.ProcessEnv = process.env): string {
  return readModelSetting(SETTING_NAMES.builder, env);
}

/** The low-cost model for small judgment jobs; it feeds observational memory today. */
export function cheapModel(env: NodeJS.ProcessEnv = process.env): string {
  return readModelSetting(SETTING_NAMES.cheap, env);
}

/**
 * The direct pay-per-use model used when Command Code refuses a builder call
 * (#207 owns the switch). It must be a direct provider route: a Command Code
 * spelling would send the "fallback" back to the route it is escaping.
 */
export function fallbackModel(env: NodeJS.ProcessEnv = process.env): string {
  const fallback = readModelSetting(SETTING_NAMES.fallback, env);
  if (isCommandCodeRoute(fallback)) {
    throw new Error(`${SETTING_NAMES.fallback} must name a direct provider route, not Command Code.`);
  }
  return fallback;
}

/** Bare model ids the Command Code custom provider must offer so the configured routes resolve. */
export function commandCodeProviderModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const models = [builderModel(env), cheapModel(env)].filter(isCommandCodeRoute).map(withoutCommandCodePrefix);
  return [...new Set(models)];
}

export type ResolvedModel =
  | `${string}/${string}`
  | {
      id: `${string}/${string}`;
      url?: string;
      apiKey?: string;
      headers?: Record<string, string>;
    };

function commandCodeModelConfig(modelId: string, env: NodeJS.ProcessEnv): ResolvedModel {
  const apiKey = env.COMMANDCODE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('COMMANDCODE_API_KEY is required when a Command Code model route is configured.');
  }
  return {
    id: `commandcode/${withoutCommandCodePrefix(modelId)}` as `${string}/${string}`,
    url: env.COMMANDCODE_BASE_URL?.trim() || COMMAND_CODE_DEFAULT_URL,
    apiKey,
  };
}

/** Reviewer-agent routing: through Command Code's OpenAI-compatible endpoint when its key is present. */
export function resolveLanguageModel(modelId: string, env: NodeJS.ProcessEnv = process.env): ResolvedModel {
  const trimmed = modelId.trim();
  if (!trimmed.includes('/')) {
    throw new Error('Model identifier must use a provider/model format.');
  }
  if (env.COMMANDCODE_API_KEY?.trim() && !env.MASTRA_DISABLE_COMMANDCODE_ROUTER) {
    return commandCodeModelConfig(trimmed, env);
  }
  return trimmed as `${string}/${string}`;
}

/**
 * The cheap model as a Mastra core agent model config (for `Memory`). A Command
 * Code route becomes the OpenAI-compatible endpoint config; a direct id stays
 * a plain provider/model string.
 */
export function cheapMemoryModel(env: NodeJS.ProcessEnv = process.env): ResolvedModel {
  const cheap = cheapModel(env);
  return isCommandCodeRoute(cheap) ? commandCodeModelConfig(cheap, env) : (cheap as `${string}/${string}`);
}

export function reviewerModels(env: NodeJS.ProcessEnv = process.env): Array<{ model: ResolvedModel; maxRetries: number }> {
  const builder = builderModel(env);
  const builderMaker = modelMaker(builder);
  const rawReviewers = env[SETTING_NAMES.reviewer]?.trim();
  if (!rawReviewers) {
    throw new Error(`${SETTING_NAMES.reviewer} is required and must not be empty.`);
  }
  const models = rawReviewers
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (models.length === 0) {
    throw new Error(`${SETTING_NAMES.reviewer} is required and must not be empty.`);
  }
  models.forEach((model, index) => {
    rejectCredentialLike(`${SETTING_NAMES.reviewer} entry ${index + 1}`, model, env);
    if (!model.includes('/')) {
      throw new Error(`${SETTING_NAMES.reviewer} entry ${index + 1} must use a provider/model identifier.`);
    }
  });
  models.forEach((model, index) => {
    if (modelMaker(model) === builderMaker) {
      throw new Error(
        `Every reviewer model, including backups, must be from a different maker than the builder (${builderMaker}). ` +
          `${SETTING_NAMES.reviewer} entry ${index + 1} is from the same maker.`,
      );
    }
  });
  return models.map(model => ({
    model: resolveLanguageModel(model, env),
    maxRetries: 1,
  }));
}

export interface ModelSettings {
  builder: string;
  reviewerModels: string[];
  cheap: string;
  fallback: string;
}

export function validateModelSettings(env: NodeJS.ProcessEnv = process.env): ModelSettings {
  const builder = builderModel(env);
  reviewerModels(env);
  const cheap = cheapModel(env);
  const fallback = fallbackModel(env);
  if (providerRoute(builder) === providerRoute(fallback)) {
    throw new Error(
      `${SETTING_NAMES.builder} and ${SETTING_NAMES.fallback} must use different provider routes, ` +
        'or the fallback cannot tell Command Code apart from the direct key.',
    );
  }
  if ((isCommandCodeRoute(builder) || isCommandCodeRoute(cheap)) && !env.COMMANDCODE_API_KEY?.trim()) {
    throw new Error('COMMANDCODE_API_KEY is required when a Command Code model route is configured.');
  }
  return {
    builder,
    reviewerModels: env[SETTING_NAMES.reviewer]!.split(',').map(model => model.trim()).filter(Boolean),
    cheap,
    fallback,
  };
}

export function formatModelReadback(settings: ModelSettings, env: NodeJS.ProcessEnv = process.env): string {
  const fields: Array<[string, string]> = [
    [SETTING_NAMES.builder, settings.builder],
    ...settings.reviewerModels.map((model): [string, string] => [SETTING_NAMES.reviewer, model]),
    [SETTING_NAMES.cheap, settings.cheap],
    [SETTING_NAMES.fallback, settings.fallback],
  ];
  for (const [settingName, value] of fields) {
    rejectCredentialLike(settingName, value, env);
  }
  return `[Models] Configured models - builder: ${settings.builder}, reviewer: ${settings.reviewerModels.join(', ')}, cheap: ${settings.cheap}, fallback: ${settings.fallback}`;
}
