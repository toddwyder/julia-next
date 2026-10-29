import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { resumeCommand, projectWiresStopPing, stopComment, handleStop, lastCardFromStops, readThreadCards, threadCardsFile } from './stop-ping.mjs';
import { threadProjectPath } from './scorecard.mjs';
import { globalStopPing, withGlobalStopPing } from './install-hooks.mjs';

test('the stop comment names the resume command, never -t, which opens a new chat', () => {
  const body = stopComment({ reason: 'agent_done', message: 'PR is open.', thread: '34c99d86-8851', projectPath: '/home/ubuntu/julia-mastra' });
  assert.match(body, /`cd \/home\/ubuntu\/julia-mastra && mastracode resume 34c99d86-8851`/);
  assert.doesNotMatch(body, /mastracode -t/);
  assert.match(body, /Continue in that session/);
});

test('a thread with no recorded project resumes from wherever the reader already is', () => {
  assert.equal(resumeCommand({ thread: 'abc' }), 'mastracode resume abc');
});

test('a session outside this repository still expects the global hook to run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stop-ping-home-'));
  try {
    assert.equal(projectWiresStopPing(dir), false);
    mkdirSync(join(dir, '.mastracode'));
    writeFileSync(join(dir, '.mastracode', 'hooks.json'), JSON.stringify({ Notification: [{ type: 'command', command: 'node scripts/julia-agents.mjs -- node scripts/stop-ping.mjs' }] }));
    assert.equal(projectWiresStopPing(dir), true);
    writeFileSync(join(dir, '.mastracode', 'hooks.json'), '{ not json');
    assert.equal(projectWiresStopPing(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the global hook does not mistake itself for a project hook', () => {
  const home = mkdtempSync(join(tmpdir(), 'stop-ping-global-'));
  try {
    mkdirSync(join(home, '.mastracode'));
    writeFileSync(join(home, '.mastracode', 'hooks.json'), JSON.stringify({ Notification: [{ type: 'command', command: 'node /repo/scripts/stop-ping.mjs --global' }] }));
    assert.equal(projectWiresStopPing(home, { home }), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the last card a stop landed on is read past the ping records and card-less stops', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stop-ping-stops-'));
  try {
    const file = join(dir, 'stops.jsonl');
    writeFileSync(file, [
      JSON.stringify({ id: '1', thread: 'a', card: 'JUL-100' }),
      JSON.stringify({ id: '1', comment: 'https://linear/1' }),
      JSON.stringify({ id: '2', thread: 'b', card: null }),
      JSON.stringify({ id: '3', thread: 'c', card: 'JUL-200' }),
      JSON.stringify({ id: '3', comment: 'https://linear/3' }),
      '',
    ].join('\n'));
    assert.equal(lastCardFromStops(file), 'JUL-200');
    assert.equal(lastCardFromStops(join(dir, 'missing.jsonl')), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a chat started outside the repository pings the last card and stays bound to it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stop-ping-bind-'));
  try {
    const env = { XDG_STATE_HOME: root, LINEAR_API_KEY: 'test' };
    const stops = join(root, 'julia', 'stops.jsonl');
    mkdirSync(join(root, 'julia'), { recursive: true });
    writeFileSync(stops, JSON.stringify({ id: 'earlier', thread: 'other', card: 'JUL-276' }) + '\n');
    const posted = [];
    const deps = {
      threadCardFor: () => undefined,
      projectPathFor: () => undefined,
      post: async card => { posted.push(card); return { url: `https://linear/${card}` }; },
      remind: async () => ({ issueReminder: { success: true } }),
    };
    const payload = { session_id: 'thread-outside', cwd: '/home/ubuntu', reason: 'agent_done', message: 'Working.' };

    const first = await handleStop(payload, env, deps);
    assert.equal(first.posted, true);
    assert.equal(first.card, 'JUL-276');
    assert.equal(first.cardSource, 'last ping');
    assert.deepEqual(readThreadCards(threadCardsFile(env))['thread-outside'].card, 'JUL-276');

    // The next stop in that chat comes from the binding, even once the stop history moves on.
    writeFileSync(stops, JSON.stringify({ id: 'later', thread: 'elsewhere', card: 'JUL-999' }) + '\n');
    const second = await handleStop(payload, env, deps);
    assert.equal(second.card, 'JUL-276');
    assert.equal(second.cardSource, 'binding');
    assert.deepEqual(posted, ['JUL-276', 'JUL-276']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a chat that names its own card declares it and binds nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stop-ping-declared-'));
  try {
    const env = { XDG_STATE_HOME: root, LINEAR_API_KEY: 'test' };
    const result = await handleStop({ session_id: 'thread-declared', cwd: '/home/ubuntu/repo', reason: 'agent_done' }, env, {
      threadCardFor: () => 'JUL-300',
      projectPathFor: () => undefined,
      post: async () => ({ url: 'https://linear/300' }),
      remind: async () => ({ issueReminder: { success: true } }),
    });
    assert.equal(result.card, 'JUL-300');
    assert.equal(result.cardSource, 'thread');
    assert.deepEqual(readThreadCards(threadCardsFile(env)), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stop with no card anywhere is recorded and says so', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stop-ping-nocard-'));
  try {
    const env = { XDG_STATE_HOME: root, LINEAR_API_KEY: 'test' };
    const result = await handleStop({ session_id: 'thread-nocard', cwd: '/home/ubuntu', reason: 'agent_done' }, env, {
      threadCardFor: () => undefined,
      projectPathFor: () => undefined,
      post: async () => { throw new Error('must not post without a card'); },
      remind: async () => { throw new Error('must not remind without a card'); },
    });
    assert.equal(result.posted, false);
    assert.match(result.error, /no card/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('installing the global hook replaces its own entry and keeps the others', () => {
  const existing = { Notification: [{ type: 'command', command: 'node /old/stop-ping.mjs --global' }], SessionStart: [{ type: 'command', command: 'echo hello' }] };
  const config = withGlobalStopPing(existing, '/repo');
  assert.deepEqual(config.Notification, [globalStopPing('/repo')]);
  assert.deepEqual(config.SessionStart, [{ type: 'command', command: 'echo hello' }]);
  assert.match(config.Notification[0].command, /--global$/);
  assert.match(config.Notification[0].command, /^node \/repo\/scripts\/julia-agents\.mjs -- node \/repo\/scripts\/stop-ping\.mjs/);
});

test('a thread knows the directory it was started in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stop-ping-db-'));
  try {
    const db = new DatabaseSync(join(dir, 'mastra.db'));
    db.exec('create table mastra_threads (id text, title text, metadata text)');
    db.prepare('insert into mastra_threads values (?, ?, ?)').run('thread-1', 'Some title', JSON.stringify({ projectPath: '/home/ubuntu/julia-mastra' }));
    db.prepare('insert into mastra_threads values (?, ?, ?)').run('thread-2', 'No project', '{}');
    db.close();
    assert.equal(threadProjectPath(join(dir, 'mastra.db'), 'thread-1'), '/home/ubuntu/julia-mastra');
    assert.equal(threadProjectPath(join(dir, 'mastra.db'), 'thread-2'), undefined);
    assert.equal(threadProjectPath(join(dir, 'mastra.db'), 'missing'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
