import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandCodeRequest } from './julia-commandcode-request.mjs';

const endpoint = 'https://api.commandcode.ai/provider/v1/chat/completions';
const secret = 'synthetic-provider-secret';

test('laptop request sends one authenticated request, denies redirects and redacts provider echoes', async () => {
  let calls = 0;
  const body = { model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: 'review supplied evidence' }], stream: false };
  const result = await commandCodeRequest({ endpoint, body }, { environment: { COMMANDCODE_API_KEY: secret }, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, endpoint);
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), body);
    return { status: 401, text: async () => `refused ${secret}` };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { httpStatus: 401, body: 'refused [REDACTED]' });
});

test('laptop review request rejects every output-token cap before it can reach CommandCode', async () => {
  for (const field of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) {
    const result = await commandCodeRequest({ endpoint, body: { model: 'deepseek/deepseek-v4-flash', [field]: 1 } }, {
      environment: { COMMANDCODE_API_KEY: secret },
      fetchImpl: () => assert.fail('a capped review request must not be dispatched'),
    });
    assert.deepEqual(result, { error: 'CommandCode review requests must not set an output-token cap', uncertain: false });
  }
});

test('missing or unresolved credentials and a foreign endpoint refuse before any network call', async () => {
  for (const [environment, url] of [[{}, endpoint], [{ COMMANDCODE_API_KEY: 'op://vault/item/key' }, endpoint], [{ COMMANDCODE_API_KEY: secret }, 'https://example.invalid/collect']]) {
    const result = await commandCodeRequest({ endpoint: url, body: {} }, { environment, fetchImpl: () => assert.fail('must not dispatch') });
    assert.equal(typeof result.error, 'string');
    assert.equal(result.uncertain, false);
  }
});

test('a failed request remains uncertain without retrying or logging credential-bearing exceptions', async () => {
  let calls = 0;
  const result = await commandCodeRequest({ endpoint, body: {} }, { environment: { COMMANDCODE_API_KEY: secret }, fetchImpl: async () => { calls++; throw Error(`Authorization: Bearer ${secret}`); } });
  assert.equal(calls, 1);
  assert.equal(result.uncertain, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('the real laptop child refuses unresolved vault references without echoing input or starting a request', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./julia-commandcode-request.mjs', import.meta.url))], {
    env: { ...process.env, COMMANDCODE_API_KEY: 'op://vault/item/key' }, input: JSON.stringify({ endpoint, body: { prompt: secret } }), encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).uncertain, false);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
});
