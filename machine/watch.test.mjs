// A run whose process is gone has to reach Todd once, and only once (JUL-331).
// The message is written into the run before it is sent, so the second pass
// over the same folder finds the run already spoken for.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { watchOnce, stallReason } from './watch.mjs';
import { createStore, readRunFile } from './parent/store.mjs';

const readRun = (id, dir) => readRunFile(path.join(dir, `${id}.json`));

function folder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'machine-watch-'));
}

function running(store, { id, card = 'JUL-330', startedAt = '2026-11-03T06:41:22.000Z', idleLimitMs = 10 * 60_000 }) {
  const store2 = createStore(store.folder, { idleLimit: idleLimitMs });
  const record = store2.start({ card, id, now: new Date(startedAt) });
  return store2.begin(record, 'build', new Date(startedAt));
}

const later = minutes => new Date(Date.parse('2026-11-03T06:41:22.000Z') + minutes * 60_000);

test('a run quiet past its idle limit is marked stalled and Todd is told once', async () => {
  const dir = folder();
  const store = createStore(dir, { idleLimit: 10 * 60_000 });
  running(store, { id: '20261103T064122Z-JUL-330' });
  const said = [];

  const first = await watchOnce({
    store,
    now: later(11),
    ping: async (card, body) => {
      said.push({ card, body });
      return { sent: true, url: 'https://linear.app/x#c1' };
    },
    log: () => {},
  });

  assert.deepEqual(first.pinged, ['20261103T064122Z-JUL-330']);
  assert.equal(said.length, 1);
  assert.equal(said[0].card, 'JUL-330');
  assert.match(said[0].body, /went quiet/);
  assert.match(said[0].body, /a second pass will not send another/);

  const saved = readRun('20261103T064122Z-JUL-330', dir);
  assert.ok(saved.record.pingedAt, 'the ping is written into the run before it is sent');
  assert.match(saved.record.pingedReason, /idle limit of 10 minutes/);
  assert.equal(saved.record.steps[0].status, 'failed');
  assert.equal(saved.record.steps[0].detail, stallReason(saved.record));
  assert.equal(saved.record.status, 'running', 'stalled stays derived: the run is still the same run');

  const second = await watchOnce({
    store,
    now: later(40),
    ping: async () => {
      throw new Error('a second pass must not send another message');
    },
    log: () => {},
  });
  assert.deepEqual(second.pinged, []);
  assert.deepEqual(second.stalled, []);
});

test('a run still beating is left alone, however long it has been going', async () => {
  const dir = folder();
  const store = createStore(dir, { idleLimit: 10 * 60_000 });
  const record = running(store, { id: '20261103T064122Z-JUL-331' });
  const beat = store.beat(record, later(30));
  assert.equal(beat.heartbeatAt, later(30).toISOString());

  const result = await watchOnce({ store, now: later(33), ping: async () => ({ sent: true }), log: () => {} });
  assert.deepEqual(result.pinged, []);
  assert.equal(readRun('20261103T064122Z-JUL-331', dir).record.pingedAt, null);
});

test('a finished run is never called stalled', async () => {
  const dir = folder();
  const store = createStore(dir);
  const record = running(store, { id: '20261103T064122Z-JUL-332' });
  store.finish(record, 'succeeded');

  const result = await watchOnce({ store, now: later(600), ping: async () => ({ sent: true }), log: () => {} });
  assert.deepEqual(result.pinged, []);
});

test('the ping uses the idle limit recorded on the run, not the one this pass happens to have', async () => {
  const dir = folder();
  const store = createStore(dir, { idleLimit: 60 * 60_000 });
  running(store, { id: '20261103T064122Z-JUL-333', idleLimitMs: 2 * 60_000 });
  const said = [];

  await watchOnce({
    store: createStore(dir, { idleLimit: 60 * 60_000 }),
    now: later(5),
    ping: async (card, body) => {
      said.push(body);
      return { sent: true };
    },
    log: () => {},
  });

  assert.equal(said.length, 1);
  assert.match(said[0], /2 minutes/);
});
