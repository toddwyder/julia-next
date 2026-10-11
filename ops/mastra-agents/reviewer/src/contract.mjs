export const DEFAULT_REVIEWER = Object.freeze({
  provider: 'commandcode',
  model: 'deepseek/deepseek-v4.1-flash',
  connection: 'existing-commandcode',
  costCeilingUsd: 1,
});

export function reviewerConfiguration(configuration = {}) {
  const reviewer = configuration.reviewer ?? configuration;
  const savedConnection = reviewer.connection;
  return {
    ...DEFAULT_REVIEWER,
    model: reviewer.model ?? DEFAULT_REVIEWER.model,
    connection: savedConnection?.provider === 'commandcode' ? 'existing-commandcode' : savedConnection?.route ?? savedConnection ?? DEFAULT_REVIEWER.connection,
    costCeilingUsd: reviewer.costCeilingUsd ?? DEFAULT_REVIEWER.costCeilingUsd,
  };
}

export function requestWithoutOutputCap(body) {
  const request = { ...body };
  delete request.max_tokens;
  delete request.max_completion_tokens;
  delete request.max_output_tokens;
  return request;
}

export function memoryScope(cardId) {
  if (!/^JUL-\d+$/.test(cardId ?? '')) throw new Error('reviewer memory needs a Julia card identifier');
  return `reviewer:${cardId}`;
}

export function requireLiveTracing(context) {
  if (!context?.traceId || context.currentSpan?.isValid !== true) throw new Error('reviewer refused: tracing context is not live');
  return context;
}

// Reviewer memory is short-lived operational state.  Delete the thread before
// compacting the local database so a stopped review cannot bleed into another
// candidate or leave a steadily growing trace file on the laptop.
export async function purgeAndCompact({ memory, threadId, compact }) {
  await memory.deleteThread(threadId);
  await memory.settled();
  await compact();
}
