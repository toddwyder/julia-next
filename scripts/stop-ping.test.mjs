import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { resumeCommand, projectWiresStopPing, stopComment } from './stop-ping.mjs';
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
