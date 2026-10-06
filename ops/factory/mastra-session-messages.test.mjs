import test from 'node:test';
import assert from 'node:assert/strict';

import { readPackFallbackReasons, readSessionMessages } from './mastra-session-messages.mjs';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('reads every page from Mastra\'s supported thread-message route', async () => {
  const calls = [];
  const messages = await readSessionMessages({
    factoryUrl: 'https://factory.example/', threadId: 'thread 1', resourceId: 'project', agentId: 'factory',
    fetchImpl: async (url) => { calls.push(new URL(url)); return response({ messages: [{ id: String(calls.length) }], hasMore: calls.length === 1 }); },
  });

  assert.deepEqual(messages.map((message) => message.id), ['1', '2']);
  assert.equal(calls[0].pathname, '/memory/threads/thread%201/messages');
  assert.equal(calls[0].searchParams.get('resourceId'), 'project');
  assert.equal(calls[1].searchParams.get('page'), '1');
});

test('counts only Mastra\'s validated persisted fallback marks by reason', () => {
  const reasons = readPackFallbackReasons([{ content: { parts: [
    { type: 'text', text: 'ignored' },
    { type: 'data-mastracode-pack-fallback', data: { reason: 'pool-exhausted' } },
    { type: 'data-mastracode-pack-fallback', data: { reason: 'persistent-outage' } },
  ] } }]);
  assert.deepEqual(reasons, ['pool-exhausted', 'persistent-outage']);
});

test('fails closed on an unfamiliar persisted fallback reason', () => {
  assert.throws(() => readPackFallbackReasons([{ parts: [{ type: 'data-mastracode-pack-fallback', data: { reason: 'rate-limit' } }] }]), /Unsupported/);
});
