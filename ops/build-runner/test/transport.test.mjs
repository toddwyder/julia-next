import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CardLedger } from '../ledger.mjs';
import { createTransport } from '../transport.mjs';

const free = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const paid = { input: 2, output: 3, cacheRead: 1, cacheWrite: 4 };

test('stock Claude conversation caching uses its configured one-hour API price', async t => {
  const { createPromptCacheMiddleware } = await import('@mastra/code-sdk/providers/claude-max');
  const model = {
    protocol: 'messages', maxInputTokens: 1000000, maxOutputTokens: 128000, cacheWriteTtl: '1h',
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.2 },
  };
  const transformed = await createPromptCacheMiddleware('conversation').transformParams({ params: {
    prompt: [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }],
  } });
  const cache_control = transformed.prompt[0].providerOptions.anthropic.cacheControl;
  assert.equal(cache_control.ttl, '1h');
  const f = await fixture(t, (_req, res) => json(res, { usage: {
    input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 10,
  } }));
  const request = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello', cache_control }] }] };
  await send(transport(f, { ...model, endpoint: f.endpoint, wireModel: 'wire' }), f.endpoint, request);
  assert.equal(f.ledger.snapshot().spentNano, 2500);
});
async function fixture(t, handler) {
  const arrivals = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text ? req.headers['content-type']?.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text) : null;
    arrivals.push({ url: req.url, headers: req.headers, body });
    handler(req, res, body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/infer`;
  const ledger = new CardLedger({ path: ':memory:', card: 'JUL-251' });
  t.after(() => ledger.close());
  const spec = { endpoint, wireModel: 'wire', protocol: 'chat', maxInputTokens: 100, maxOutputTokens: 10, price: free, source: 'fixture' };
  return { endpoint, arrivals, ledger, spec };
}
function transport(f, overrides = {}, extra = {}) {
  return createTransport({ ledger: f.ledger, role: 'builder', settings: { models: { configured: { ...f.spec, ...overrides } }, providerRetry: { attempts: 2, pauseMs: 0 }, ...extra } });
}
function send(fetch, endpoint, extra = {}) {
  return fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'wire', messages: [{ role: 'user', content: 'Hello' }], ...extra }) });
}
function json(res, body, status = 200) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }

test('free requests arrive with the model output bound and settle without usage', async t => {
  const f = await fixture(t, (_req, res) => json(res, { result: 'ok' }));
  const response = await send(transport(f), f.endpoint, { max_tokens: 999 });
  assert.equal((await response.json()).result, 'ok');
  assert.equal(f.arrivals[0].body.max_tokens, 10);
  assert.equal(f.ledger.snapshot().spentNano, 0);
  assert.equal(f.ledger.snapshot().requests[0].state, 'settled');
});

test('the request carries the model maximum where the protocol requires a number', async t => {
  const f = await fixture(t, (_req, res) => json(res, { usage: { input_tokens: 1, output_tokens: 1 } }));
  await send(transport(f, { protocol: 'responses', maxOutputTokens: 384000 }), f.endpoint, { input: 'hello', messages: undefined });
  assert.equal(f.arrivals[0].body.max_output_tokens, 384000);
});

test('paid missing usage refuses the result but does not block the next request', async t => {
  const f = await fixture(t, (_req, res) => json(res, { result: 'ok' }));
  const fetch = transport(f, { price: paid });
  await assert.rejects(send(fetch, f.endpoint), /provider down|outcome unavailable/);
  assert.equal(f.arrivals.length, 2);
  assert.equal(f.ledger.snapshot().stopped, false);
  assert.ok(f.ledger.snapshot().heldNano > 0);
  assert.equal(f.ledger.snapshot().requests.at(-1).state, 'unknown');
});

test('paid provider failure is retried after a pause and reported as down after the last attempt', async t => {
  const f = await fixture(t, (_req, res) => json(res, { error: { message: 'model route unavailable\nretry later' } }, 400));
  const fetch = transport(f, { price: paid }, { providerRetry: { attempts: 3, pauseMs: 0 } });
  await assert.rejects(send(fetch, f.endpoint), /provider down.*HTTP 400.*model route unavailable retry later/);
  assert.equal(f.arrivals.length, 3);
  assert.ok(f.ledger.snapshot().requests.every(request => request.state === 'settled' && request.costNano === 0));
});

test('a transient provider failure is retried and the eventual answer is settled once', async t => {
  let attempts = 0;
  const f = await fixture(t, (_req, res) => {
    attempts += 1;
    if (attempts < 3) return json(res, { error: { message: 'busy' } }, 503);
    return json(res, { usage: { prompt_tokens: 10, completion_tokens: 2 } });
  });
  const response = await send(transport(f, { price: { ...free, input: 2, output: 3 } }, { providerRetry: { attempts: 3, pauseMs: 0 } }), f.endpoint);
  assert.equal(response.status, 200);
  assert.equal(f.arrivals.length, 3);
  assert.equal(f.ledger.snapshot().requests.filter(request => request.state === 'settled').length, 3);
});

test('paid authentication rejection settles zero and remains visible for stock refresh retry', async t => {
  let attempts = 0;
  const f = await fixture(t, (_req, res) => {
    attempts += 1;
    if (attempts === 1) return json(res, { error: { message: 'expired' } }, 401);
    return json(res, { usage: { prompt_tokens: 10, completion_tokens: 2 } });
  });
  const fetch = transport(f, { price: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 } });
  assert.equal((await send(fetch, f.endpoint)).status, 401);
  assert.equal((await send(fetch, f.endpoint)).status, 200);
  const requests = f.ledger.snapshot().requests;
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(requests[0].costNano, 0);
  assert.equal(requests[1].state, 'settled');
});

test('priced requests count published token prices and positive provider charges', async t => {
  const f = await fixture(t, (_req, res) => json(res, {
    result: 'allowed', usage: { prompt_tokens: 10, completion_tokens: 2, cost_usd: 0.00002 },
  }));
  const fetch = transport(f, { price: { ...free, input: 1, output: 1 } });
  assert.equal((await (await send(fetch, f.endpoint)).json()).result, 'allowed');
  assert.equal(f.ledger.snapshot().spentNano, 20000);
  assert.equal(f.ledger.snapshot().stopped, false);
  await send(fetch, f.endpoint);
  assert.equal(f.ledger.snapshot().spentNano, 40000);
  assert.equal(f.arrivals.length, 2);
});

test('long-context price tiers determine both the reservation and the settled cost', async t => {
  const f = await fixture(t, (_req, res) => json(res, { usage: { prompt_tokens: 11, completion_tokens: 2 } }));
  await send(transport(f, { price: { ...free, input: 0.1, output: 0.1 }, priceTiers: [{ aboveInputTokens: 10, price: { ...free, input: 1, output: 1 } }] }), f.endpoint);
  assert.equal(f.ledger.snapshot().spentNano, 13000);
  assert.equal(f.ledger.snapshot().requests[0].maximumNano, 110000);
});

for (const protocol of ['chat', 'responses', 'messages']) {
  for (const stream of [false, true]) {
    test(`${protocol} ${stream ? 'SSE' : 'JSON'} settles cache categories once`, async t => {
      const raw = protocol === 'chat' ? { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 1 } }
        : protocol === 'responses' ? { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 1 } }
          : { input_tokens: 6, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 };
      const f = await fixture(t, (_req, res) => {
        if (!stream) return json(res, { usage: raw });
        const events = protocol === 'messages' ? [{ type: 'message_start', message: { usage: { ...raw, output_tokens: 0 } } }, { type: 'message_delta', usage: { output_tokens: 1 } }, { type: 'message_delta', usage: { output_tokens: 2 } }, { type: 'message_stop' }]
          : protocol === 'responses' ? [{ type: 'response.completed', response: { usage: raw } }]
            : [{ choices: [], usage: raw }];
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(events.map(event => `data:${JSON.stringify(event)}\r\n\r\n`).join('') + 'data: [DONE]\n\n');
      });
      await send(transport(f, { protocol, price: paid }), f.endpoint, { stream });
      const snapshot = f.ledger.snapshot();
      assert.equal(snapshot.spentNano, 25000);
      assert.deepEqual(snapshot.requests[0].usage, { input: 6, output: 2, cacheRead: 3, cacheWrite: 1 });
      if (protocol === 'responses') assert.equal(f.arrivals[0].body.max_output_tokens, 10);
      if (protocol === 'chat' && stream) assert.equal(f.arrivals[0].body.stream_options.include_usage, true);
    });
  }
}

test('wrong model, endpoint or missing bounds send nothing', async t => {
  const f = await fixture(t, (_req, res) => json(res, {}));
  await assert.rejects(send(transport(f), f.endpoint, { model: 'wrong' }));
  await assert.rejects(send(transport(f), `${f.endpoint}/wrong`));
  assert.throws(() => transport(f, { maxInputTokens: undefined }));
  assert.equal(f.arrivals.length, 0);
});

test('a model without a price is still reachable and records zero spend', async t => {
  const f = await fixture(t, (_req, res) => json(res, { usage: { prompt_tokens: 10, completion_tokens: 2 } }));
  const { price, ...unpriced } = f.spec;
  const response = await send(transport(f, unpriced), f.endpoint);
  assert.equal(response.status, 200);
  assert.equal(f.ledger.snapshot().spentNano, 0);
});

test('separate HTTP attempts create separate durable records', async t => {
  const f = await fixture(t, (_req, res) => json(res, {}, 503));
  const fetch = transport(f);
  assert.equal((await send(fetch, f.endpoint)).status, 503);
  assert.equal((await send(fetch, f.endpoint)).status, 503);
  assert.equal(f.arrivals.length, 2);
  assert.equal(f.ledger.snapshot().requests.length, 2);
  assert.notEqual(f.ledger.snapshot().requests[0].id, f.ledger.snapshot().requests[1].id);
});

test('an oversized reservation dispatches and is recorded without a card stop', async t => {
  const f = await fixture(t, (_req, res) => json(res, { usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } }));
  const response = await send(transport(f, { price: paid, maxInputTokens: 3000000 }), f.endpoint);
  assert.equal(response.status, 200);
  assert.equal(f.arrivals.length, 1);
  assert.ok(f.ledger.snapshot().requests[0].maximumNano > 10_000_000_000);
  assert.equal(f.ledger.snapshot().stopped, false);
  assert.ok(f.ledger.snapshot().spentNano > 0);
});

test('provider cost above a free reservation settles and continues', async t => {
  const f = await fixture(t, (_req, res) => json(res, { usage: { cost: 0.01 } }));
  const fetch = transport(f);
  assert.equal((await send(fetch, f.endpoint)).status, 200);
  assert.equal(f.ledger.snapshot().requests[0].state, 'settled');
  assert.equal(f.ledger.snapshot().spentNano, 10000000);
  assert.equal(f.ledger.snapshot().stopped, false);
  assert.equal((await send(fetch, f.endpoint)).status, 200);
  assert.equal(f.arrivals.length, 2);
});

test('requests that cannot be model calls pass through without an allowlist, and redirects never follow', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url.endsWith('/auth')) return json(res, { ok: true });
    res.writeHead(307, { location: '/second' });
    res.end();
  });
  const fetch = transport(f);
  assert.equal((await fetch(`${f.endpoint}/auth`)).status, 200);
  assert.equal((await fetch(`${f.endpoint}/auth`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=synthetic' })).status, 200);
  await assert.rejects(fetch(f.endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'model=hidden' }));
  await assert.rejects(send(fetch, f.endpoint));
  assert.ok(f.arrivals.some(arrival => arrival.url === '/infer'));
});

for (const cache of [-1, 0.5]) {
  test(`invalid cache count ${cache} records an unknown outcome without blocking later work`, async t => {
    const f = await fixture(t, (_req, res) => json(res, { usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: cache, cache_write_tokens: 0 } } }));
    const fetch = transport(f, { price: paid }, { providerRetry: { attempts: 1, pauseMs: 0 } });
    await assert.rejects(send(fetch, f.endpoint));
    assert.equal(f.ledger.snapshot().stopped, false);
    assert.ok(f.ledger.snapshot().heldNano > 0);
    await assert.rejects(send(fetch, f.endpoint));
    assert.equal(f.arrivals.length, 2);
  });
}

test('bounded buffering refuses a large result without releasing its reservation', async t => {
  const f = await fixture(t, (_req, res) => json(res, { result: 'x'.repeat(1000) }));
  await assert.rejects(send(transport(f, {}, { maxResponseBytes: 64 }), f.endpoint));
  assert.equal(f.ledger.snapshot().requests[0].state, 'unknown');
});

test('decimal rates round nano dollars upward without floating point drift', async t => {
  const f = await fixture(t, (_req, res) => json(res, { usage: { prompt_tokens: 7, completion_tokens: 0 } }));
  const price = { ...free, input: 0.001 };
  await send(transport(f, { price }), f.endpoint);
  assert.equal(f.ledger.snapshot().spentNano, 7);
  const tiny = await fixture(t, (_req, res) => json(res, { usage: { prompt_tokens: 3, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 1 } } }));
  const tinyPrice = { input: 0.0000001, output: 0.0000001, cacheRead: 0.0000001, cacheWrite: 0.0000001 };
  await send(transport(tiny, { price: tinyPrice }), tiny.endpoint);
  assert.equal(tiny.ledger.snapshot().spentNano, 1, 'round the complete request once');
});

test('ledger errors never reveal their underlying body or credentials', async t => {
  const f = await fixture(t, (_req, res) => json(res, {}));
  const fetch = createTransport({ ledger: { snapshot() { return { stopped: false }; }, reserve() { throw new Error('secret-example-value'); } }, role: 'builder', settings: { models: { configured: f.spec } } });
  await assert.rejects(send(fetch, f.endpoint), error => !error.message.includes('secret-example-value'));
  assert.equal(f.arrivals.length, 0);
});

test('connection failure after arrival records an unknown outcome and retries', async t => {
  let attempts = 0;
  const f = await fixture(t, (req) => { attempts += 1; req.socket.destroy(); });
  await assert.rejects(send(transport(f, { price: paid }, { providerRetry: { attempts: 2, pauseMs: 0 } }), f.endpoint), /provider down/);
  assert.equal(attempts, 2);
  assert.ok(f.ledger.snapshot().requests.every(request => request.state === 'unknown'));
});

test('a truncated paid stream records an unknown outcome', async t => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
  });
  await assert.rejects(send(transport(f, { price: { ...free, input: 1 } }), f.endpoint));
  assert.equal(f.ledger.snapshot().requests[0].state, 'unknown');
});

test('a stock Codex stream without a content-type header settles its completed usage', async t => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(200);
    res.end('event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":20,"output_tokens":9,"input_tokens_details":{"cached_tokens":0,"cache_write_tokens":0}}}}\n\n');
  });
  await send(transport(f, { protocol: 'responses', price: paid }), f.endpoint, { stream: true });
  assert.equal(f.ledger.snapshot().spentNano, 67000);
  assert.equal(f.ledger.snapshot().heldNano, 0);
  assert.equal(f.ledger.snapshot().requests[0].state, 'settled');
});

test('the reservation uses the model input bound and output maximum', async t => {
  const ledger = new CardLedger({ path: ':memory:', card: 'JUL-254' });
  try {
    const guarded = createTransport({ ledger, role: 'orchestrator', settings: { models: { fixture: {
      endpoint: 'https://example.invalid/infer', wireModel: 'fixture', protocol: 'chat', maxInputTokens: 272001, maxOutputTokens: 128000,
      price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      priceTiers: [{ aboveInputTokens: 272000, price: { input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 } }],
    } }, providerRetry: { attempts: 1, pauseMs: 0 } }, fetch: async () => { throw new Error('Deliberate local dispatch failure'); } });
    await assert.rejects(guarded('https://example.invalid/infer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"model":"fixture","messages":[{"role":"user","content":"Hello"}]}' }));
    assert.equal(ledger.snapshot().requests.at(-1).maximumNano, 3280005000);
    assert.equal(ledger.snapshot().heldNano, 3280005000);
  } finally { ledger.close(); }
});
