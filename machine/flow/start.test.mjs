import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { LibSQLStore } from '@mastra/libsql';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { openMastra } from './mastra.mjs';
import { CARD_PATH } from './schema.mjs';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-start-'));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // DuckDB file handles on Windows can linger until process exit.
    }
  });
  return dir;
}

function runChild(script, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => resolvePromise({ code, stdout, stderr }));
  });
}

test('start.mjs readState and resumeCard succeed while another process holds trace.duckdb open', async t => {
  const dir = tempDir(t);
  const waitStep = createStep({
    id: 'wait-todd',
    inputSchema: z.object({ card: z.string() }),
    outputSchema: z.object({ card: z.string() }),
    suspendSchema: z.object({ request: z.string() }),
    resumeSchema: z.object({ request: z.string().optional(), answer: z.enum(['yes', 'no']) }),
    execute: async ({ inputData, resumeData, suspend }) => {
      if (!resumeData) return suspend({ request: 'ship?' });
      return { card: inputData.card };
    },
  });
  const workflow = createWorkflow({
    id: CARD_PATH,
    inputSchema: z.object({ card: z.string() }),
    outputSchema: z.object({ card: z.string() }),
  })
    .then(waitStep)
    .commit();

  const mastra = await openMastra({
    card: 'JUL-999',
    agents: {},
    workflow,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
  });
  t.after(async () => {
    await mastra.shutdown().catch(() => null);
  });

  await mastra.getStorage().init();
  const run = await mastra.getWorkflow(CARD_PATH).createRun();
  const suspended = await run.start({ inputData: { card: 'JUL-999' } });
  assert.equal(suspended.status, 'suspended');

  // Ensure snapshot.value.card is present for cardOfRun(), matching Studio's card-path state.
  const store = new LibSQLStore({ id: 'flow-state-seed', url: `file:${join(dir, 'state.db')}` });
  await store.init();
  const workflowsStore = await store.getStore('workflows');
  const saved = await workflowsStore.getWorkflowRunById({ runId: run.runId, workflowName: CARD_PATH });
  const snapshot = typeof saved.snapshot === 'string' ? JSON.parse(saved.snapshot) : saved.snapshot;
  snapshot.value = { ...(snapshot.value ?? {}), card: 'JUL-999' };
  await workflowsStore.persistWorkflowSnapshot({
    workflowName: CARD_PATH,
    runId: run.runId,
    snapshot,
  });
  await store.close();

  const startUrl = pathToFileURL(resolve('machine/flow/start.mjs')).href;
  const childScript = `
    import { readState, resumeCard, closeFlow } from ${JSON.stringify(startUrl)};
    const dir = process.env.TEST_DIR;
    const runId = process.env.TEST_RUN_ID;
    try {
      const state = await readState({ dir, runId, agents: {} });
      const resumed = await resumeCard({ dir, runId, answer: 'yes', agents: {} });
      console.log('RESULT:' + JSON.stringify({ state, resumed }));
    } finally {
      await closeFlow();
    }
  `;

  const result = await runChild(childScript, {
    TEST_DIR: dir,
    TEST_RUN_ID: run.runId,
    CMD_API_KEY: 'unused-in-tests',
  });

  assert.equal(result.code, 0, `child failed (exit ${result.code}):\n${result.stderr}\n${result.stdout}`);
  const resultLine = result.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
  assert.ok(resultLine, `missing RESULT line in stdout:\n${result.stdout}`);
  const parsed = JSON.parse(resultLine.slice('RESULT:'.length));
  assert.equal(parsed.state.status, 'suspended');
  assert.equal(parsed.resumed.card, 'JUL-999');
});
