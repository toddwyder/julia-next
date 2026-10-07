import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { Pool } from 'pg';
import type { Subscription } from './push-routes.js';

export function validateEndpoint(endpoint: unknown, allowedOrigins: string[]): void {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) throw Error('invalid endpoint');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      url.port || !allowedOrigins.includes(url.origin) ||
      url.hostname === 'localhost' || isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) throw Error('unapproved endpoint');
}

export function validateFactoryLink(link: string, origin: string): void {
  const url = new URL(link);
  if (url.origin !== origin || !url.pathname.startsWith('/factories/') || url.username || url.password || url.hash) {
    throw Error('invalid Factory link');
  }
}

export class PushStore {
  private readonly db: Pick<Pool, 'query'>;
  private readonly key: Buffer;

  constructor(db: Pick<Pool, 'query'>, key: Buffer) {
    if (key.length !== 32) throw Error('WEB_PUSH_ENCRYPTION_KEY must decode to 32 bytes');
    this.db = db;
    this.key = key;
  }

  private fingerprint(endpoint: string): string {
    return createHmac('sha256', this.key).update(endpoint).digest('hex');
  }

  private encrypt(subscription: Subscription): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const text = Buffer.from(JSON.stringify(subscription));
    return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]);
  }

  decrypt(value: Buffer): Subscription {
    const iv = value.subarray(0, 12);
    const tag = value.subarray(value.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString('utf8')) as Subscription;
  }

  async put(user: string, subscription: Subscription): Promise<void> {
    await this.db.query(`INSERT INTO factory_push_subscriptions (user_id, endpoint_hash, encrypted_subscription)
      VALUES ($1, $2, $3) ON CONFLICT (user_id, endpoint_hash) DO UPDATE
      SET encrypted_subscription = EXCLUDED.encrypted_subscription, active = true`, [user, this.fingerprint(subscription.endpoint), this.encrypt(subscription)]);
  }

  async count(user: string): Promise<number> {
    const result = await this.db.query('SELECT count(*)::int AS total FROM factory_push_subscriptions WHERE user_id = $1 AND active', [user]);
    return result.rows[0]?.total ?? 0;
  }
}
