import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PushStore } from './src/mastra/push-store.ts';
import { sendPushEvent } from './src/mastra/push-sender.ts';

const databaseUrl = process.env.WEB_PUSH_TEST_DATABASE_URL;
test('migration, two subscriptions, concurrent ledger claims, and restart-safe unresolved outcomes', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const schema = 'push_test_' + randomBytes(8).toString('hex');
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'julia-factory') THEN CREATE ROLE "julia-factory" NOLOGIN; END IF; END $$`);
    const migration = await readFile(new URL('../push.migration.sql', import.meta.url), 'utf8');
    await client.query(migration);
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO "julia-factory"`);
    await client.query('SET ROLE "julia-factory"');
    const store = new PushStore(client, randomBytes(32));
    const endpoint = suffix => `https://fcm.googleapis.com/push/${suffix}`;
    for (const suffix of ['one', 'two']) await store.put('todd', { endpoint: endpoint(suffix), keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } });
    assert.equal(await store.count('todd'), 2);
    const persisted = await client.query('SELECT encrypted_subscription FROM factory_push_subscriptions');
    assert.equal(persisted.rows.length, 2);
    assert.ok(persisted.rows.every(row => !row.encrypted_subscription.toString().includes('fcm.googleapis')));
    const event = { line: 'Needs you', link: 'https://factory.example.test/factories/project/waits/1', eventKey: 'wait-1' };
    const sends = [];
    const opts = { db: client, store, origin: 'https://factory.example.test', recipientUserId: 'todd', allowedOrigins: ['https://fcm.googleapis.com'], log: () => {}, transport: async sub => {
      sends.push(sub.endpoint);
      if (sub.endpoint.endsWith('/two')) throw Error('uncertain result');
    } };
    await Promise.all([sendPushEvent(event, opts), sendPushEvent(event, opts)]);
    await sendPushEvent(event, opts);
    assert.equal(sends.length, 2);
    const results = await client.query('SELECT status, attempts FROM factory_push_deliveries ORDER BY status');
    assert.deepEqual(results.rows, [{ status: 'accepted', attempts: 1 }, { status: 'unresolved', attempts: 1 }]);
  } finally {
    await client.query('RESET ROLE');
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
});
