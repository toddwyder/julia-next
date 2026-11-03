// The machine resumes the builder's own session so a FAIL lands in the thread
// that has the work in it. The stock `session.thread.switch` is what selects the
// thread: a boot takes the newest one, and the switch re-points the session at the
// wanted one. This test is the reason the direct `mastra_threads.updatedAt` edit
// is gone — if the stock switch ever stops selecting the thread, it fails.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bootHarness, missingProgram, stopHarness } from '../shipping/harness.mjs';

const missing = missingProgram();
const skip = missing ? `the Mastra program is not installed here: ${missing}` : false;

function tempStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-thread-switch-'));
  return { dir, storage: { backend: 'libsql', url: `file:${path.join(dir, 'session.db')}`, isRemote: false } };
}

test('the stock thread switch selects the wanted thread, and a later boot keeps it', { skip }, async () => {
  const { dir, storage } = tempStorage();
  const root = process.cwd();
  const first = await bootHarness({ cwd: root, storage });
  let builderThread;
  let otherThread;
  try {
    builderThread = first.session.thread.getId();
    const other = await first.session.thread.create({ title: 'a thread that is not the builder' });
    otherThread = other.id;
    assert.notEqual(otherThread, builderThread, 'a second thread has its own id');
    assert.equal(first.session.thread.getId(), otherThread, 'the new thread is the one the session is on');
    await first.session.thread.switch({ threadId: builderThread });
    assert.equal(first.session.thread.getId(), builderThread, 'the switch moves a running session to the builder thread');
  } finally {
    await stopHarness(first.booted);
  }

  try {
    const second = await bootHarness({ cwd: root, storage, createInitialThread: false });
    try {
      assert.equal(
        second.session.thread.getId(),
        builderThread,
        'a later boot takes the thread the stock switch selected, with no direct edit of mastra_threads',
      );
      await second.session.thread.switch({ threadId: otherThread });
      assert.equal(second.session.thread.getId(), otherThread, 'the switch moves that session too');
    } finally {
      await stopHarness(second.booted);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
