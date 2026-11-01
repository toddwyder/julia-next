import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleStop } from '../../scripts/stop-ping.mjs';
import { stopPingDeps } from './ping.mjs';

const THREAD = '166a4ed4-7265-4ac5-92bc-ed3dcaa36a61';

function quietState() {
  const dir = mkdtempSync(join(tmpdir(), 'remediation-ping-'));
  return { XDG_STATE_HOME: dir, MASTRA_APP_DATA_DIR: dir };
}

test('the stop names the session the loop started and the card it worked on', () => {
  const deps = stopPingDeps({ thread: THREAD, card: 'JUL-999', projectPath: '/tmp/practice' });

  assert.deepEqual(deps.threadFor(), { thread: THREAD, threadSource: 'runner' });
  assert.equal(deps.threadCardFor(), 'JUL-999');
  assert.equal(deps.projectPathFor(), '/tmp/practice');
});

test('a session in its own store still files the stop on the right card', async () => {
  const env = quietState();
  const posted = [];
  const ping = await handleStop(
    { session_id: THREAD, cwd: '/tmp/practice', reason: 'agent_done', message: 'Stopped on JUL-999.\nRoot cause: the first thing that opens the page.' },
    env,
    {
      ...stopPingDeps({ thread: THREAD, card: 'JUL-999', projectPath: '/tmp/practice' }),
      post: async (card, body) => {
        posted.push({ card, body });
        return { url: 'https://linear.app/julia-next/issue/JUL-999#comment-1' };
      },
      remind: async () => ({ issueReminder: { success: true } }),
    },
  );

  assert.equal(ping.card, 'JUL-999');
  assert.equal(ping.cardSource, 'thread');
  assert.equal(ping.thread, THREAD);
  assert.equal(ping.posted, true);
  assert.equal(posted.length, 1);
  assert.match(posted[0].body, /Root cause: the first thing that opens the page\./);
  assert.match(posted[0].body, new RegExp(`mastracode resume ${THREAD}`));
});

test('a card is never read off a branch name when the runner named it', async () => {
  const env = quietState();
  const ping = await handleStop(
    { session_id: THREAD, cwd: '/home/ubuntu/julia-builder', reason: 'agent_done', message: 'Stopped on JUL-999.' },
    env,
    {
      ...stopPingDeps({ thread: THREAD, card: 'JUL-999' }),
      post: async () => ({ url: 'https://linear.app/julia-next/issue/JUL-999#comment-2' }),
      remind: async () => ({ issueReminder: { success: true } }),
    },
  );

  assert.equal(ping.card, 'JUL-999');
  assert.equal(ping.cardSource, 'thread');
  const stops = readFileSync(join(env.XDG_STATE_HOME, 'julia', 'stops.jsonl'), 'utf8').trim().split('\n');
  assert.equal(JSON.parse(stops[0]).card, 'JUL-999');
});
