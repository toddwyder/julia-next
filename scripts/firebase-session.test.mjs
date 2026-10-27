import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { accessToken, cliSession } from './firebase-session.mjs';

function store(body) {
  const dir = mkdtempSync(join(tmpdir(), 'firebase-session-'));
  const path = join(dir, 'firebase-tools.json');
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  return path;
}

test('a machine with no CLI session says how to make one', () => {
  assert.throws(() => cliSession('/nonexistent/firebase-tools.json'), /npx firebase login --non-interactive/);
});

test('a logged-out CLI is treated as no session, not an empty one', () => {
  assert.throws(() => cliSession(store({ user: {}, tokens: {} })), /No Firebase CLI session/);
});

test('the session carries the account and the refresh token', () => {
  const path = store({ user: { email: 'todd@example.test' }, tokens: { refresh_token: 'refresh-1' } });
  assert.deepEqual(cliSession(path), { email: 'todd@example.test', refresh: 'refresh-1' });
});

test('the refresh token becomes an access token with the CLI client', async () => {
  const path = store({ user: { email: 'todd@example.test' }, tokens: { refresh_token: 'refresh-1' } });
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: new URLSearchParams(init.body) };
    return { status: 200, json: async () => ({ access_token: 'access-1' }) };
  };
  assert.equal(await accessToken({ fetchImpl, path }), 'access-1');
  assert.equal(sent.url, 'https://oauth2.googleapis.com/token');
  assert.equal(sent.body.get('grant_type'), 'refresh_token');
  assert.equal(sent.body.get('refresh_token'), 'refresh-1');
  assert.ok(sent.body.get('client_id'));
});

test('a refused refresh token says to log in again', async () => {
  const path = store({ user: { email: 'todd@example.test' }, tokens: { refresh_token: 'stale' } });
  const fetchImpl = async () => ({ status: 400, json: async () => ({ error: 'invalid_grant' }) });
  await assert.rejects(accessToken({ fetchImpl, path }), /npx firebase login/);
});
