import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelJournal } from '../src/model-journal.mjs';

test('journal overflow fails before a verdict and becomes a warning after one', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-journal-bound-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const warnings = [];
  let saved = false;
  const journal = await createModelJournal({ path: join(directory, 'events.json'), maxBytes: 40, verdictSaved: () => saved, warnings });
  await assert.rejects(journal.record({ kind: 'request', body: { prompt: 'too large for this fixture' } }), /durable evidence limit/);
  saved = true;
  assert.equal(await journal.record({ kind: 'request', body: { prompt: 'still too large' } }), false);
  assert.equal(warnings.length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'events.json.warnings.json'), 'utf8')), warnings);
});

test('a restarted journal retains earlier provider events', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-journal-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'events.json');
  const first = await createModelJournal({ path });
  await first.record({ kind: 'request', body: { turn: 1 } });
  const resumed = await createModelJournal({ path });
  await resumed.record({ kind: 'response', raw: 'turn 1 reply' });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), [
    { kind: 'request', body: { turn: 1 } },
    { kind: 'response', raw: 'turn 1 reply' },
  ]);
});

test('the evidence ceiling includes other run files and atomic-write headroom', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-journal-total-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'pieces.json'), 'x'.repeat(30));
  const journal = await createModelJournal({ path: join(directory, 'events.json'), maxBytes: 40 });
  await assert.rejects(journal.record({ kind: 'request', body: {} }), /durable evidence limit/);
});
