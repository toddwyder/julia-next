// Public persistence seam, real files, deterministic OS rename faults.
// These fixtures reproduce Windows sharing outcomes, not a real sharing race.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadText, saveJson } from './julia-delivery-state.mjs';

async function files(t) {
  const root = await mkdtemp(join(tmpdir(), 'jul196-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'state.json');
  await writeFile(path, '{"stage":"old"}\n');
  return { root, path };
}
const fault = code => Object.assign(new Error(`fixture rename ${code}: file cannot be replaced`), { code, syscall: 'rename' });

test('saveJson keeps the complete old state during transient Windows rename failures, then atomically replaces it', async t => {
  const { root, path } = await files(t);
  let attempts = 0; const waits = []; const sources = [];
  await saveJson(path, { stage: 'new', completed: ['build'] }, {
    platform: 'win32', wait: async ms => { waits.push(ms); },
    rename: async (source, target) => {
      sources.push(source); attempts++;
      assert.equal(target, path);
      assert.equal(await loadText(path), '{"stage":"old"}\n', 'no delete/truncate or intermediate target state');
      assert.deepEqual(JSON.parse(await loadText(source)), { stage: 'new', completed: ['build'] }, 'replacement is complete before any rename attempt');
      if (attempts <= 2) throw fault('EPERM');
      await rename(source, target);
    },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [25, 50]);
  assert.equal(new Set(sources).size, 1, 'retries rename the same flushed temporary file');
  assert.deepEqual(JSON.parse(await loadText(path)), { stage: 'new', completed: ['build'] });
  assert.deepEqual(await readdir(root), ['state.json']);
});

test('saveJson stops bounded Windows retries on permanent failure, keeps old content, and removes its temporary file', async t => {
  const { root, path } = await files(t);
  const denied = fault('EACCES'); let attempts = 0; const waits = [];
  await assert.rejects(saveJson(path, { stage: 'new' }, {
    platform: 'win32', wait: async ms => { waits.push(ms); },
    rename: async () => { attempts++; throw denied; },
  }), error => error === denied, 'the original failure is preserved');
  assert.equal(attempts, 6, 'finite attempts even when permissions never recover');
  assert.deepEqual(waits, [25, 50, 100, 200, 400]);
  assert.equal(await loadText(path), '{"stage":"old"}\n');
  assert.deepEqual(await readdir(root), ['state.json'], 'no abandoned temporary file');
});

test('saveJson closes its temporary handle and removes incomplete content when flushing fails, without attempting rename', async t => {
  const { root, path } = await files(t);
  const ioError = Object.assign(new Error('fixture sync EIO'), { code: 'EIO', syscall: 'fsync' });
  let closes = 0;
  await assert.rejects(saveJson(path, { stage: 'new' }, {
    open: async (...args) => {
      const handle = await open(...args);
      return { writeFile: text => handle.writeFile(text), sync: async () => { throw ioError; }, close: async () => { closes++; await handle.close(); } };
    },
    rename: async () => assert.fail('rename cannot follow an unflushed write'),
  }), error => error === ioError);
  assert.equal(closes, 1);
  assert.equal(await loadText(path), '{"stage":"old"}\n');
  assert.deepEqual(await readdir(root), ['state.json']);
});

test('saveJson propagates non-transient errors and never retries rename faults outside Windows', async t => {
  for (const [platform, code] of [['win32', 'EIO'], ['win32', 'EXDEV'], ['win32', 'ENOENT'], ['linux', 'EPERM']]) {
    const { root, path } = await files(t); const error = fault(code); let attempts = 0;
    await assert.rejects(saveJson(path, { stage: 'new' }, {
      platform, wait: async () => assert.fail('this error is not retriable'),
      rename: async () => { attempts++; throw error; },
    }), seen => seen === error);
    assert.equal(attempts, 1);
    assert.equal(await loadText(path), '{"stage":"old"}\n');
    assert.deepEqual(await readdir(root), ['state.json']);
  }
});

test('saveJson retries each Windows sharing error only at the rename boundary', async t => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const { root, path } = await files(t); let attempts = 0;
    await saveJson(path, { stage: 'new' }, {
      platform: 'win32', wait: async () => {},
      rename: async (source, target) => { if (++attempts === 1) throw fault(code); await rename(source, target); },
    });
    assert.equal(attempts, 2);
    assert.equal(JSON.parse(await loadText(path)).stage, 'new');
    assert.deepEqual(await readdir(root), ['state.json']);
  }
});
