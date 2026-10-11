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
    resolved.usageBaseURL = reviewer.usageBaseURL;
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

export function reviewPromptContract(input) {
  return {
    ...input,
    sources: Object.fromEntries(Object.entries(input.sources ?? {}).filter(([source]) => source !== 'diff' && !source.startsWith('file:'))),
  };
}

export function reviewerStorageConfiguration(path) {
  return {
    id: 'julia-reviewer-observability',
    path,
    memoryLimit: '1400MB',
    threads: 1,
    retention: { observability: { spans: { maxAge: '14d' } } },
  };
}

export function reviewerExporterConfiguration() {
  return { maxBatchSize: 100 };
}

export function reviewerDuckDBSettings() {
  return ['SET preserve_insertion_order = false', "PRAGMA force_compression = 'zstd'"];
}

export function reviewThread(cardId, commit) {
  if (!/^JUL-\d+$/.test(cardId ?? '') || !/^[0-9a-f]{40}$/i.test(commit ?? '')) throw new Error('reviewer memory needs a Julia card identifier and immutable commit');
  return `reviewer:${cardId}:${commit}`;
}

export function reviewStepBudget(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) throw new Error('reviewer needs at least one changed file');
  // Inventory, diff, one step per changed file, batched quote verification,
  // and the final structured report.
  return changedFiles.length + 4;
}

export function providerUsageIsUnknown({ attempted, observed, failures = 0, error }) {
  return observed < attempted || failures > 0 || /(?:usage\.(?:prompt_tokens|completion_tokens)|CommandCode response token usage).*missing or unknown/.test(error?.message ?? '');
}

export async function requireCostStoreReadable(read) {
  try { return await read(); }
  catch (error) { throw new Error('reviewer refused: cost store is unavailable; paid call blocked', { cause: error }); }
}

export function requireLiveTracing(context) {
  if (!context?.traceId || context.currentSpan?.isValid !== true) throw new Error('reviewer refused: tracing context is not live');
  return context;
}

export function requireCompleteFileReview(changedFiles, reviewedFiles) {
  const changed = [...changedFiles].sort();
  const reviewed = [...reviewedFiles].sort();
  const duplicate = reviewed.find((file, index) => file === reviewed[index - 1]);
  if (duplicate) throw new Error(`reviewer refused: duplicate ${duplicate}`);
  const missing = changed.find(file => !reviewed.includes(file));
  if (missing) throw new Error(`reviewer refused: missing ${missing}`);
  const unexpected = reviewed.find(file => !changed.includes(file));
  if (unexpected) throw new Error(`reviewer refused: unexpected ${unexpected}`);
  return reviewed;
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
