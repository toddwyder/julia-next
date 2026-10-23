// @mastra/code-sdk@1.14.0 dist/agents/mastracode-gateway.d.ts:
// MastraCodeGateway.resolveLanguageModel; @ai-sdk/openai-compatible@2.0.87
// docs/index.mdx: includeUsage. Observe the actual SDK-built request before
// network dispatch; do not fabricate a provider response or claim live usage.
import assert from 'node:assert/strict'
import test from 'node:test'
import { sdk } from './framework-runtime.mjs'

test('stock custom-provider streaming does not ask the provider for token usage', async () => {
  const { MastraCodeGateway } = await sdk('agents/mastracode-gateway.js')
  const originalFetch = globalThis.fetch
  const stopped = new Error('learning request stopped before network')
  const requests = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    requests.push({ url: request.url, body: JSON.parse(await request.text()) })
    throw stopped
  }
  try {
    const gateway = new MastraCodeGateway({
      mastraGatewayBaseUrl: 'https://example.invalid', routeThroughMastraGateway: false,
      customProviders: [{ name: 'Learning', url: 'https://example.invalid/v1', models: ['learning'] }],
    })
    const model = gateway.resolveLanguageModel({ providerId: 'learning', modelId: 'learning', apiKey: 'learning-marker' })
    await assert.rejects(model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'local request inspection' }] }] }), error => error === stopped)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://example.invalid/v1/chat/completions')
    assert.equal(requests[0].body.stream, true)
    assert.equal(requests[0].body.stream_options, undefined)
    console.log(JSON.stringify({ observedRequests: 1, networkDispatches: 0, stream: true, asksForUsage: false }))
  } finally { globalThis.fetch = originalFetch }
})
