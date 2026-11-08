import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { graphifyGraphPaths, graphifyTools } from './graphify.mjs';

test('graph paths follow the repository layout', () => {
  assert.deepEqual(graphifyGraphPaths('/repo'), {
    julia: '/repo/graphify-out/graph.json',
    mastra: '/repo/graphify-out/mastra/graph.json',
  });
});

test('graph tools stay off until a graph exists', async t => {
  const repo = mkdtempSync(join(tmpdir(), 'graphify-tools-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  assert.deepEqual(await graphifyTools({ repo }), {});
});
