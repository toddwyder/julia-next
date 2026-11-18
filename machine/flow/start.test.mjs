import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
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

test('start.mjs readState succeeds and direct resumeCard rejects lock while another process holds trace.duckdb without Studio API', async t => {
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
      const state = await readState({ dir, runId, agents: {}, studioUrl: null });
      let resumeError = null;
      try {
        await resumeCard({ dir, runId, answer: 'yes', agents: {}, studioUrl: null });
      } catch (err) {
        resumeError = err?.message ?? String(err);
      }
      console.log('RESULT:' + JSON.stringify({ state, resumeError }));
    } finally {
      await closeFlow();
    }
  `;

  const result = await runChild(childScript, {
    TEST_DIR: dir,
    TEST_RUN_ID: run.runId,
    CMD_API_KEY: 'unused-in-tests',
  });

  const resultLine = result.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
  assert.ok(resultLine, `missing RESULT line in stdout (exit ${result.code}):\n${result.stderr}\n${result.stdout}`);
  const parsed = JSON.parse(resultLine.slice('RESULT:'.length));
  assert.equal(parsed.state.status, 'suspended');
  assert.match(parsed.resumeError ?? '', /Cannot open file|lock/i);
  assert.deepEqual(readdirSync(dir).filter(name => name.startsWith('trace-resume-')), []);
});

function runCli(args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
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

test('run.mjs status and resume through Studio API write spans to trace.duckdb without trace-resume files', async t => {
  const dir = tempDir(t);
  const afterResumeStep = createStep({
    id: 'after-resume-proof',
    inputSchema: z.object({ card: z.string() }),
    outputSchema: z.object({ card: z.string() }),
    execute: async ({ inputData }) => ({ card: inputData.card }),
  });
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
    .then(afterResumeStep)
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
  const wf = mastra.getWorkflow(CARD_PATH);
  const run = await wf.createRun();
  const suspended = await run.start({ inputData: { card: 'JUL-999' } });
  assert.equal(suspended.status, 'suspended');

  // Ensure initialState.card is present for Studio API & cardOfRun.
  const store = new LibSQLStore({ id: 'flow-state-seed-2', url: `file:${join(dir, 'state.db')}` });
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

  // Serve Mastra Studio's workflow endpoints from Process 1 while Process 1 holds trace.duckdb open.
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const runPrefix = `/api/workflows/${CARD_PATH}/runs/`;
      if (req.method === 'GET' && url.pathname.startsWith(runPrefix)) {
        const id = decodeURIComponent(url.pathname.slice(runPrefix.length));
        const state = await wf.getWorkflowRunById(id);
        if (!state) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Workflow run not found' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(state));
        return;
      }
      if (req.method === 'POST' && url.pathname === `/api/workflows/${CARD_PATH}/resume-async`) {
        const id = url.searchParams.get('runId');
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw || '{}');
        const activeRun = await wf.createRun({ runId: id });
        const result = await activeRun.resume({ step: body.step, resumeData: body.resumeData });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      res.writeHead(404);
      res.end();
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const { port } = server.address();
  const studioUrl = `http://127.0.0.1:${port}`;

  const statusRes = await runCli(
    ['machine/flow/run.mjs', 'status', '--dir', dir, '--run-id', run.runId],
    { FLOW_STUDIO_URL: studioUrl, CMD_API_KEY: 'unused-in-tests' },
  );
  assert.equal(statusRes.code, 0, `status failed:\n${statusRes.stderr}\n${statusRes.stdout}`);
  const statusJson = JSON.parse(statusRes.stdout);
  assert.equal(statusJson.status, 'suspended');
  assert.equal(statusJson.card, 'JUL-999');

  const resumeRes = await runCli(
    ['machine/flow/run.mjs', 'resume', '--dir', dir, '--run-id', run.runId, '--answer', 'yes'],
    { FLOW_STUDIO_URL: studioUrl, CMD_API_KEY: 'unused-in-tests' },
  );
  assert.equal(resumeRes.code, 0, `resume failed:\n${resumeRes.stderr}\n${resumeRes.stdout}`);
  const resumeJson = JSON.parse(resumeRes.stdout);
  assert.equal(resumeJson.status, 'success');
  assert.equal(resumeJson.card, 'JUL-999');

  const leftovers = readdirSync(dir).filter(name => name.startsWith('trace-resume-'));
  assert.deepEqual(leftovers, [], `unexpected trace-resume files: ${leftovers.join(', ')}`);

  await mastra.shutdown();
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(join(dir, 'trace.duckdb'), { access_mode: 'READ_ONLY' });
  const conn = await instance.connect();
  const rows = (await conn.runAndReadAll("SELECT name FROM span_events WHERE name LIKE '%after-resume-proof%'")).getRowObjectsJS();
  conn.closeSync?.();
  instance.closeSync?.();
  assert.ok(rows.length > 0, 'expected resumed step spans in trace.duckdb');
});
