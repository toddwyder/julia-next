const DEFAULT_REVIEWER_MODELS = 'deepseek/deepseek-v4-pro';

export function reviewerModels(env: NodeJS.ProcessEnv = process.env) {
  const builder = (env.JULIA_BUILDER_MODEL || 'openai/gpt-6-sol').trim();
  const builderMaker = builder.split('/')[0];
  const models = (env.JULIA_REVIEWER_MODELS || DEFAULT_REVIEWER_MODELS)
    .split(',').map(value => value.trim()).filter(Boolean);
  if (!builderMaker || models.length === 0 || models.some(model => !model.includes('/')))
    throw new Error('Builder and reviewer models must use provider/model identifiers.');
  if (models.some(model => model.split('/')[0] === builderMaker))
    throw new Error('Every reviewer model, including backups, must be from a different maker than the builder.');
  return models.map(model => ({ model: model as `${string}/${string}`, maxRetries: 1 }));
}
