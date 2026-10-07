import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PushStore } from './src/mastra/push-store.ts';
import { sendPushEvent } from './src/mastra/push-sender.ts';

const origin = 'https://factory.example.test';
const subscription = endpoint => ({ endpoint, keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } });

function fixture() {
  const rows = new Map();
  const deliveries = new Map();
  const db = {
    async query(sql, args) {
      if (sql.includes('INSERT INTO factory_push_subscriptions')) {
        const hash = args[1];
        rows.set(hash, { id: hash, user_id: args[0], encrypted_subscription: args[2], active: true });
        return { rows: [] };
      }
      if (sql.includes('SELECT id, encrypted_subscription')) return { rows: [...rows.values()].filter(row => row.active && row.user_id === args[0]) };
      if (sql.includes('INSERT INTO factory_push_deliveries')) {
        const key = args[0] + ':' + args[1];
        const prior = deliveries.get(key);
        if (prior && !(prior.status === 'rejected' && prior.attempts < 3 && prior.retry_at <= args[2])) return { rows: [] };
        deliveries.set(key, { status: 'claimed', attempts: (prior?.attempts ?? 0) + 1 });
        return { rows: [{ attempts: deliveries.get(key).attempts }] };
      }
      if (sql.includes('UPDATE factory_push_deliveries')) {
        const row = deliveries.get(args[0] + ':' + args[1]);
        row.status = args[2];
        row.retry_at = args[3];
        return { rows: [] };
      }
      if (sql.includes('UPDATE factory_push_subscriptions')) {
        rows.get(args[0]).active = false;
        return { rows: [] };
      }
      throw Error('Unexpected SQL: ' + sql);
    },
  };
  return { db, rows, deliveries };
}

const notice = { line: '<b>Needs you</b>', link: origin + '/factories/project/waits/1', eventKey: 'wait-1' };

test('accepted sends are unique per device and rejected sends retry only after a deadline', async () => {
  const { db, deliveries } = fixture();
  const store = new PushStore(db, randomBytes(32));
  await store.put('todd', subscription('https://fcm.googleapis.com/push/first'));
  await store.put('todd', subscription('https://fcm.googleapis.com/push/second'));
  await store.put('other-user', subscription('https://fcm.googleapis.com/push/third'));
  const calls = [];
  const transport = async (sub, payload, ttl) => {
    calls.push({ endpoint: sub.endpoint, payload, ttl });
    if (sub.endpoint.endsWith('/second') && calls.length === 2) throw Object.assign(Error('rejected'), { statusCode: 429 });
  };
  const opts = { db, store, transport, origin, recipientUserId: 'todd', allowedOrigins: ['https://fcm.googleapis.com'], now: () => new Date('2026-10-07T12:00:00Z'), log: () => {} };
  await sendPushEvent(notice, opts);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].ttl, 86400);
  assert.deepEqual(JSON.parse(calls[0].payload), { line: notice.line, link: notice.link });
  await sendPushEvent(notice, opts);
  assert.equal(calls.length, 2);
  await sendPushEvent(notice, { ...opts, now: () => new Date('2026-10-07T12:02:00Z') });
  assert.equal(calls.length, 3);
  assert.deepEqual([...deliveries.values()].map(row => row.status).sort(), ['accepted', 'accepted']);
});

test('unknown outcome remains unresolved across sender invocations and expired device is disabled', async () => {
  const { db, rows, deliveries } = fixture();
  const store = new PushStore(db, randomBytes(32));
  await store.put('todd', subscription('https://fcm.googleapis.com/push/first'));
  const logs = [];
  let sends = 0;
  const opts = { db, store, transport: async () => { sends++; throw Error('timeout: sensitive payload'); }, origin, recipientUserId: 'todd', allowedOrigins: ['https://fcm.googleapis.com'], now: () => new Date('2026-10-07T12:00:00Z'), log: line => logs.push(line) };
  await sendPushEvent(notice, opts);
  await sendPushEvent(notice, opts);
  assert.equal(sends, 1);
  assert.equal([...deliveries.values()][0].status, 'unresolved');
  assert.doesNotMatch(logs.join(' '), /timeout|Needs you|factories\/|fcm.googleapis|wait-1/);
  assert.match(logs.join(' '), /outcome=unresolved/);
  await sendPushEvent({ ...notice, eventKey: 'wait-2' }, { ...opts, transport: async () => { sends++; throw Object.assign(Error('gone'), { statusCode: 410 }); } });
  assert.equal(sends, 2);
  assert.equal([...rows.values()][0].active, false);
  assert.ok([...deliveries.values()].some(row => row.status === 'expired'));
});

test('rejects off-origin links and concurrent claims permit only one send', async () => {
  const { db } = fixture();
  const store = new PushStore(db, randomBytes(32));
  await store.put('todd', subscription('https://fcm.googleapis.com/push/first'));
  let sends = 0;
  const opts = { db, store, origin, recipientUserId: 'todd', allowedOrigins: ['https://fcm.googleapis.com'], now: () => new Date(), log: () => {}, transport: async () => { sends++; } };
  await assert.rejects(sendPushEvent({ ...notice, link: 'https://evil.example/factories/1' }, opts), /Factory link/);
  await Promise.all([sendPushEvent(notice, opts), sendPushEvent(notice, opts)]);
  assert.equal(sends, 1);
});
