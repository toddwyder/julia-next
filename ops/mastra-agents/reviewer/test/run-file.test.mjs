import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { durableWrite } from '../src/run-file.mjs';

async function directoryBytes(root) {
  let total = 0;
  for (const name of await readdir(root)) total += (await stat(join(root, name))).size;
  return total;
}

test('concurrent durable writers cannot overrun the shared evidence quota', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-evidence-quota-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const results = await Promise.allSettled([
    durableWrite(join(directory, 'one.txt'), 'x'.repeat(60), { root: directory, maxBytes: 100 }),
    durableWrite(join(directory, 'two.txt'), 'y'.repeat(60), { root: directory, maxBytes: 100 }),
  ]);

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /durable evidence writer is busy|evidence limit/);
  assert.ok(await directoryBytes(directory) <= 100);
  const files = (await readdir(directory)).filter(name => name.endsWith('.txt'));
  assert.equal(files.length, 1);
  assert.equal((await readFile(join(directory, files[0]), 'utf8')).length, 60);
});
