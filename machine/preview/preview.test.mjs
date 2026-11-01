// The parts of a preview that can be checked without starting one: the digests
// that prove the live copy kept serving, the records folder, the port scan, and
// the wait for an answer.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildMark, changedSince, emptyState, evidenceDigest, freePort, liveTrouble, sameDigest, seedState, startPreview, stopPreview, waitForAnswer } from './preview.mjs';

function workspace() {
  return mkdtempSync(join(tmpdir(), 'preview-'));
}

function put(dir, name, text) {
  const file = join(dir, name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
  return file;
}

test('the digest names every file and changes when one byte does', () => {
  const dir = workspace();
  put(dir, 'state/models.json', '{"panels":[]}');
  put(dir, 'state/runs/one.json', '{"id":"one"}');
  const before = evidenceDigest(dir);

  assert.deepEqual(before.files.map(file => file.path), ['state/models.json', 'state/runs/one.json']);
  assert.equal(before.files[0].bytes, 13);
  assert.match(before.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(sameDigest(before, evidenceDigest(dir)), true);

  put(dir, 'state/runs/one.json', '{"id":"two"}');
  const after = evidenceDigest(dir);
  assert.equal(sameDigest(before, after), false);
  assert.notEqual(before.digest, after.digest);
});

test('the digest of a folder that is gone is compared as nothing, never as equal', () => {
  const empty = evidenceDigest(null);
  assert.deepEqual(empty.files, []);
  assert.equal(empty.digest, null);
  assert.equal(sameDigest(empty, empty), false);
  assert.equal(sameDigest(evidenceDigest(workspace()), evidenceDigest(workspace())), true);
});

test('what moved between two readings is named file by file', () => {
  const dir = workspace();
  put(dir, 'models.json', 'models');
  put(dir, 'draft.json', 'one');
  const before = evidenceDigest(dir);
  put(dir, 'draft.json', 'two');
  put(dir, 'new.json', 'new');
  unlinkSync(join(dir, 'models.json'));

  assert.deepEqual(changedSince(before, evidenceDigest(dir)), [
    { path: 'draft.json', how: 'changed' },
    { path: 'models.json', how: 'went away' },
    { path: 'new.json', how: 'appeared' },
  ]);
});

test('the live service writing its own files is not blamed on the preview', () => {
  const live = workspace();
  put(live, 'models.json', 'models');
  put(live, 'watchdog.json', 'one');
  put(live, 'runs/jul-290.json', 'run');
  const before = evidenceDigest(live);
  put(live, 'watchdog.json', 'two');
  put(live, 'runs/jul-290.json', 'run, again');

  assert.deepEqual(liveTrouble(before, evidenceDigest(live)), [{ path: 'runs/jul-290.json', how: 'changed' }]);
});

test('a live records folder the preview never moved has nothing to answer for', () => {
  const live = workspace();
  put(live, 'models.json', 'models');
  put(live, 'watchdog.json', 'one');
  const before = evidenceDigest(live);
  put(live, 'watchdog.json', 'two');

  assert.deepEqual(liveTrouble(before, evidenceDigest(live)), []);
});

test('the preview seeds the models file and nothing else from the live records', () => {
  const live = workspace();
  const preview = workspace();
  put(live, 'models.json', '{"groups":[]}');
  put(live, 'runs/jul-1.json', '{"id":"jul-1"}');
  put(live, 'draft.json', '{"draft":true}');

  const seeded = seedState({ from: live, to: preview });

  assert.equal(seeded.file, join(preview, 'state', 'models.json'));
  assert.equal(readFileSync(seeded.file, 'utf8'), '{"groups":[]}');
  assert.deepEqual(evidenceDigest(preview).files.map(file => file.path), ['state/models.json']);
});

test('a second run starts from the live records, not from the first run\'s clicks', () => {
  const live = workspace();
  const preview = workspace();
  put(live, 'models.json', '{"groups":[]}');
  put(preview, 'state/draft.json', '{"draft":"from the first run"}');
  put(preview, 'state/runs/jul-1.json', '{"id":"jul-1"}');

  seedState({ from: live, to: preview });

  assert.deepEqual(evidenceDigest(preview).files.map(file => file.path), ['state/models.json']);
});

test('an empty records folder is a folder, not a copy of anything', () => {
  const dir = workspace();
  assert.deepEqual(emptyState({ to: dir }), { stateDir: dir });
  assert.deepEqual(evidenceDigest(dir).files, []);
});

test('the port scan takes the first port nothing answers on', async () => {
  const asked = [];
  const port = await freePort({
    host: '127.0.0.1',
    from: 4400,
    to: 4404,
    probe: async (host, candidate) => {
      asked.push([host, candidate]);
      return candidate < 4403;
    },
  });

  assert.equal(port, 4403);
  assert.deepEqual(asked, [
    ['127.0.0.1', 4400],
    ['127.0.0.1', 4401],
    ['127.0.0.1', 4402],
    ['127.0.0.1', 4403],
  ]);
});

test('a port range with nothing free says so instead of guessing', async () => {
  await assert.rejects(
    () => freePort({ host: '127.0.0.1', from: 4400, to: 4401, probe: async () => true }),
    /no free port between 4400 and 4401 on 127\.0\.0\.1/
  );
});

test('the wait ends on the first answer that is not a server error', async () => {
  const statuses = [503, 503, 200];
  const answers = [];
  const result = await waitForAnswer({
    url: 'http://127.0.0.1:4400/',
    attempts: 5,
    gap: 1,
    fetchImpl: async url => {
      answers.push(url);
      return { status: statuses.shift() };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.attempts, 3);
  assert.equal(answers.length, 3);
  assert.ok(result.ms >= 0);
});

test('the wait gives up and reports nothing rather than a false yes', async () => {
  const result = await waitForAnswer({
    url: 'http://127.0.0.1:4400/',
    attempts: 2,
    gap: 1,
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });

  assert.equal(result, null);
});

test('the build mark is the build this run made or no build at all', () => {
  const worktree = workspace();
  assert.deepEqual(buildMark(worktree), { path: join(worktree, 'dashboard', '.next', 'BUILD_ID'), id: null, at: null });

  put(worktree, 'dashboard/.next/BUILD_ID', 'build-abc\n');
  const mark = buildMark(worktree);
  assert.equal(mark.id, 'build-abc');
  assert.ok(mark.at > 0);
});

test('the preview starts through the launcher with its own address and records', () => {
  const events = new EventEmitter();
  const spawned = [];
  const child = startPreview({
    dir: '/tmp/worktree',
    host: '100.119.112.9',
    port: 4401,
    stateDir: '/tmp/run/preview',
    env: { PATH: '/usr/bin' },
    spawnImpl: (command, argv, options) => {
      spawned.push({ command, argv, options });
      const fake = new EventEmitter();
      fake.pid = 4242;
      fake.stdout = new EventEmitter();
      fake.stderr = new EventEmitter();
      return fake;
    },
  });

  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].argv, ['scripts/julia-agents.mjs', '--', 'node', 'dashboard/server.js']);
  assert.equal(spawned[0].options.cwd, '/tmp/worktree');
  assert.equal(spawned[0].options.detached, true);
  assert.equal(spawned[0].options.env.DASHBOARD_HOST, '100.119.112.9');
  assert.equal(spawned[0].options.env.DASHBOARD_PORT, '4401');
  assert.equal(spawned[0].options.env.DASHBOARD_STATE_DIR, '/tmp/run/preview');
  assert.equal(spawned[0].options.env.PATH, '/usr/bin');

  child.stdout.emit('data', 'listening\n');
  child.stderr.emit('data', 'warning\n');
  assert.equal(child.output(), 'listening\nwarning\n');
});

test('stopping a preview that never started is not an error', async () => {
  assert.deepEqual(await stopPreview(null), { stopped: true, note: 'nothing was running' });
});

test('stopping a preview ends the copy and waits for its address to go quiet', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore' });
  let asked = 0;
  const result = await stopPreview(child, {
    host: '127.0.0.1',
    port: 4401,
    gap: 1,
    attempts: 5,
    probe: async () => {
      asked += 1;
      return asked < 3;
    },
  });

  assert.deepEqual(result, { stopped: true, attempts: 3 });
  assert.equal(asked, 3);
});
