import { registerApiRoute } from '@mastra/core/server';
import type { ApiRoute } from '@mastra/core/server';
import { validateEndpoint } from './push-store.js';

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushRouteAuth = {
  enabled(): boolean;
  ensureUser(context: unknown): Promise<unknown>;
  tenant(context: unknown): { userId: string } | undefined;
};

export function createPushRoutes({ auth, store, origin, recipientUserId, publicKey, allowedOrigins }: {
  auth: PushRouteAuth;
  store: { put(user: string, subscription: Subscription): Promise<void> };
  origin: string;
  recipientUserId: string;
  publicKey: string;
  allowedOrigins: string[];
}): ApiRoute[] {
  const identity = async (context: unknown) => {
    if (!auth.enabled()) return undefined;
    await auth.ensureUser(context);
    return auth.tenant(context)?.userId;
  };
  return [
    registerApiRoute('/web/push/signup', {
      method: 'GET', requiresAuth: true,
      handler: async c => {
        const user = await identity(c);
        if (!user) return c.text('Unauthorized', 401);
        if (user !== recipientUserId) return c.text('Forbidden', 403);
        const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Factory notifications</title><main><h1>Factory notifications</h1><p>Enable notices for this device.</p><button id="enable">Enable notifications</button><p id="status" role="status"></p></main><script type="module">
const button = document.getElementById('enable');
const status = document.getElementById('status');
button.onclick = async () => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw Error('This browser does not support push notifications');
    if (await Notification.requestPermission() !== 'granted') throw Error('Notification permission was not granted');
    const registration = await navigator.serviceWorker.register('/web/push/sw.js', { scope: '/web/push/' });
    const key = '${publicKey}';
    const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const response = await fetch('/web/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(subscription) });
    if (!response.ok) throw Error('Could not save this device');
    status.textContent = 'Notifications enabled for this device';
  } catch (error) { status.textContent = error.message; }
};
</script></html>`;
        return c.html(html, 200, { 'Cache-Control': 'no-store' });
      },
    }),
    registerApiRoute('/web/push/sw.js', {
      method: 'GET', requiresAuth: false,
      handler: c => c.body(`self.addEventListener('push', event => {
  if (!event.data) return;
  const { line, link } = event.data.json();
  let target;
  try { target = new URL(link); } catch { return; }
  if (target.origin !== self.location.origin || !target.pathname.startsWith('/factories/')) return;
  event.waitUntil(self.registration.showNotification('Factory needs you', { body: line, data: { link: target.href } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target;
  try { target = new URL(event.notification.data.link); } catch { return; }
  if (target.origin !== self.location.origin || !target.pathname.startsWith('/factories/')) return;
  event.waitUntil(self.clients.openWindow(target.href));
});`, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Service-Worker-Allowed': '/web/push/', 'Cache-Control': 'no-store' }),
    }),
    registerApiRoute('/web/push/subscriptions', {
      method: 'POST', requiresAuth: true,
      handler: async c => {
        const user = await identity(c);
        if (!user) return c.text('Unauthorized', 401);
        if (user !== recipientUserId) return c.text('Forbidden', 403);
        if (c.req.header('origin') !== origin) return c.text('Forbidden', 403);
        let subscription: Subscription;
        try {
          subscription = await c.req.json();
          if (!subscription || typeof subscription !== 'object' ||
            typeof subscription.keys?.p256dh !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(subscription.keys.p256dh) ||
            typeof subscription.keys?.auth !== 'string' || !/^[A-Za-z0-9_-]{16,40}$/.test(subscription.keys.auth)) throw Error('invalid keys');
          validateEndpoint(subscription.endpoint, allowedOrigins);
        } catch {
          return c.text('Invalid subscription', 400);
        }
        await store.put(user, { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
        return c.json({ saved: true });
      },
    }),
  ];
}
