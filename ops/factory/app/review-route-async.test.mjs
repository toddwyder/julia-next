import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { reviewerRoute, reviewerStatusRoute } from './src/mastra/reviewer/route.ts';

test('status route authenticates the job id and reports failed jobs', async () => {
  const secret = 'status-secret';
  process.env.JULIA_REVIEW_ROUTE_SECRET = secret;
  const mastra = { getWorkflow: () => ({
    getWorkflowRunById: async () => ({ status: 'failed', error: { message: 'model unavailable' } }),
  }) };
  const handler = await reviewerStatusRoute.createHandler({ mastra });
  const context = signature => ({
    req: { param: () => 'job-1', header: () => signature },
    json: (payload, status = 200) => ({ payload, status }),
  });
  try {
    assert.equal((await handler(context('bad'))).status, 401);
    const signature = createHmac('sha256', secret).update('job-1').digest('hex');
    const response = await handler(context(signature));
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload, { status: 'failed', error: 'model unavailable' });
  } finally {
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('GitHub action polls signed status every 30 seconds and submits the reviewed head', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cross-maker-action-'));
  const eventFile = join(directory, 'event.json');
  const headSha = 'a'.repeat(40);
  await writeFile(eventFile, JSON.stringify({ pull_request: { number: 184, head: { sha: headSha } } }));
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  const originalEnv = { ...process.env };
  const calls = [];
  const waits = [];
  process.env.GITHUB_EVENT_PATH = eventFile;
  process.env.GITHUB_REPOSITORY = 'toddwyder/julia-next';
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'test-secret';
  globalThis.setTimeout = (callback, delay) => {
    waits.push(delay);
    queueMicrotask(callback);
    return 0;
  };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return Response.json({ jobId: 'test-job' }, { status: 202 });
    if (calls.length === 2) return Response.json({ status: 'running' });
    if (calls.length === 3) return Response.json({ status: 'success', verdict: {
      verdict: 'APPROVE', headSha, body: 'Reviewed all files',
    } });
    if (calls.length === 4) return Response.json({ head: { sha: headSha } });
    if (calls.length === 5) return Response.json({ state: 'APPROVED', html_url: 'https://example.test/review' });
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await import('../../../.github/scripts/request-cross-maker-review.mjs?async-test');
    assert.deepEqual(waits, [30_000, 30_000]);
    assert.equal(calls[1].options.headers['x-julia-review-signature'],
      createHmac('sha256', 'test-secret').update('test-job').digest('hex'));
    assert.equal(calls[4].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[4].options.body), {
      commit_id: headSha, body: 'Reviewed all files', event: 'APPROVE',
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimer;
    for (const key of ['GITHUB_EVENT_PATH', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN', 'JULIA_REVIEW_ROUTE_SECRET']) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('signed start returns a job before a review lasting over three minutes finishes', async () => {
  const { Hono } = await import('hono');
  const { Mastra } = await import('@mastra/core/mastra');
  const { InMemoryStore } = await import('@mastra/core/storage');
  const { EventEmitterPubSub } = await import('@mastra/core/events');
  const { codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');
  const { crossMakerReviewWorkflow } = await import('./src/mastra/reviewer/workflows/cross-maker-review-workflow.ts');
  const { prReviewWorkflow } = await import('./src/mastra/reviewer/workflows/pr-review-workflow.ts');
  const secret = 'integration-secret';
  const headSha = 'b'.repeat(40);
  const originalFetch = globalThis.fetch;
  const originalGenerate = codeReviewAgent.generate;
  process.env.JULIA_REVIEW_ROUTE_SECRET = secret;
  globalThis.fetch = async url => {
    const path = String(url);
    if (path.includes('/pulls/184/files?')) return Response.json([{
      filename: 'src/recipe.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '+fix',
    }]);
    if (path.endsWith('/pulls/184')) return Response.json({
      title: 'Recipe fix', body: 'Closes #200', head: { sha: headSha },
    });
    if (path.endsWith('/issues/200')) return Response.json({
      body: '## Acceptance criteria\n- [ ] Recipe fix works',
    });
    throw new Error(`Unexpected GitHub request ${path}`);
  };
  let reviewerStarted;
  const started = new Promise(resolve => { reviewerStarted = resolve; });
  codeReviewAgent.generate = async () => {
    reviewerStarted();
    await new Promise(resolve => setTimeout(resolve, 181_000));
    return { object: {
      verdict: 'APPROVE', criteria: [{ number: 1, result: 'met', evidence: 'Reviewed recipe fix' }], findings: [],
    } };
  };
  const mastra = new Mastra({
    workflows: { crossMakerReviewWorkflow, prReviewWorkflow },
    agents: { codeReviewAgent },
    storage: new InMemoryStore(),
    pubsub: new EventEmitterPubSub(),
    logger: false,
  });
  const body = JSON.stringify({ owner: 'toddwyder', repo: 'julia-next', pullNumber: 184, headSha });
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  const app = new Hono();
  app.post('/julia/review-pr', await reviewerRoute.createHandler({ mastra }));
  app.get('/julia/review-pr/:jobId', await reviewerStatusRoute.createHandler({ mastra }));
  try {
    const start = await app.request('/julia/review-pr', {
      method: 'POST', headers: { 'x-julia-review-signature': signature }, body,
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    assert.ok(jobId);
    await Promise.race([
      started,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Review agent did not start')), 10_000)),
    ]);
    const getStatus = async () => {
      const response = await app.request(`/julia/review-pr/${jobId}`, {
        headers: { 'x-julia-review-signature': createHmac('sha256', secret).update(jobId).digest('hex') },
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.equal((await getStatus()).status, 'running');
    await new Promise(resolve => setTimeout(resolve, 180_100));
    assert.equal((await getStatus()).status, 'running');
    let done;
    for (let attempt = 0; attempt < 30; attempt++) {
      done = await getStatus();
      if (done.status === 'success') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(done.status, 'success');
    assert.equal(done.verdict.verdict, 'APPROVE');
    assert.equal(done.verdict.headSha, headSha);
    assert.match(done.verdict.body, /Recipe fix works/);
  } finally {
    globalThis.fetch = originalFetch;
    codeReviewAgent.generate = originalGenerate;
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});
