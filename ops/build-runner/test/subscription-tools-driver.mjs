import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openRunner } from '../adapter.mjs';

const options = JSON.parse(await readFile(process.argv[2], 'utf8'));
const requests = [];
globalThis.fetch = async request => {
  const wire = new Request(request);
  assert.equal(wire.url, 'https://chatgpt.com/backend-api/codex/responses');
  requests.push(await wire.json());
  return new Response(JSON.stringify({ error: { message: 'fixture ended after dispatch', type: 'invalid_request_error' }, usage: { input_tokens: 1, output_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } }), { status: 400, headers: { 'content-type': 'application/json' } });
};
const runner = await openRunner(options);
try {
  const receipt = await runner.run({ prompt: 'Reply with OK only.', maxTurns: 2, timeoutMs: 30000 });
  assert.ok(requests.length > 0, receipt.result.error?.message);
  for (const request of requests) {
    assert.ok(request.tools.some(tool => tool.type === 'function'));
    assert.deepEqual(request.tools.filter(tool => tool.type !== 'function'), []);
  }
  console.log('stock subscription dispatch contains local function tools only');
} finally { await runner.close(); }
