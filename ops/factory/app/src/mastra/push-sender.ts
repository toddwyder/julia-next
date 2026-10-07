import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { validateEndpoint, validateFactoryLink, type PushStore } from './push-store.js';

export type PushEvent = { line: string; link: string; eventKey: string };
type Transport = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, ttl: number) => Promise<void>;

type SenderOptions = {
  db: Pick<Pool, 'query'>;
  store: PushStore;
  transport: Transport;
  origin: string;
  recipientUserId: string;
  allowedOrigins: string[];
  now?: () => Date;
  log?: (message: string) => void;
};

export async function sendPushEvent(event: PushEvent, { db, store, transport, origin, recipientUserId, allowedOrigins, now = () => new Date(), log = console.info }: SenderOptions): Promise<void> {
  if (typeof event.line !== 'string' || !event.line.trim() || event.line.length > 500 ||
      typeof event.eventKey !== 'string' || !event.eventKey.trim() || event.eventKey.length > 200) throw Error('invalid push event');
  validateFactoryLink(event.link, origin);
  const key = createHash('sha256').update(event.eventKey).digest('hex');
  const devices = await db.query('SELECT id, encrypted_subscription FROM factory_push_subscriptions WHERE active AND user_id = $1', [recipientUserId]);
  for (const device of devices.rows) {
    const claimed = await db.query(`INSERT INTO factory_push_deliveries (event_key, device_id, status)
      VALUES ($1, $2, 'unresolved')
      ON CONFLICT (event_key, device_id) DO UPDATE SET
        status = 'unresolved', attempts = factory_push_deliveries.attempts + 1,
        retry_at = NULL, updated_at = now()
      WHERE factory_push_deliveries.status = 'rejected'
        AND factory_push_deliveries.attempts < 3
        AND factory_push_deliveries.retry_at <= $3
      RETURNING attempts`, [key, device.id, now()]);
    if (!claimed.rows.length) continue;
    let outcome: 'accepted' | 'rejected' | 'expired' | 'unresolved' = 'unresolved';
    let retryAt: Date | null = null;
    try {
      const subscription = store.decrypt(device.encrypted_subscription);
      validateEndpoint(subscription.endpoint, allowedOrigins);
      await transport(subscription, JSON.stringify({ line: event.line, link: event.link }), 86400);
      outcome = 'accepted';
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
      if (status === 404 || status === 410) {
        outcome = 'expired';
        await db.query('UPDATE factory_push_subscriptions SET active = false WHERE id = $1', [device.id]);
      } else if (typeof status === 'number' && status >= 400 && status <= 599) {
        outcome = 'rejected';
        retryAt = new Date(now().getTime() + Math.min(3600, 60 * 2 ** (claimed.rows[0].attempts - 1)) * 1000);
      }
    }
    await db.query(`UPDATE factory_push_deliveries SET status = $3, retry_at = $4, updated_at = now()
      WHERE event_key = $1 AND device_id = $2`, [key, device.id, outcome, retryAt]);
    log(`web-push event=send outcome=${outcome} device=${device.id} key=${key}`);
  }
}
