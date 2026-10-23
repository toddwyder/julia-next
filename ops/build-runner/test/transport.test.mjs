import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CardLedger } from '../ledger.mjs';
import { createTransport } from '../transport.mjs';

const free = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const paid = { input: 2, output: 3, cacheRead: 1, cacheWrite: 4 };
async function fixture(t, handler) {
  const arrivals = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text ? req.headers['content-type']?.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text) : null;
    arrivals.push({ url: req.url, body });
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
function transport(f, overrides = {}, trial = true, extra = {}) {
  return createTransport({ ledger: f.ledger, role: 'builder', trial, settings: { models: { configured: { ...f.spec, ...overrides } }, ...extra } });
}
function send(fetch, endpoint, extra = {}) {
  return fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'wire', messages: [{ role: 'user', content: 'Hello' }], ...extra }) });
}
function json(res, body, status = 200) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }

test('free requests arrive with enforced limits and settle without usage', async t => {
  const f = await fixture(t, (_req, res) => json(res, { result: 'ok' }));
  const response = await send(transport(f), f.endpoint, { max_tokens: 999 });
  assert.equal((await response.json()).result, 'ok');
  assert.equal(f.arrivals[0].body.max_tokens, 10);
  assert.equal(f.ledger.snapshot().spentNano, 0);
  assert.equal(f.ledger.snapshot().requests[0].state, 'settled');
});

test('paid missing usage refuses result and prevents the next arrival', async t => {
  const f = await fixture(t, (_req, res) => json(res, { result: 'ok' }));
  const fetch = transport(f, { price: paid }, false);
  await assert.rejects(send(fetch, f.endpoint));
  await assert.rejects(send(fetch, f.endpoint));
  assert.equal(f.arrivals.length, 1);
  assert.equal(f.ledger.snapshot().heldNano, 430000);
  assert.equal(f.ledger.snapshot().pricedBlocked, true);
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
      await send(transport(f, { protocol, price: paid }, false), f.endpoint, { stream });
      const snapshot = f.ledger.snapshot();
      assert.equal(snapshot.spentNano, 25000);
      assert.deepEqual(snapshot.requests[0].usage, { input: 6, output: 2, cacheRead: 3, cacheWrite: 1 });
      if (protocol === 'responses') assert.equal(f.arrivals[0].body.max_output_tokens, 10);
      if (protocol === 'chat' && stream) assert.equal(f.arrivals[0].body.stream_options.include_usage, true);
    });
  }
}

test('wrong model, endpoint, missing prices and trial paid routes send nothing', async t => {
  const f = await fixture(t, (_req, res) => json(res, {}));
  await assert.rejects(send(transport(f), f.endpoint, { model: 'wrong' }));
  await assert.rejects(send(transport(f), `${f.endpoint}/wrong`));
  assert.throws(() => transport(f, { price: undefined }));
  assert.throws(() => transport(f, { maxInputTokens: undefined }));
  await assert.rejects(send(transport(f, { price: paid }), f.endpoint));
  assert.equal(f.arrivals.length, 0);
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

test('card ceiling refuses an oversized reservation before HTTP', async t => {
  const f = await fixture(t, (_req, res) => json(res, {}));
  await assert.rejects(send(transport(f, { price: paid, maxInputTokens: 300000 }, false), f.endpoint));
  assert.equal(f.arrivals.length, 0);
});

test('provider reported cost stops even a configured free route', async t => {
  const f = await fixture(t, (_req, res) => json(res, { usage: { cost: 0.01 } }));
  await assert.rejects(send(transport(f), f.endpoint), /STOP WORK/);
  assert.equal(f.ledger.snapshot().requests[0].state, 'unknown');
  await assert.rejects(send(transport(f), f.endpoint), /STOP WORK/);
  assert.equal(f.arrivals.length, 1);
  assert.equal(f.ledger.snapshot().stopped, true);
});

test('allowlisted authentication cannot carry inference payloads and redirects never follow', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(307, { location: '/second' }); res.end(); });
  const fetch = transport(f, {}, true, { networkAllow: [`${f.endpoint}/auth`] });
  await assert.rejects(send(fetch, `${f.endpoint}/auth`));
  assert.equal(f.arrivals.length, 0);
  await assert.rejects(send(fetch, f.endpoint));
  assert.equal(f.arrivals.length, 1);
  assert.equal(f.ledger.snapshot().requests[0].state, 'unknown');
});

for (const cache of [-1, 0.5]) {
  test(`invalid cache count ${cache} retains paid hold`, async t => {
    const f = await fixture(t, (_req, res) => json(res, { usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: cache, cache_write_tokens: 0 } } }));
    await assert.rejects(send(transport(f, { price: paid }, false), f.endpoint));
    assert.equal(f.ledger.snapshot().pricedBlocked, true);
  });
}

test('bounded buffering refuses a large result without releasing its reservation', async t => {
  const f = await fixture(t, (_req, res) => json(res, { result: 'x'.repeat(1000) }));
  await assert.rejects(send(transport(f, {}, true, { maxResponseBytes: 64 }), f.endpoint));
  assert.equal(f.ledger.snapshot().requests[0].state, 'unknown');
});

test('decimal rates round nano dollars upward without floating point drift', async t => {
  const f = await fixture(t, (_req, res) => json(res, { usage: { prompt_tokens: 7, completion_tokens: 0 } }));
  const price = { ...free, input: 0.001 };
  await send(transport(f, { price }, false), f.endpoint);
  assert.equal(f.ledger.snapshot().spentNano, 7);
  const tiny = await fixture(t, (_req, res) => json(res, { usage: { prompt_tokens: 3, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 1 } } }));
  const tinyPrice = { input: 0.0000001, output: 0.0000001, cacheRead: 0.0000001, cacheWrite: 0.0000001 };
  await send(transport(tiny, { price: tinyPrice }, false), tiny.endpoint);
  assert.equal(tiny.ledger.snapshot().spentNano, 1, 'round the complete request once');
});

test('ledger errors never reveal their underlying body or credentials', async t => {
  const f = await fixture(t, (_req, res) => json(res, {}));
  const fetch = createTransport({ ledger: { snapshot() { return { stopped: false }; }, reserve() { throw new Error('secret-example-value'); } }, role: 'builder', settings: { models: { configured: f.spec } } });
  await assert.rejects(send(fetch, f.endpoint), error => !error.message.includes('secret-example-value'));
  assert.equal(f.arrivals.length, 0);
});

test('authentication and catalog are confined to their exact allowlisted URL', async t => {
  const f = await fixture(t, (_req, res) => json(res, { ok: true }));
  const auth = `${f.endpoint}/auth`;
  const fetch = transport(f, {}, true, { networkAllow: [auth] });
  assert.equal((await fetch(auth)).status, 200);
  assert.equal((await fetch(auth, { method: 'POST', body: JSON.stringify({ token: 'opaque' }) })).status, 200);
  assert.equal((await fetch(auth, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=synthetic' })).status, 200);
  await assert.rejects(fetch(auth, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'model=hidden' }));
  await assert.rejects(fetch(`${auth}/child`));
  assert.equal(f.arrivals.length, 3);
  assert.equal(f.ledger.snapshot().requests.length, 0);
});

test('connection failure after arrival retains the paid reservation', async t => {
  const f = await fixture(t, (req) => req.socket.destroy());
  await assert.rejects(send(transport(f, { price: paid }, false), f.endpoint));
  assert.equal(f.arrivals.length, 1);
  assert.equal(f.ledger.snapshot().requests[0].state, 'unknown');
  assert.equal(f.ledger.snapshot().heldNano, 430000);
});

test('a truncated paid stream retains the reservation despite partial usage', async t => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
  });
  await assert.rejects(send(transport(f, { price: { ...free, input: 1 } }, false), f.endpoint));
  assert.equal(f.ledger.snapshot().pricedBlocked, true);
});

test('a configured unavailable model does not need invented prices and never dispatches', async t => {
  const f = await fixture(t, (_req, res) => json(res, { result: 'free works' }));
  const fetch = transport(f, {}, true, { models: { configured: f.spec, 'openai/gpt-6-sol': { wireModel: 'gpt-6-sol', unavailable: 'ChatGPT plan is not connected' } } });
  assert.equal((await send(fetch, f.endpoint)).status, 200);
  await assert.rejects(send(fetch, f.endpoint, { model: 'gpt-6-sol' }), /provider unavailable/);
  assert.equal(f.arrivals.length, 1);
  assert.equal(f.ledger.snapshot().spentNano, 0);
});
