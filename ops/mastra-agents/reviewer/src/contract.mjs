export const DEFAULT_REVIEWER = Object.freeze({
  provider: 'commandcode',
  model: 'deepseek/deepseek-v4.1-flash',
  connection: 'existing-commandcode',
  costCeilingUsd: 1,
});

export function reviewerConfiguration(configuration = {}) {
  const reviewer = configuration.reviewer ?? configuration;
  const savedConnection = reviewer.connection;
  const resolved = {
    ...DEFAULT_REVIEWER,
    model: reviewer.model ?? DEFAULT_REVIEWER.model,
    connection: savedConnection?.provider === 'commandcode' ? 'existing-commandcode' : savedConnection?.route ?? savedConnection ?? DEFAULT_REVIEWER.connection,
    costCeilingUsd: reviewer.costCeilingUsd ?? DEFAULT_REVIEWER.costCeilingUsd,
  };
  if (process.env.MASTRA_REVIEWER_STANDIN === '1') {
    resolved.baseURL = reviewer.baseURL;
    resolved.storageDirectory = reviewer.storageDirectory;
  }
  return resolved;
}

export function requestWithoutOutputCap(body) {
  const request = { ...body };
  delete request.max_tokens;
  delete request.max_completion_tokens;
  delete request.max_output_tokens;
  return request;
}

export const REVIEWER_RESOURCE = 'julia-reviewer';

export function reviewThread(cardId, commit) {
  if (!/^JUL-\d+$/.test(cardId ?? '') || !/^[0-9a-f]{40}$/i.test(commit ?? '')) throw new Error('reviewer memory needs a Julia card identifier and immutable commit');
  return `reviewer:${cardId}:${commit}`;
}

export function requireLiveTracing(context) {
  if (!context?.traceId || context.currentSpan?.isValid !== true) throw new Error('reviewer refused: tracing context is not live');
  return context;
}

export async function finishReviewerRun({ memory, observability, primaryStorage, vectorStorage, observabilityStorage }) {
  const errors = [];
  for (const step of [
    () => memory.settled(),
    () => observability.flush(),
    () => primaryStorage.close(),
    () => vectorStorage?.close(),
    () => observabilityStorage.close(),
  ]) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'reviewer end-of-run failures');
}
