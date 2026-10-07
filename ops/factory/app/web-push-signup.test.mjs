import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createPushRoutes } from './src/mastra/push-routes.ts';

const origin = 'https://factory.example.test';
const first = { endpoint: 'https://fcm.googleapis.com/fcm/send/first', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } };
const second = { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/second', keys: { p256dh: 'c'.repeat(87), auth: 'd'.repeat(22) } };

function mounted(authenticated = true, userId = 'todd') {
  const saved = new Map();
  const store = {
    async put(user, subscription) { saved.set(`${user}:${subscription.endpoint}`, subscription); },
    async count(user) { return [...saved.keys()].filter(key => key.startsWith(`${user}:`)).length; },
  };
  const auth = { enabled: () => authenticated, ensureUser: async () => authenticated ? { id: userId } : undefined, tenant: () => authenticated ? { userId } : undefined };
  const app = new Hono();
  for (const route of createPushRoutes({ auth, store, origin, recipientUserId: 'todd', publicKey: 'public-key', allowedOrigins: ['https://fcm.googleapis.com', 'https://updates.push.services.mozilla.com'] })) {
    app.on(route.method, route.path, route.handler);
  }
  return { app, store };
}

test('authenticated Factory signup persists two independent devices', async () => {
  const { app, store } = mounted();
  const signup = await app.request('/web/push/signup');
  assert.equal(signup.status, 200);
  assert.match(await signup.text(), /public-key/);
  for (const subscription of [first, second, first]) {
    const response = await app.request('/web/push/subscriptions', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(subscription) });
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /fcm\.googleapis|p256dh|auth/);
  }
  assert.equal(await store.count('todd'), 2);
  const wrongOrigin = await app.request('/web/push/subscriptions', { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: JSON.stringify(first) });
  assert.equal(wrongOrigin.status, 403);
  const badEndpoint = await app.request('/web/push/subscriptions', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ ...first, endpoint: 'https://127.0.0.1/push' }) });
  assert.equal(badEndpoint.status, 400);
  const ipv6Endpoint = await app.request('/web/push/subscriptions', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ ...first, endpoint: 'https://[::1]/push' }) });
  assert.equal(ipv6Endpoint.status, 400);
  const { app: disabled } = mounted(false);
  assert.equal((await disabled.request('/web/push/signup')).status, 401);
  assert.equal((await disabled.request('/web/push/subscriptions', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(first) })).status, 401);
  const { app: other } = mounted(true, 'other-user');
  assert.equal((await other.request('/web/push/signup')).status, 403);
  assert.equal((await other.request('/web/push/subscriptions', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(first) })).status, 403);
});

test('service worker shows text notification and opens only the supplied link', async () => {
  const { app } = mounted();
  const response = await app.request('/web/push/sw.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.equal(response.headers.get('service-worker-allowed'), '/web/push/');
  const events = new Map();
  const notifications = [];
  const opened = [];
  const self = { addEventListener: (name, fn) => events.set(name, fn), registration: { showNotification: async (title, options) => notifications.push({ title, options }) }, clients: { matchAll: async () => [], openWindow: async link => opened.push(link) }, location: { origin } };
  const vm = await import('node:vm');
  vm.runInNewContext(await response.text(), { self, URL });
  let pending;
  events.get('push')({ data: { json: () => ({ line: '<b>Needs you</b>', link: `${origin}/factories/project/waits/1` }) }, waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(notifications[0].options.body, '<b>Needs you</b>');
  assert.equal(notifications[0].options.data.link, `${origin}/factories/project/waits/1`);
  events.get('notificationclick')({ notification: { data: { link: `${origin}/factories/project/waits/1` }, close() {} }, waitUntil: promise => { pending = promise; } });
  await pending;
  assert.deepEqual(opened, [`${origin}/factories/project/waits/1`]);
});
