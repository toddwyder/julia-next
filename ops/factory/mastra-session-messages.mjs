// #211: the pinned Mastra CLI exposes this supported read as
// GET /memory/threads/:threadId/messages (route-metadata.generated.d.ts:851-861).
export const MASTRA_THREAD_MESSAGES_ROUTE = '/memory/threads';
const PAGE_SIZE = 100;
const MAX_PAGES = 200;

export async function readSessionMessages({ factoryUrl, threadId, resourceId, agentId, fetchImpl = fetch }) {
  if (!threadId) throw new Error('Mastra message read requires a thread id');
  const messages = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${factoryUrl.replace(/\/$/, '')}${MASTRA_THREAD_MESSAGES_ROUTE}/${encodeURIComponent(threadId)}/messages`);
    url.searchParams.set('page', String(page)); url.searchParams.set('perPage', String(PAGE_SIZE));
    if (resourceId) url.searchParams.set('resourceId', resourceId);
    if (agentId) url.searchParams.set('agentId', agentId);
    const response = await fetchImpl(url, { method: 'GET' });
    if (!response.ok) throw new Error(`Mastra message list returned HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.messages) || typeof body?.hasMore !== 'boolean') throw new Error('Mastra message list returned an unsupported shape');
    messages.push(...body.messages);
    if (!body.hasMore) return messages;
  }
  throw new Error('Mastra message list exceeded pagination limit');
}

export function readPackFallbackReasons(messages) {
  const reasons = [];
  for (const message of messages) for (const part of message?.content?.parts ?? message?.parts ?? []) {
    if (part?.type !== 'data-mastracode-pack-fallback') continue;
    const reason = part.data?.reason;
    if (reason !== 'pool-exhausted' && reason !== 'persistent-outage') throw new Error(`Unsupported persisted pack-fallback reason: ${reason}`);
    reasons.push(reason);
  }
  return reasons;
}
