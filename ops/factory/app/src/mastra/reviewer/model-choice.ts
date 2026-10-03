/** Route prefixes that are not a model maker; the maker check looks through them. */
export const KNOWN_GATEWAYS = new Set(['command-code', 'commandcode', 'openrouter', 'litellm', 'proxy', 'custom', 'gateway']);

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

export const COMMAND_CODE_PROVIDER_NAME = 'Command Code';
export const COMMAND_CODE_PROVIDER_ID = 'command-code';
export const COMMAND_CODE_DEFAULT_URL = 'https://api.commandcode.ai/provider/v1';

export const SETTING_NAMES = {
  builder: 'JULIA_BUILDER_MODEL',
  reviewer: 'JULIA_REVIEWER_MODELS',
  cheap: 'JULIA_CHEAP_MODEL',
  fallback: 'JULIA_FALLBACK_MODEL',
} as const;

export class SettingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingValidationError';
    // Deliberately omit cause so Node's error renderer cannot output unredacted cause details.
    this.cause = undefined;
  }
}

const SECRET_PATTERNS = [
  /(?:^|[\/\-_:])(?:sk|pk|ghp|gho|ghu|ghs|ghr|glpat|xox[baprs]|cf[_-])[a-zA-Z0-9_\-=]{10,}/i,
  /(?:bearer\s+|token\s+|auth(?:orization)?\s*:)/i,
  /(?:api[-_]?key|secret[-_]?key|access[-_]?token)\s*[:=]/i,
  /(?:^|\/)[a-f0-9]{40,}(?:$|\/)/i,
  /(?:^|[\/\-_:])(?:secret[-_]?key|password|credential)[a-zA-Z0-9_\-=]*/i,
];

function environmentSecrets(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([key, value]) => Boolean(value?.trim()) && /(?:KEY|SECRET|TOKEN|PASSWORD|AUTH|CREDENTIAL)/i.test(key))
    .map(([, value]) => value!.trim())
    .filter(value => value.length >= 8);
}

export function looksLikeCredential(value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(value)) || environmentSecrets(env).some(secret => value.includes(secret));
}

export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let redacted = text;
  for (const secret of environmentSecrets(env)) redacted = redacted.split(secret).join('[redacted]');
  return redacted;
}

export function rejectCredentialLike(settingName: string, value: string, env: NodeJS.ProcessEnv = process.env): void {
  if (looksLikeCredential(value, env)) {
    throw new SettingValidationError(`${settingName} holds a credential-like value; it takes a model identifier only.`);
  }
}

/**
 * Extract the canonical AI maker / model family from a model identifier,
 * ignoring routing gateways like `command-code/`, `commandcode/`, or `openrouter/`.
 * Errors never echo the input string.
 */
export function modelMaker(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new SettingValidationError('Invalid model identifier.');
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
  const fallback = nonGatewaySegments[0] ?? segments[0];
  if (!fallback) {
    throw new SettingValidationError('Invalid model identifier.');
  }
  return fallback;
}

/** Read one single-model setting without echoing its value in error messages. */
function readModelSetting(settingName: string, env: NodeJS.ProcessEnv): string {
  const value = env[settingName]?.trim();
  if (!value) {
    throw new SettingValidationError(`${settingName} is required and must not be empty.`);
  }
  rejectCredentialLike(settingName, value, env);
  if (!value.includes('/')) {
    throw new SettingValidationError(`${settingName} must use a provider/model identifier.`);
  }
  return value;
}

/** True when the id names Command Code in custom-provider or gateway spelling. */
export function isCommandCodeRoute(modelId: string): boolean {
  const first = modelId.trim().toLowerCase().split('/')[0];
  return first === COMMAND_CODE_PROVIDER_ID || first === 'commandcode';
}

export function withoutCommandCodePrefix(modelId: string): string {
  const trimmed = modelId.trim();
  return isCommandCodeRoute(trimmed) ? trimmed.slice(trimmed.indexOf('/') + 1) : trimmed;
}

/**
 * Read the builder model directly from Factory's project storage or project setting.
 */
export async function getFactoryBuilderModel(
  storageOrProject?: any,
  projectName = 'julia-next',
): Promise<string | undefined> {
  if (!storageOrProject) return undefined;
  if (typeof storageOrProject === 'string') return storageOrProject;
  if (typeof storageOrProject.defaultModelId === 'string') return storageOrProject.defaultModelId;
  if (typeof storageOrProject.hasDomain === 'function' && storageOrProject.hasDomain('projects')) {
    const projects = storageOrProject.getDomain('projects');
    if (projects) {
      if (typeof projects.ensureReady === 'function') await projects.ensureReady();
      const allProjects = typeof projects.listAll === 'function' ? await projects.listAll() : [];
      const project = allProjects.find((p: any) => p.name === projectName) ?? allProjects[0];
      return project?.defaultModelId ?? undefined;
    }
  }
  return undefined;
}

export function builderModel(env: NodeJS.ProcessEnv = process.env): string {
  return readModelSetting(SETTING_NAMES.builder, env);
}

export function cheapModel(env: NodeJS.ProcessEnv = process.env): string {
  return readModelSetting(SETTING_NAMES.cheap, env);
}

export function fallbackModel(env: NodeJS.ProcessEnv = process.env): string {
  return readModelSetting(SETTING_NAMES.fallback, env);
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
    throw new SettingValidationError('COMMANDCODE_API_KEY is required when a Command Code model route is configured.');
  }
  return {
    id: `commandcode/${withoutCommandCodePrefix(modelId)}` as `${string}/${string}`,
    url: env.COMMANDCODE_BASE_URL?.trim() || COMMAND_CODE_DEFAULT_URL,
    apiKey,
  };
}

export function resolveLanguageModel(modelId: string, env: NodeJS.ProcessEnv = process.env): ResolvedModel {
  const trimmed = modelId.trim();
  if (!trimmed.includes('/')) {
    throw new SettingValidationError('Model identifier must use a provider/model format.');
  }
  if (env.COMMANDCODE_API_KEY?.trim() && !env.MASTRA_DISABLE_COMMANDCODE_ROUTER) {
    return commandCodeModelConfig(trimmed, env);
  }
  return trimmed as `${string}/${string}`;
}

export function cheapMemoryModel(env: NodeJS.ProcessEnv = process.env): ResolvedModel {
  const cheap = env.JULIA_CHEAP_MODEL?.trim() || env.DEFAULT_OM_MODEL_ID?.trim() || 'deepseek/deepseek-v4-flash';
  rejectCredentialLike('JULIA_CHEAP_MODEL', cheap, env);
  return isCommandCodeRoute(cheap) ? commandCodeModelConfig(cheap, env) : (cheap as `${string}/${string}`);
}

export function reviewerModels(
  env: NodeJS.ProcessEnv = process.env,
  builderModelOverride?: string,
): Array<{ model: ResolvedModel; maxRetries: number }> {
  const rawReviewers = env[SETTING_NAMES.reviewer]?.trim();
  if (!rawReviewers) {
    throw new SettingValidationError(`${SETTING_NAMES.reviewer} is required and must not be empty.`);
  }
  rejectCredentialLike(SETTING_NAMES.reviewer, rawReviewers, env);
  const models = rawReviewers
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  if (models.length === 0) {
    throw new SettingValidationError(`${SETTING_NAMES.reviewer} is required and must not be empty.`);
  }
  models.forEach((m, idx) => {
    rejectCredentialLike(`${SETTING_NAMES.reviewer} entry ${idx + 1}`, m, env);
    if (!m.includes('/')) {
      throw new SettingValidationError(`${SETTING_NAMES.reviewer} entry ${idx + 1} must use a provider/model identifier.`);
    }
  });

  const builder = builderModelOverride || env[SETTING_NAMES.builder]?.trim();
  if (builder) {
    rejectCredentialLike(SETTING_NAMES.builder, builder, env);
    const builderMaker = modelMaker(builder);
    models.forEach((m, idx) => {
      const reviewerMaker = modelMaker(m);
      if (reviewerMaker === builderMaker) {
        throw new SettingValidationError(
          `Every reviewer model, including backups, must be from a different maker than the builder (${builderMaker}). ` +
          `${SETTING_NAMES.reviewer} entry ${idx + 1} is from the same maker.`
        );
      }
    });
  }

  return models.map(m => ({
    model: resolveLanguageModel(m, env),
    maxRetries: 1,
  }));
}

export function validateModelSettings(
  env: NodeJS.ProcessEnv = process.env,
  options?: { builderModel?: string },
) {
  const builder = options?.builderModel || (env[SETTING_NAMES.builder]?.trim() ? builderModel(env) : undefined);
  const reviewers = reviewerModels(env, builder);
  const cheap = env[SETTING_NAMES.cheap]?.trim() ? cheapModel(env) : undefined;
  const fallback = env[SETTING_NAMES.fallback]?.trim() ? fallbackModel(env) : undefined;
  const reviewerModelIds = env[SETTING_NAMES.reviewer]!.split(',').map(m => m.trim()).filter(Boolean);
  return {
    builder: builder ?? 'factory-project-model',
    reviewerModels: reviewerModelIds,
    cheap: cheap ?? 'factory-memory-model',
    fallback: fallback ?? 'direct-key-fallback',
  };
}

export function formatModelReadback(
  settings: {
    builder?: string;
    reviewerModels?: string[];
    cheap?: string;
    fallback?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const entries: Array<[string, string | undefined]> = [
    [SETTING_NAMES.builder, settings.builder],
    ...(settings.reviewerModels ?? []).map((m, idx): [string, string] => [`${SETTING_NAMES.reviewer} entry ${idx + 1}`, m]),
    [SETTING_NAMES.cheap, settings.cheap],
    [SETTING_NAMES.fallback, settings.fallback],
  ];

  for (const [name, val] of entries) {
    if (val) rejectCredentialLike(name, val, env);
  }

  const parts = [
    settings.builder ? `builder: ${settings.builder}` : null,
    settings.reviewerModels?.length ? `reviewer: ${settings.reviewerModels.join(', ')}` : null,
    settings.cheap ? `cheap: ${settings.cheap}` : null,
    settings.fallback ? `fallback: ${settings.fallback}` : null,
  ].filter(Boolean);

  return `[Models] Configured models - ${parts.join(', ')}`;
}
