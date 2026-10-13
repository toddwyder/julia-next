import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createReviewResourceBudget,
  REVIEW_MAX_DISK_GROWTH_BYTES,
  REVIEW_MAX_RSS_BYTES,
  REVIEW_MIN_FREE_DISK_BYTES,
  REVIEW_RSS_STEP_RESERVE_BYTES,
} from '../src/resource-budget.mjs';

test('free-disk preflight stops before start and durably records SYSTEM_ERROR progress', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-resource-free-disk-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'progress.json'), '{"accepted":["header"]}\n');
  const terminalPath = join(directory, 'terminal-state.json');
  await assert.rejects(createReviewResourceBudget({
    runDirectory: directory,
    terminalPath,
    progress: () => ['header'],
    measureFreeDiskBytes: async () => REVIEW_MIN_FREE_DISK_BYTES - 1,
  }), /at least 2 GiB free disk/);
  const terminal = JSON.parse(await readFile(terminalPath, 'utf8'));
  assert.equal(terminal.state, 'SYSTEM_ERROR');
  assert.deepEqual(terminal.progress.acceptedPieces, ['header']);
  assert.equal(terminal.limit, 'free-disk');
  assert.equal(terminal.measured.freeDiskBytes, REVIEW_MIN_FREE_DISK_BYTES - 1);
});

test('memory reservation stops before peak RSS can cross 768 MiB and saves progress', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-resource-rss-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const terminalPath = join(directory, 'terminal-state.json');
  const resources = await createReviewResourceBudget({
    runDirectory: directory,
    terminalPath,
    progress: () => ['header', 'axis:standards'],
    measureFreeDiskBytes: async () => REVIEW_MIN_FREE_DISK_BYTES,
    measureRssBytes: () => REVIEW_MAX_RSS_BYTES - REVIEW_RSS_STEP_RESERVE_BYTES + 1,
  });
  await assert.rejects(resources.beforeDispatch(), /peak memory reservation would cross 768 MiB/);
  const terminal = JSON.parse(await readFile(terminalPath, 'utf8'));
  assert.equal(terminal.state, 'SYSTEM_ERROR');
  assert.equal(terminal.limit, 'memory');
  assert.deepEqual(terminal.progress.acceptedPieces, ['header', 'axis:standards']);
  assert.ok(terminal.measured.rssBytes < REVIEW_MAX_RSS_BYTES);
});

test('memory sampling retains a transient peak across the complete agent step', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-resource-rss-sampling-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let rssBytes = 100 * 1024 * 1024;
  const resources = await createReviewResourceBudget({
    runDirectory: directory,
    measureFreeDiskBytes: async () => REVIEW_MIN_FREE_DISK_BYTES,
    measureRssBytes: () => rssBytes,
  });
  resources.beginAgentStep();
  rssBytes += 12 * 1024 * 1024;
  await new Promise(resolve => setTimeout(resolve, 25));
  rssBytes -= 12 * 1024 * 1024;
  resources.finishAgentStep();
  const summary = await resources.summary();
  assert.equal(summary.peakRssBytes, 112 * 1024 * 1024);
  assert.equal(summary.peakRssStepIncreaseBytes, 12 * 1024 * 1024);
  assert.ok(summary.peakAgentStepMs >= 20);
});

test('disk-growth reservation stops before atomic evidence can cross 128 MiB', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-resource-disk-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const terminalPath = join(directory, 'terminal-state.json');
  let bytes = 10;
  const resources = await createReviewResourceBudget({
    runDirectory: directory,
    terminalPath,
    progress: () => ['header'],
    measureFreeDiskBytes: async () => REVIEW_MIN_FREE_DISK_BYTES,
    measureDirectoryBytes: async () => bytes,
  });
  bytes += REVIEW_MAX_DISK_GROWTH_BYTES - (64 * 1024 * 1024) + 1;
  await assert.rejects(resources.beforeDispatch(), /disk-growth reservation would cross 128 MiB/);
  const terminal = JSON.parse(await readFile(terminalPath, 'utf8'));
  assert.equal(terminal.state, 'SYSTEM_ERROR');
  assert.equal(terminal.limit, 'disk-growth');
  assert.deepEqual(terminal.progress.acceptedPieces, ['header']);
  assert.ok(terminal.measured.diskGrowthBytes < REVIEW_MAX_DISK_GROWTH_BYTES);
});
