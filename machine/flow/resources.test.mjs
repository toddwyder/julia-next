import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';

import { ensureCardResources, readAvailableMemoryMb, stopIfResourcesShort } from './resources.mjs';
import { CARD_PATH } from './schema.mjs';
import { buildCardPath } from './workflow.mjs';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-res-'));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup races on Windows.
    }
  });
  return dir;
}

test('readAvailableMemoryMb parses /proc/meminfo MemAvailable on Linux and falls back to freemem', () => {
  const mb = readAvailableMemoryMb({
    platform: 'linux',
    readFile: () => 'MemTotal:        8000000 kB\nMemFree:         1000000 kB\nMemAvailable:    4194304 kB\n',
    freeMemory: () => 512 * 1024 * 1024,
  });
  assert.equal(mb, 4096);

  const fallback = readAvailableMemoryMb({
    platform: 'win32',
    freeMemory: () => 2048 * 1024 * 1024,
  });
  assert.equal(fallback, 2048);
});

test('ensureCardResources skips cleanup when memory and disk are above thresholds', () => {
  let cleaned = false;
  const result = ensureCardResources({
    card: 'JUL-362',
    minMemoryMb: 1024,
    minDiskGb: 10,
    readMemoryMb: () => 4096,
    readDiskGb: () => 25,
    cleanIdle: () => {
      cleaned = true;
      return true;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.cleaned, false);
  assert.equal(cleaned, false);
});

test('ensureCardResources clears idle leftovers when memory or disk is short and passes if recovered', () => {
  let memory = 512;
  let cleaned = false;
  const result = ensureCardResources({
    card: 'JUL-362',
    minMemoryMb: 1024,
    minDiskGb: 10,
    readMemoryMb: () => memory,
    readDiskGb: () => 25,
    cleanIdle: () => {
      cleaned = true;
      memory = 3072;
      return true;
    },
  });
  assert.equal(cleaned, true);
  assert.equal(result.ok, true);
  assert.equal(result.cleaned, true);
});

test('ensureCardResources fails with a report naming what ran short when still short after cleanup', () => {
  const result = ensureCardResources({
    card: 'JUL-362',
    minMemoryMb: 1024,
    minDiskGb: 10,
    readMemoryMb: () => 400,
    readDiskGb: () => 4.5,
    cleanIdle: () => true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.cleaned, true);
  assert.match(result.reason, /memory \(400 MB available, requires 1024 MB\)/);
  assert.match(result.reason, /disk \(4\.5 GB available, requires 10 GB\)/);
});

test('stopIfResourcesShort sets state stopped with stopPart Resources', async () => {
  let saved = null;
  const result = await stopIfResourcesShort(
    {
      inputData: { card: 'JUL-362', kind: 'product' },
      state: { card: 'JUL-362', kind: 'product' },
      setState: async next => {
        saved = next;
      },
    },
    '/',
    {
      minMemoryMb: 1024,
      minDiskGb: 10,
      readMemoryMb: () => 256,
      readDiskGb: () => 20,
      cleanIdle: () => false,
    },
  );
  assert.equal(result.stopped, true);
  assert.equal(saved.stopped, true);
  assert.equal(saved.stopPart, 'Resources');
  assert.match(saved.stopWhy, /memory/);
});

test('card-path stops cleanly with a stop report naming memory when memory stays short', async t => {
  const dir = tempDir(t);
  const prev = process.env.FLOW_MIN_FREE_MEMORY_MB;
  process.env.FLOW_MIN_FREE_MEMORY_MB = '999999999';
  t.after(() => {
    if (prev === undefined) delete process.env.FLOW_MIN_FREE_MEMORY_MB;
    else process.env.FLOW_MIN_FREE_MEMORY_MB = prev;
  });

  const dummyAgent = new Agent({
    id: 'dummy',
    name: 'dummy',
    instructions: 'noop',
    model: 'openai/gpt-4o-mini',
    tools: {
      task_write: { description: 'w', execute: async () => ({}) },
      task_update: { description: 'u', execute: async () => ({}) },
      task_complete: { description: 'c', execute: async () => ({}) },
      task_check: { description: 'k', execute: async () => ({}) },
    },
  });
  const agents = { build: dummyAgent, shipping: dummyAgent, remediation: dummyAgent, retro: dummyAgent };
  const workflow = buildCardPath({ agents, dir, repo: process.cwd() });
  const mastra = new Mastra({
    workflows: { [CARD_PATH]: workflow },
    storage: new LibSQLStore({ id: 'res-test', url: `file:${join(dir, 'state.db')}` }),
  });
  t.after(() => mastra.shutdown().catch(() => null));

  const run = await mastra.getWorkflow(CARD_PATH).createRun();
  const outcome = await run.start({ inputData: { card: 'JUL-999', kind: 'machine' } });
  assert.equal(outcome.status, 'success');
  assert.equal(outcome.result.stopped, true);

  const reportFile = join(dir, 'JUL-999', 'reports', 'JUL-999.md');
  assert.ok(existsSync(reportFile), 'stop report was written');
  const report = readFileSync(reportFile, 'utf8');
  assert.match(report, /Part: Resources/);
  assert.match(report, /memory/);
});
