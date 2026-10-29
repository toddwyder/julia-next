import test from 'node:test';
import assert from 'node:assert/strict';
import { listReady, getReadyCard } from './linear.js';

const card = (identifier, createdAt = '2026-10-28T00:00:00Z', state = 'Ready') => ({
  id: identifier, identifier, title: `Title ${identifier}`, createdAt,
  state: { name: state }, team: { name: 'Julia-next' },
});
const response = (nodes, pageInfo = { hasNextPage: false, endCursor: null }) =>
  Response.json({ data: { issues: { nodes, pageInfo } } });
const opts = fetchImpl => ({ apiKey: 'test-secret', fetchImpl });

test('reads every page fresh and sorts every Ready card newest first', async () => {
  const calls = [];
  const options = opts(async (_url, init) => {
    calls.push(init);
    const { variables, query } = JSON.parse(init.body);
    assert.match(query, /Julia-next/);
    assert.match(query, /Ready/);
    return variables.after === null
      ? response([card('JUL-1')], { hasNextPage: true, endCursor: 'next' })
      : response([card('JUL-2', '2026-10-29T00:00:00Z')]);
  });
  for (let i = 0; i < 2; i++) {
    assert.deepEqual((await listReady(options)).map(x => x.identifier), ['JUL-2', 'JUL-1']);
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every(x => x.cache === 'no-store'));
});

test('does not list cards outside Ready or Julia-next', async () => {
  await assert.rejects(listReady(opts(async () => response([card('JUL-3', undefined, 'Backlog')]))), /unexpected card/);
  const otherTeam = { ...card('JUL-3'), team: { name: 'Other' } };
  await assert.rejects(listReady(opts(async () => response([otherTeam]))), /unexpected card/);
});

test('only a valid empty response becomes an empty list', async () => {
  assert.deepEqual(await listReady(opts(async () => response([]))), []);
  for (const body of [{}, { data: {} }, { data: { issues: { nodes: [] } } }]) {
    await assert.rejects(listReady(opts(async () => Response.json(body))), /malformed/);
  }
  await assert.rejects(listReady(opts(async () => response([{ ...card('JUL-1'), title: null }]))), /unexpected card/);
});

test('names configuration, provider, HTTP and connection failures without leaking the key', async () => {
  await assert.rejects(listReady({ apiKey: '' }), /LINEAR_API_KEY/);
  await assert.rejects(listReady(opts(async () => Response.json({ errors: [{ message: 'Permission denied test-secret' }] }))), /Permission denied \[redacted\]/);
  await assert.rejects(listReady(opts(async () => new Response('unavailable', { status: 503 }))), /HTTP 503\.$/);
  await assert.rejects(listReady(opts(async () => { throw new Error('test-secret'); })), /could not reach Linear/);
});

test('non-2xx replies keep the provider explanation, stay bounded and survive non-JSON bodies', async () => {
  const reply = (body, status) => opts(async () => new Response(body, { status }));
  await assert.rejects(listReady(reply(JSON.stringify({ errors: [{ message: 'Field "team" is unknown test-secret' }] }), 400)), /HTTP 400\. Field "team" is unknown \[redacted\]/);
  await assert.rejects(listReady(reply('<html>Bad gateway</html>', 502)), /HTTP 502\.$/);
  await assert.rejects(listReady(reply('', 401)), /HTTP 401\.$/);
  const long = await listReady(reply(JSON.stringify({ errors: [{ message: 'x'.repeat(5000) }] }), 500)).catch(error => error);
  assert.match(long.message, /^Linear request failed\. HTTP 500\. x+$/);
  assert.ok(long.message.length < 500, `explanation should be bounded, got ${long.message.length} characters`);
});

test('replies that fail partway through are connection failures, not malformed JSON', async () => {
  const brokenReply = name => async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":{"issues":'));
      controller.error(Object.assign(new Error('reply broke'), { name }));
    },
  }), { status: 200 });
  await assert.rejects(listReady(opts(brokenReply('AbortError'))), /did not finish its reply within 10 seconds/);
  await assert.rejects(listReady(opts(brokenReply('Error'))), /ended its reply before it was complete/);
  await assert.rejects(listReady(opts(async () => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }); })), /could not reach Linear within 10 seconds/);
  const aborted = await listReady(opts(brokenReply('AbortError'))).catch(error => error);
  assert.doesNotMatch(aborted.message, /malformed/);
});

test('rejects broken pagination and duplicate cards instead of dropping cards', async () => {
  await assert.rejects(listReady(opts(async () => response([card('JUL-1')], { hasNextPage: true, endCursor: null }))), /pagination/);
  await assert.rejects(listReady(opts(async () => response([card('JUL-1')], { hasNextPage: true, endCursor: 'same' }))), /pagination|duplicate/);
});

test('Start lookup is a fresh read and rejects non-Ready or missing cards', async () => {
  assert.equal((await getReadyCard('JUL-1', opts(async () => response([card('JUL-1')])))).title, 'Title JUL-1');
  assert.equal(await getReadyCard('JUL-2', opts(async () => response([card('JUL-1')]))), null);
});
