import { Pool } from 'pg';
import webPush from 'web-push';
import { PushStore } from './src/mastra/push-store.ts';
import { sendPushEvent } from './src/mastra/push-sender.ts';

const required = name => {
  const value = process.env[name]?.trim();
  if (!value) throw Error(`Missing ${name}`);
  return value;
};

let pool;
let stage = 'configuration';
try {
  const origin = new URL(required('MASTRACODE_PUBLIC_URL')).origin;
  const allowedOrigins = required('WEB_PUSH_ALLOWED_ORIGINS').split(',').map(value => new URL(value.trim()).origin);
  const key = Buffer.from(required('WEB_PUSH_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw Error('Invalid WEB_PUSH_ENCRYPTION_KEY');
  webPush.setVapidDetails(required('WEB_PUSH_SUBJECT'), required('WEB_PUSH_PUBLIC_KEY'), required('WEB_PUSH_PRIVATE_KEY'));
  stage = 'input';
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4096) throw Error('Invalid push request');
  }
  const event = JSON.parse(input);
  pool = new Pool({ connectionString: required('DATABASE_URL') });
  stage = 'delivery';
  await sendPushEvent(event, {
    db: pool, store: new PushStore(pool, key), origin, allowedOrigins, recipientUserId: required('WEB_PUSH_RECIPIENT_USER_ID'),
    transport: async (subscription, payload, ttl) => {
      await webPush.sendNotification(subscription, payload, { TTL: ttl });
    },
  });
} catch {
  console.error(`web-push event=send outcome=failed stage=${stage}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
