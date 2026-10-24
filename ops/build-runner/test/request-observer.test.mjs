import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { observeRequests } from '../request-observer.mjs';

test('observing a stock streamed Request preserves its body for accounting and dispatch', async t => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(received));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/echo`;
  const requests = [];
  const source = new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-marker' }, body: JSON.stringify({ model: 'fixture', input: 'Keep this body', stream: true }) });
  const streamed = new Request(endpoint, { method: 'POST', headers: source.headers, body: source.body, duplex: 'half' });
  const response = await observeRequests(fetch, requests)(streamed);
  assert.deepEqual(await response.json(), { model: 'fixture', input: 'Keep this body', stream: true });
  assert.deepEqual(received, { model: 'fixture', input: 'Keep this body', stream: true });
  assert.deepEqual(requests, [{ model: 'fixture', method: 'POST', url: endpoint, status: 200 }]);
  assert.equal(JSON.stringify(requests).includes('synthetic-marker'), false);
});
