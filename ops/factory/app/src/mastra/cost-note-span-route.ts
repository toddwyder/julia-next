import { registerApiRoute } from '@mastra/core/server';

function pick(source: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, (source as Record<string, unknown>)[key]]));
}

/** Return only the fields needed for cost accounting, before the response leaves Factory. */
export function costOnlySpan(span: Record<string, any>) {
  const attributes = pick(span.attributes, [
    'model', 'responseModel', 'selectedModel', 'provider', 'inputTokens', 'outputTokens',
    'cachedInputTokens', 'reasoningTokens', 'effort', 'effortLevel', 'sessionId',
    'conversationId', 'threadId',
  ]);
  const modelFromName = typeof span.name === 'string' ? /^llm:\s*([a-zA-Z0-9/_-]+)$/.exec(span.name)?.[1] : undefined;
  if (!attributes.model && modelFromName) attributes.model = modelFromName;
  const effort = span.attributes?.parameters?.reasoning?.effort ??
    span.attributes?.parameters?.reasoningEffort ?? span.attributes?.parameters?.reasoning_effort;
  if (!attributes.effort && typeof effort === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(effort)) attributes.effort = effort;
  attributes.usage = pick(span.attributes?.usage, [
    'inputTokens', 'promptTokens', 'cachedInputTokens', 'outputTokens', 'completionTokens', 'reasoningTokens',
  ]);
  const usage = span.attributes?.usage;
  if (usage?.inputDetails) (attributes.usage as Record<string, unknown>).inputDetails = pick(usage.inputDetails, ['cacheRead', 'cacheWrite']);
  if (usage?.outputDetails) (attributes.usage as Record<string, unknown>).outputDetails = pick(usage.outputDetails, ['reasoning']);
  attributes.costContext = pick(span.attributes?.costContext, ['model', 'provider']);
  attributes.inputDetails = pick(span.attributes?.inputDetails, ['cacheRead', 'cacheWrite']);
  attributes.outputDetails = pick(span.attributes?.outputDetails, ['reasoning']);
  return {
    ...pick(span, ['traceId', 'spanId', 'parentSpanId', 'spanType',
      'startedAt', 'endedAt', 'status', 'sessionId', 'threadId', 'runId']),
    metadata: pick(span.metadata, ['threadId', 'sessionId', 'runId', 'factory_stage', 'effort']),
    attributes,
    ...(span.error == null ? {} : { error: { message: 'model call failed; details retained on server' } }),
  };
}

export const costNoteSpanRoute = registerApiRoute('/julia/cost-traces/:traceId/spans/:spanId', {
  method: 'GET',
  requiresAuth: true,
  createHandler: async ({ mastra }) => async c => {
    const traceId = c.req.param('traceId');
    const spanId = c.req.param('spanId');
    try {
      const store = await mastra.getStorage()?.getStore('observability');
      if (!store) return c.json({ error: 'Observability storage unavailable' }, 503);
      const result = await store.getSpan({ traceId, spanId });
      if (!result?.span) return c.json({ error: 'Span not found' }, 404);
      return c.json({ span: costOnlySpan(result.span) });
    } catch {
      console.error(`[cost span read] ${JSON.stringify({ traceId, spanId })} failed`);
      return c.json({ error: 'Cost span read failed' }, 503);
    }
  },
});
