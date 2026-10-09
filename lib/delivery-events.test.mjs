import test from 'node:test';
import assert from 'node:assert/strict';
import { captureApplicationError, emitOperationalEvent } from './delivery-events.js';
test('application exception is captured and flushed, without request data', async () => {
  const calls = []; const error = Error('controlled Julia application error');
  const result = await captureApplicationError(error, { routePath: '/api/health', routeType: 'route' }, {
    env: { NEXT_PUBLIC_SENTRY_DSN: 'fixture' }, sentryImpl: {
      init: value => calls.push(value), captureException: (value, context) => { calls.push({ value, context }); return 'event-1'; }, flush: async () => true,
    },
  });
  assert.deepEqual(result, { status: 'sent', eventId: 'event-1' });
  assert.equal(calls[1].value, error); assert.equal(calls[0].sendDefaultPii, false);
  assert.deepEqual(calls[1].context.tags, { route: '/api/health', routeType: 'route' });
});
test('operational event allows selected fields and checks ingestion response', async () => {
  let request;
  const options = { env: { AXIOM_TOKEN: 'private-token', AXIOM_DATASET: 'runner' }, fetchImpl: async (url, value) => { request = { url, value }; return { ok: true, json: async () => ({ ingested: 1, failed: 0 }) }; } };
  assert.equal((await emitOperationalEvent({ issueId: 'JUL-1', stage: 'review', prompt: 'private source', token: 'private' }, options)).status, 'sent');
  const event = JSON.parse(request.value.body)[0];
  assert.equal(event.issueId, 'JUL-1'); assert.equal(event.stage, 'review'); assert.equal(event.prompt, undefined); assert.equal(event.token, undefined);
  options.fetchImpl = async () => ({ ok: false, status: 401 });
  assert.equal((await emitOperationalEvent({ stage: 'build' }, options)).status, 'failed');
});
test('missing configuration and vendor failures do not masquerade as successful proof', async () => {
  assert.equal((await captureApplicationError(Error('controlled'), {}, { env: {} })).status, 'unconfigured');
  assert.equal((await emitOperationalEvent({}, { env: {} })).status, 'unconfigured');
  assert.equal((await captureApplicationError(Error('controlled'), {}, { env: { NEXT_PUBLIC_SENTRY_DSN: 'fixture' }, sentryImpl: { init() { throw Error('private token'); } } })).status, 'failed');
});
