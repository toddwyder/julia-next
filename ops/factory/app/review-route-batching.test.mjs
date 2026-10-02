// review-route-batching.test.mjs -- regression for the cross-maker review gate
// on large pull requests and asynchronous review jobs.
//
// The route calls `reviewPullRequest`, which builds one prompt from the whole
// PR diff and refuses anything over 180,000 characters. A 5,009-addition,
// 40-file PR trips that guard, so the review never runs even though the
// repository already ships Mastra's supported batched reviewer,
// `prReviewWorkflow`.
//
// This is a public-seam test: it calls the exported `reviewPullRequest` with a
// stubbed GitHub transport (the app's real fetch boundary) and a stubbed
// batched-review runner, and asserts the supported batching path is used for a
// large review while the route's acceptance-criteria verdict contract and
// stale-head protection are preserved. A final case runs the real
// `prReviewWorkflow` through the exported route's `createHandler`, so the test
// proves the shipped wiring, not just the seam. The async job cases live here
// because CI selects this file explicitly; the 181-second case runs once.
//
// Run it with:
//   node --experimental-strip-types --import ./register-typescript-esm.mjs \
//     --test review-route-batching.test.mjs
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import test from 'node:test';

import { reviewPullRequest } from './src/mastra/reviewer/review-pr.ts';
import { reviewerRoute, reviewerStatusRoute } from './src/mastra/reviewer/route.ts';
import { prReviewWorkflow } from './src/mastra/reviewer/workflows/pr-review-workflow.ts';
import { crossMakerReviewWorkflow } from './src/mastra/reviewer/workflows/cross-maker-review-workflow.ts';

const OWNER = 'toddwyder';
const REPO = 'julia-next';
const PULL = 176;
const HEAD = 'a'.repeat(40);

async function waitForReview(mastra, jobId) {
  const workflow = mastra.getWorkflow('crossMakerReviewWorkflow');
  for (let attempt = 0; attempt < 200; attempt++) {
    const run = await workflow.getWorkflowRunById(jobId);
    if (run?.status === 'success') return run.result;
    if (run?.status === 'failed') throw new Error(run.error?.message ?? 'Review failed');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Review job ${jobId} did not finish`);
}

/** A diff comfortably over the route's 180,000-char single-prompt limit. */
function largeDiff() {
  return Array.from({ length: 2200 }, (_, i) => `+ line ${i} ${'x'.repeat(90)}`).join('\n');
}

/**
 * Stub the app's real HTTP boundary. Each `githubFetch` call is a `fetch` to
 * `https://api.github.com/...`; we return the two JSON payloads the reviewer
 * reads (the PR, then the linked issue).
 */
function stubGitHubFetch({ fileCount = 1, diff = largeDiff(), headAfterReview, headAfterPrRead } = {}) {
  const original = globalThis.fetch;
  // The reviewer reads the PR on the batched path: once before the review
  // (pre-review guard), once after the batched workflow (post-review
  // recheck) and once after the criterion verdict agent (post-verdict
  // recheck). Set `headAfterReview` to simulate a commit pushed while the
  // workflow ran, or `headAfterPrRead` (a PR-read count) to simulate a commit
  // pushed at any later point, such as while the verdict agent was thinking.
  let prReads = 0;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.endsWith(`/repos/${OWNER}/${REPO}/pulls/${PULL}`)) {
      prReads += 1;
      const newHead = prReads > 1 ? headAfterReview : undefined;
      const sha = headAfterPrRead && prReads >= headAfterPrRead ? 'pushed-mid-verdict' : (newHead ?? HEAD);
      return new Response(
        JSON.stringify({
          title: 'Large review',
          body: 'Closes #140',
          state: 'open',
          user: { login: 'factory-bot' },
          base: { ref: 'main' },
          head: { ref: 'factory/issue-140-build', sha },
          labels: [],
          created_at: '2026-09-30T00:00:00Z',
          updated_at: '2026-09-30T00:00:00Z',
          additions: 5009,
          deletions: 3,
          changed_files: fileCount,
        }),
        { status: 200 },
      );
    }
    if (path.endsWith(`/repos/${OWNER}/${REPO}/issues/140`)) {
      return new Response(
        JSON.stringify({
          body: '## Acceptance criteria\n\n- [ ] The gate passes\n- [ ] Nothing is weakened\n',
        }),
        { status: 200 },
      );
    }
    if (path.includes(`/repos/${OWNER}/${REPO}/pulls/${PULL}/files`)) {
      const files = Array.from({ length: fileCount }, (_, index) => ({
        filename: index === 0 ? 'big.ts' : `file-${index}.ts`,
        status: 'modified',
        additions: 5009,
        deletions: 3,
        changes: 5012,
        patch: diff,
      }));
      return new Response(JSON.stringify(files), { status: 200 });
    }
    if (path.includes(`/repos/${OWNER}/${REPO}/contents/`)) {
      // The workflow fetches full file content for small/medium PRs; return a
      // small body so the batch budget is driven by the patch, not the file.
      const content = Buffer.from('// file contents\n').toString('base64');
      return new Response(JSON.stringify({ type: 'file', content, size: 17 }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${path}`);
  };
  return () => {
    globalThis.fetch = original;
  };
}

test('a large PR is reviewed through the supported batched workflow, not refused', async () => {
  const restore = stubGitHubFetch();
  const batches = [];
  try {
    const verdict = await reviewPullRequest(OWNER, REPO, PULL, HEAD, {
      runBatchedReview: async (input) => {
        batches.push(input);
        return {
          fileReviews: [
            {
              filename: 'big.ts',
              issues: [
                {
                  severity: 'positive',
                  category: 'quality',
                  line: '1',
                  message: 'Batch reviewed 40 files without a single 180k prompt.',
                },
              ],
            },
          ],
        };
      },
      // The criterion verdict must never be asked to look at the whole diff.
      decideVerdict: async ({ findings }) => {
        assert.match(findings, /Batch reviewed/);
        return {
          verdict: 'APPROVE',
          criteria: [
            { number: 1, result: 'met', evidence: 'gate passes' },
            { number: 2, result: 'met', evidence: 'nothing weakened' },
          ],
          findings: [],
        };
      },
    });

    assert.equal(batches.length, 1, 'the supported batched runner must be invoked for a large PR');
    assert.equal(batches[0].owner, OWNER);
    assert.equal(batches[0].repo, REPO);
    assert.equal(batches[0].pullNumber, PULL);
    assert.equal(verdict.verdict, 'APPROVE');
    assert.equal(verdict.headSha, HEAD);
    assert.equal(verdict.criteria.length, 2);
    assert.match(verdict.body, /APPROVE/);
  } finally {
    restore();
  }
});

test('a large PR whose verdict misses a criterion is still REQUEST_CHANGES', async () => {
  const restore = stubGitHubFetch();
  try {
    const verdict = await reviewPullRequest(OWNER, REPO, PULL, HEAD, {
      runBatchedReview: async () => ({ fileReviews: [], skippedFiles: [] }),
      decideVerdict: async () => ({
        verdict: 'APPROVE',
        criteria: [{ number: 1, result: 'met', evidence: 'only one criterion answered' }],
        findings: [],
      }),
    });
    assert.equal(verdict.verdict, 'REQUEST_CHANGES');
  } finally {
    restore();
  }
});

test('the batched path keeps stale-head protection', async () => {
  const restore = stubGitHubFetch();
  let ran = false;
  try {
    await assert.rejects(
      () => reviewPullRequest(OWNER, REPO, PULL, 'different-head', {
        runBatchedReview: async () => {
          ran = true;
          return { fileReviews: [], skippedFiles: [] };
        },
      }),
      /head changed/i,
    );
    assert.equal(ran, false, 'a changed head must be refused before any review runs');
  } finally {
    restore();
  }
});

test('a commit pushed while the batched workflow runs is rejected by the post-review recheck', async () => {
  // The first PR read matches the requested head, so the pre-review guard
  // passes; the commit lands while `runBatchedReview` is running, so the
  // second read returns a new SHA. The recheck must refuse the stale verdict.
  const newHead = 'def456';
  const restore = stubGitHubFetch({ headAfterReview: newHead });
  let ran = false;
  let verdictDecided = false;
  try {
    await assert.rejects(
      () => reviewPullRequest(OWNER, REPO, PULL, HEAD, {
        runBatchedReview: async () => {
          ran = true;
          return { fileReviews: [], skippedFiles: [] };
        },
        decideVerdict: async () => {
          verdictDecided = true;
          return {
            verdict: 'APPROVE',
            criteria: [
              { number: 1, result: 'met', evidence: 'gate passes' },
              { number: 2, result: 'met', evidence: 'nothing weakened' },
            ],
            findings: [],
          };
        },
      }),
      /head changed/i,
    );
    assert.equal(ran, true, 'the batched review must have run before the recheck');
    assert.equal(verdictDecided, false, 'a stale head must be refused before any verdict is decided');
  } finally {
    restore();
  }
});

test('a skipped reviewable file fails the batched path closed instead of approving it', async () => {
  const restore = stubGitHubFetch();
  try {
    const verdict = await reviewPullRequest(OWNER, REPO, PULL, HEAD, {
      // The workflow covers `big.ts` but skips `src/feature.ts`, a reviewable
      // source file it dropped from its batches. The route must not approve
      // material it never reviewed.
      runBatchedReview: async () => ({
        fileReviews: [{ filename: 'big.ts', issues: [] }],
        skippedFiles: ['src/feature.ts'],
      }),
      decideVerdict: async ({ findings }) => {
        assert.match(findings, /src\/feature\.ts/, 'the verdict agent must see the skipped material');
        assert.match(findings, /not reviewed/i);
        return {
          verdict: 'APPROVE',
          criteria: [
            { number: 1, result: 'met', evidence: 'gate passes' },
            { number: 2, result: 'met', evidence: 'nothing weakened' },
          ],
          findings: [],
        };
      },
    });
    assert.equal(verdict.verdict, 'REQUEST_CHANGES', 'a skipped reviewable file can never be approved');
    assert.match(verdict.body, /src\/feature\.ts/, 'the body must name the unreviewed material');
    assert.match(verdict.body, /not reviewed|unreviewed|fail closed/i);
  } finally {
    restore();
  }
});

test('a skipped non-reviewable file is recorded but does not block approval', async () => {
  const restore = stubGitHubFetch();
  try {
    const verdict = await reviewPullRequest(OWNER, REPO, PULL, HEAD, {
      runBatchedReview: async () => ({
        fileReviews: [{ filename: 'big.ts', issues: [] }],
        skippedFiles: ['package-lock.json'],
      }),
      decideVerdict: async ({ findings }) => {
        assert.match(findings, /package-lock\.json/, 'skipped files are always surfaced with evidence');
        return {
          verdict: 'APPROVE',
          criteria: [
            { number: 1, result: 'met', evidence: 'gate passes' },
            { number: 2, result: 'met', evidence: 'nothing weakened' },
          ],
          findings: [],
        };
      },
    });
    assert.equal(verdict.verdict, 'APPROVE', 'a lock file is non-reviewable by policy');
    assert.match(verdict.body, /package-lock\.json/);
  } finally {
    restore();
  }
});

/**
 * The batched path already covers the pre-review guard and the post-workflow
 * recheck. This is the next window: a commit that lands while the criterion
 * verdict agent is thinking. The final head must be re-read after that agent
 * completes, before the verdict is returned, or a stale APPROVE ships.
 */
test('a commit pushed during the criterion verdict agent is rejected by the post-verdict recheck', async () => {
  // Reads: 1 = pre-review guard (HEAD), 2 = post-workflow recheck (HEAD),
  // 3 = post-verdict recheck (new head, pushed while the agent ran).
  const restore = stubGitHubFetch({ headAfterPrRead: 3 });
  let verdictDecided = false;
  try {
    await assert.rejects(
      () => reviewPullRequest(OWNER, REPO, PULL, HEAD, {
        runBatchedReview: async () => ({ fileReviews: [{ filename: 'big.ts', issues: [] }], skippedFiles: [] }),
        decideVerdict: async () => {
          verdictDecided = true;
          return {
            verdict: 'APPROVE',
            criteria: [
              { number: 1, result: 'met', evidence: 'gate passes' },
              { number: 2, result: 'met', evidence: 'nothing weakened' },
            ],
            findings: [],
          };
        },
      }),
      /head changed/i,
    );
    assert.equal(verdictDecided, true, 'the verdict agent must have run before the final recheck');
  } finally {
    restore();
  }
});

test('the batched path refuses an unseen reviewable PR file (fail closed)', async () => {
  const restore = stubGitHubFetch({ fileCount: 3 });
  try {
    const verdict = await reviewPullRequest(OWNER, REPO, PULL, HEAD, {
      // The workflow covers only `big.ts`; `file-1.ts` and `file-2.ts` are
      // reviewable changed files it never mentions in fileReviews or
      // skippedFiles. Silence is not evidence of review.
      runBatchedReview: async () => ({
        fileReviews: [{ filename: 'big.ts', issues: [] }],
        skippedFiles: [],
      }),
      decideVerdict: async () => ({
        verdict: 'APPROVE',
        criteria: [
          { number: 1, result: 'met', evidence: 'gate passes' },
          { number: 2, result: 'met', evidence: 'nothing weakened' },
        ],
        findings: [],
      }),
    });
    assert.equal(verdict.verdict, 'REQUEST_CHANGES', 'a changed reviewable file absent from the workflow result can never be approved');
    assert.match(verdict.body, /file-1\.ts/, 'the body must name the unreviewed file');
    assert.match(verdict.body, /file-2\.ts/, 'the body must name every unreviewed file');
    assert.match(verdict.body, /not reviewed|unreviewed|fail closed/i);
  } finally {
    restore();
  }
});

test('a workflow result that accounts for every changed reviewable file may still approve', async () => {
  const restore = stubGitHubFetch({ fileCount: 3 });
  try {
    const verdict = await reviewPullRequest(OWNER, REPO, PULL, HEAD, {
      // Every changed reviewable file appears in fileReviews, so there is no
      // silent gap and the approval stands.
      runBatchedReview: async () => ({
        fileReviews: [
          { filename: 'big.ts', issues: [] },
          { filename: 'file-1.ts', issues: [] },
          { filename: 'file-2.ts', issues: [] },
        ],
        skippedFiles: [],
      }),
      decideVerdict: async () => ({
        verdict: 'APPROVE',
        criteria: [
          { number: 1, result: 'met', evidence: 'gate passes' },
          { number: 2, result: 'met', evidence: 'nothing weakened' },
        ],
        findings: [],
      }),
    });
    assert.equal(verdict.verdict, 'APPROVE', 'a fully accounted-for result may approve');
  } finally {
    restore();
  }
});

test('the real prReviewWorkflow skips a file larger than the batch budget and records it', async () => {
  const { prReviewWorkflow } = await import('./src/mastra/reviewer/workflows/pr-review-workflow.ts');
  const { planFileBatches, BATCH_CHAR_BUDGET } = await import('./src/mastra/reviewer/workflows/pr-review-workflow.ts');
  // A single section (filename + patch framing + patch) over the 400,000-char
  // budget. `batchFiles` must not place it in a batch that then exceeds the
  // budget; it is returned separately so the workflow can mark it unreviewed.
  const oversized = { filename: 'huge.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: 'x'.repeat(BATCH_CHAR_BUDGET + 10_000) };
  const normal = { filename: 'small.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '+ ok' };
  const { batches, oversized: tooBig } = planFileBatches(
    [{ ...oversized, content: '' }, { ...normal, content: '' }],
    false,
  );
  assert.deepEqual(tooBig, ['huge.ts'], 'a single oversized file is reported, not batched');
  for (const batch of batches) {
    const chars = batch.reduce((n, f) => n + f.filename.length + (f.patch?.length ?? 0) + 64, 0);
    assert.ok(chars <= BATCH_CHAR_BUDGET, `batch exceeds the character budget: ${chars}`);
    assert.ok(!batch.some(f => f.filename === 'huge.ts'), 'the oversized file must not be in any batch');
  }
});

test('a file larger than the batch budget is returned as skipped and fails the review closed', async () => {
  const { Mastra } = await import('@mastra/core/mastra');
  const { InMemoryStore } = await import('@mastra/core/storage');
  const { EventEmitterPubSub } = await import('@mastra/core/events');
  const { workflowReviewAgent } = await import('./src/mastra/reviewer/agents/workflow-review-agent.ts');
  const { codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');

  // One file's diff alone exceeds BATCH_CHAR_BUDGET; a second normal file fits.
  const huge = 'x'.repeat(450_000);
  const restoreFetch = stubGitHubFetch({ fileCount: 2, diff: huge });
  const originalWorkflowGenerate = workflowReviewAgent.generate;
  const originalCodeGenerate = codeReviewAgent.generate;
  const prompts = [];
  workflowReviewAgent.generate = async (prompt) => {
    prompts.push(prompt);
    if (prompt.includes('Synthesize a final PR review')) {
      return {
        object: {
          summary: 'ok',
          qualityScore: 8,
          verdict: 'APPROVE',
          criticalIssues: [],
          securityConcerns: [],
          performanceNotes: [],
          suggestions: [],
          positiveNotes: [],
        },
      };
    }
    return { object: [...prompt.matchAll(/^### (\S+) \(/gm)].map((match) => ({ filename: match[1], issues: [] })) };
  };
  codeReviewAgent.generate = async () => ({
    object: {
      verdict: 'APPROVE',
      criteria: [
        { number: 1, result: 'met', evidence: 'gate passes' },
        { number: 2, result: 'met', evidence: 'nothing weakened' },
      ],
      findings: [],
    },
  });

  const secret = 'test-review-secret';
  process.env.JULIA_REVIEW_ROUTE_SECRET = secret;
  try {
    const mastra = new Mastra({
      workflows: { prReviewWorkflow, crossMakerReviewWorkflow },
      agents: { workflowReviewAgent, codeReviewAgent },
      storage: new InMemoryStore(),
      pubsub: new EventEmitterPubSub(),
      logger: false,
    });
    const handler = await reviewerRoute.createHandler({ mastra });
    const requestBody = JSON.stringify({ owner: OWNER, repo: REPO, pullNumber: PULL, headSha: HEAD });
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', secret).update(requestBody).digest('hex');
    const context = {
      req: {
        text: async () => requestBody,
        header: (name) => (name === 'x-julia-review-signature' ? signature : undefined),
      },
      json: (payload, status = 200) => ({ payload, status }),
    };

    const response = await handler(context);
    assert.equal(response.status, 202, JSON.stringify(response.payload));
    const result = await waitForReview(mastra, response.payload.jobId);
    const statusHandler = await reviewerStatusRoute.createHandler({ mastra });
    const statusSignature = createHmac('sha256', secret).update(response.payload.jobId).digest('hex');
    const statusResponse = await statusHandler({ ...context, req: {
      ...context.req,
      param: () => response.payload.jobId,
      header: () => statusSignature,
    } });
    assert.equal(statusResponse.status, 200);
    assert.equal(statusResponse.payload.status, 'success');
    assert.equal(statusResponse.payload.verdict.verdict, 'REQUEST_CHANGES');
    assert.equal(result.verdict, 'REQUEST_CHANGES', 'an oversized unreviewed file must fail the verdict closed');
    assert.match(result.body, /big\.ts/, 'the body names the file that could not be batched');
    assert.match(result.body, /not reviewed|unreviewed|fail closed/i);
    // No agent prompt may contain the oversized diff; the point of the budget.
    assert.ok(!prompts.some((prompt) => prompt.includes('x'.repeat(1000))));

    // The workflow's own aggregate verdict must also fail closed, not just the
    // cross-maker route: a direct consumer of `prReviewWorkflow` sees the same
    // refusal with evidence.
    const workflow = mastra.getWorkflow('prReviewWorkflow');
    const run = await workflow.createRun();
    const direct = await run.start({ inputData: { owner: OWNER, repo: REPO, pullNumber: PULL } });
    assert.equal(direct.status, 'success');
    assert.equal(direct.result.verdict, 'REQUEST_CHANGES', 'the workflow itself fails closed on an unreviewed file');
    assert.ok(direct.result.skippedFiles.includes('big.ts'));
    assert.match(direct.result.summary, /fail closed|not reviewed/i);
  } finally {
    restoreFetch();
    workflowReviewAgent.generate = originalWorkflowGenerate;
    codeReviewAgent.generate = originalCodeGenerate;
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('the route runs the real supported prReviewWorkflow for a large PR', async () => {
  const { Mastra } = await import('@mastra/core/mastra');
  const { InMemoryStore } = await import('@mastra/core/storage');
  const { EventEmitterPubSub } = await import('@mastra/core/events');
  const { workflowReviewAgent } = await import('./src/mastra/reviewer/agents/workflow-review-agent.ts');
  const { codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');

  const restoreFetch = stubGitHubFetch({ fileCount: 40 });
  const originalWorkflowGenerate = workflowReviewAgent.generate;
  const originalCodeGenerate = codeReviewAgent.generate;
  const prompts = [];
  // No model call in a unit test: the workflow agent answers the two structured
  // steps it is used for; the criterion agent answers the verdict.
  workflowReviewAgent.generate = async (prompt) => {
    prompts.push(prompt);
    if (prompt.includes('Synthesize a final PR review')) {
      return {
        object: {
          summary: 'ok',
          qualityScore: 8,
          verdict: 'APPROVE',
          criticalIssues: [],
          securityConcerns: [],
          performanceNotes: [],
          suggestions: [],
          positiveNotes: [],
        },
      };
    }
    // The workflow asks for one entry per file; answer for exactly the files
    // named in the prompt, like a real agent would, so the route's coverage
    // reconciliation sees every changed reviewable file accounted for.
    const filenames = [...prompt.matchAll(/^### (\S+) \(/gm)].map((match) => match[1]);
    return { object: filenames.map((filename) => ({ filename, issues: [] })) };
  };
  codeReviewAgent.generate = async () => ({
    object: {
      verdict: 'APPROVE',
      criteria: [
        { number: 1, result: 'met', evidence: 'gate passes' },
        { number: 2, result: 'met', evidence: 'nothing weakened' },
      ],
      findings: [],
    },
  });

  const secret = 'test-review-secret';
  process.env.JULIA_REVIEW_ROUTE_SECRET = secret;
  try {
    const mastra = new Mastra({
      workflows: { prReviewWorkflow, crossMakerReviewWorkflow },
      agents: { workflowReviewAgent, codeReviewAgent },
      storage: new InMemoryStore(),
      pubsub: new EventEmitterPubSub(),
      logger: false,
    });
    const handler = await reviewerRoute.createHandler({ mastra });
    const requestBody = JSON.stringify({ owner: OWNER, repo: REPO, pullNumber: PULL, headSha: HEAD });
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', secret).update(requestBody).digest('hex');
    const context = {
      req: {
        text: async () => requestBody,
        header: (name) => (name === 'x-julia-review-signature' ? signature : undefined),
      },
      json: (payload, status = 200) => ({ payload, status }),
    };

    const response = await handler(context);
    assert.equal(response.status, 202, JSON.stringify(response.payload));
    const result = await waitForReview(mastra, response.payload.jobId);
    assert.equal(result.verdict, 'APPROVE');
    assert.equal(result.headSha, HEAD);
    assert.equal(result.criteria.length, 2, 'the completed job retains criterion evidence');
    // The route actually ran the workflow's batched file review, and the
    // criterion prompt saw only findings, never the giant diff.
    assert.ok(prompts.some((prompt) => prompt.includes('Files to Review') || prompt.includes('Batch ')));
    assert.ok(!prompts.some((prompt) => prompt.includes('x'.repeat(200))));
  } finally {
    restoreFetch();
    workflowReviewAgent.generate = originalWorkflowGenerate;
    codeReviewAgent.generate = originalCodeGenerate;
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('canceling a large review aborts the nested file-review model call', async () => {
  const { Mastra } = await import('@mastra/core/mastra');
  const { InMemoryStore } = await import('@mastra/core/storage');
  const { EventEmitterPubSub } = await import('@mastra/core/events');
  const { workflowReviewAgent } = await import('./src/mastra/reviewer/agents/workflow-review-agent.ts');
  const { codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');
  const { reviewerCancelRoute } = await import('./src/mastra/reviewer/route.ts');
  const restoreFetch = stubGitHubFetch({ fileCount: 40 });
  const originalGenerate = workflowReviewAgent.generate;
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'large-cancel-secret';
  let agentStarted;
  const started = new Promise(resolve => { agentStarted = resolve; });
  let signalReceived;
  const aborted = new Promise(resolve => { signalReceived = resolve; });
  workflowReviewAgent.generate = async (_prompt, options) => {
    agentStarted();
    return new Promise((_resolve, reject) => {
      options.abortSignal?.addEventListener('abort', () => {
        signalReceived();
        reject(new Error('Nested provider request aborted'));
      }, { once: true });
    });
  };
  const mastra = new Mastra({
    workflows: { prReviewWorkflow, crossMakerReviewWorkflow },
    agents: { workflowReviewAgent, codeReviewAgent }, storage: new InMemoryStore(),
    pubsub: new EventEmitterPubSub(), logger: false,
  });
  const startHandler = await reviewerRoute.createHandler({ mastra });
  const cancelHandler = await reviewerCancelRoute.createHandler({ mastra });
  const body = JSON.stringify({ owner: OWNER, repo: REPO, pullNumber: PULL, headSha: HEAD });
  try {
    const start = await startHandler({
      req: { text: async () => body, header: () => createHmac('sha256', 'large-cancel-secret').update(body).digest('hex') },
      json: (payload, status = 200) => ({ payload, status }),
    });
    assert.equal(start.status, 202);
    await started;
    const jobId = start.payload.jobId;
    const cancel = await cancelHandler({
      req: { param: () => jobId, header: () => createHmac('sha256', 'large-cancel-secret').update(jobId).digest('hex') },
      json: (payload, status = 200) => ({ payload, status }),
    });
    assert.equal(cancel.payload.status, 'canceled');
    await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error('Nested model call was not aborted')), 2000))]);
  } finally {
    restoreFetch();
    workflowReviewAgent.generate = originalGenerate;
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('a small PR keeps the original single-prompt path', async () => {
  const { codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');
  const originalCodeGenerate = codeReviewAgent.generate;
  const restoreFetch = stubGitHubFetch({ fileCount: 1, diff: '+ one small change' });
  const prompts = [];
  codeReviewAgent.generate = async (prompt) => {
    prompts.push(prompt);
    return {
      object: {
        verdict: 'APPROVE',
        criteria: [
          { number: 1, result: 'met', evidence: 'gate passes' },
          { number: 2, result: 'met', evidence: 'nothing weakened' },
        ],
        findings: [],
      },
    };
  };
  try {
    const verdict = await reviewPullRequest(OWNER, REPO, PULL, HEAD, {
      runBatchedReview: async () => {
        throw new Error('a small PR must not use the batched workflow');
      },
    });
    assert.equal(verdict.verdict, 'APPROVE');
    assert.ok(prompts[0].includes('+ one small change'), 'the small path still reviews the diff directly');
  } finally {
    restoreFetch();
    codeReviewAgent.generate = originalCodeGenerate;
  }
});

test('the single-prompt path rechecks the head after its criterion verdict agent', async () => {
  const { codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');
  const originalCodeGenerate = codeReviewAgent.generate;
  // Read 1 = pre-review guard (HEAD), read 2 = post-verdict recheck (pushed).
  const restoreFetch = stubGitHubFetch({ fileCount: 1, diff: '+ one small change', headAfterPrRead: 2 });
  let verdictDecided = false;
  codeReviewAgent.generate = async () => {
    verdictDecided = true;
    return {
      object: {
        verdict: 'APPROVE',
        criteria: [
          { number: 1, result: 'met', evidence: 'gate passes' },
          { number: 2, result: 'met', evidence: 'nothing weakened' },
        ],
        findings: [],
      },
    };
  };
  try {
    await assert.rejects(
      () => reviewPullRequest(OWNER, REPO, PULL, HEAD),
      /head changed/i,
    );
    assert.equal(verdictDecided, true, 'the verdict agent ran before the stale head was caught');
  } finally {
    restoreFetch();
    codeReviewAgent.generate = originalCodeGenerate;
  }
});

// Async job and action integration cases run from this CI-selected suite.
test('status route authenticates the job id and reports failed jobs', async () => {
  const secret = 'status-secret';
  process.env.JULIA_REVIEW_ROUTE_SECRET = secret;
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => { logs.push(args.map(arg => inspect(arg)).join(' ')); };
  const mastra = { getWorkflow: () => ({
    getWorkflowRunById: async () => ({ status: 'failed', error: { message: 'provider token=secret123', code: 'RATE_LIMIT', status: 429 } }),
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
    assert.deepEqual(response.payload, { status: 'failed', error: 'Review job failed' });
    assert.match(logs.join('\n'), /job=job-1 status=failed/);
    assert.match(logs.join('\n'), /code=RATE_LIMIT statusCode=429/);
    assert.doesNotMatch(logs.join('\n'), /secret123/);
  } finally {
    console.error = originalError;
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('status route preserves a canceled job status', async () => {
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'status-secret';
  const mastra = { getWorkflow: () => ({
    getWorkflowRunById: async () => ({ status: 'canceled' }),
  }) };
  const handler = await reviewerStatusRoute.createHandler({ mastra });
  const signature = createHmac('sha256', 'status-secret').update('job-2').digest('hex');
  try {
    const response = await handler({
      req: { param: () => 'job-2', header: () => signature },
      json: (payload, status = 200) => ({ payload, status }),
    });
    assert.equal(response.payload.status, 'canceled');
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

test('signed start rejects an invalid pull request before creating a job', async () => {
  const secret = 'validation-secret';
  process.env.JULIA_REVIEW_ROUTE_SECRET = secret;
  const mastra = { getWorkflow: () => { throw new Error('A workflow must not start'); } };
  const handler = await reviewerRoute.createHandler({ mastra });
  try {
    for (const input of [
      { owner: 'toddwyder', repo: 'julia-next', pullNumber: '184', headSha: 'abc123' },
      { owner: 'someone-else', repo: 'julia-next', pullNumber: 184, headSha: 'abc123' },
      { owner: 'toddwyder', repo: 'julia-next', pullNumber: 184, headSha: 'bad-head' },
    ]) {
      const body = JSON.stringify(input);
      const signature = createHmac('sha256', secret).update(body).digest('hex');
      const response = await handler({
        req: { text: async () => body, header: () => signature },
        json: (payload, status = 200) => ({ payload, status }),
      });
      assert.equal(response.status, 400);
    }
  } finally {
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('action reports a missing completed verdict clearly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cross-maker-missing-verdict-'));
  const eventFile = join(directory, 'event.json');
  await writeFile(eventFile, JSON.stringify({ pull_request: { number: 184, head: { sha: 'a'.repeat(40) } } }));
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  const originalEnv = { ...process.env };
  process.env.GITHUB_EVENT_PATH = eventFile;
  process.env.GITHUB_REPOSITORY = 'toddwyder/julia-next';
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'test-secret';
  let calls = 0;
  globalThis.setTimeout = callback => { queueMicrotask(callback); return 0; };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return Response.json({ jobId: 'missing-result' }, { status: 202 });
    if (calls === 2) return Response.json({ status: 'success' });
    throw new Error('Unexpected request');
  };
  try {
    await assert.rejects(import('../../../.github/scripts/request-cross-maker-review.mjs?missing-verdict'),
      /invalid or stale verdict/i);
    assert.equal(calls, 2);
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

test('action reports a failed job without echoing upstream error text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cross-maker-failed-job-'));
  const eventFile = join(directory, 'event.json');
  await writeFile(eventFile, JSON.stringify({ pull_request: { number: 184, head: { sha: 'a'.repeat(40) } } }));
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  const originalEnv = { ...process.env };
  process.env.GITHUB_EVENT_PATH = eventFile;
  process.env.GITHUB_REPOSITORY = 'toddwyder/julia-next';
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'test-secret';
  let calls = 0;
  globalThis.setTimeout = callback => { queueMicrotask(callback); return 0; };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return Response.json({ jobId: 'failed-job' }, { status: 202 });
    if (calls === 2) return Response.json({ status: 'failed', error: 'provider token=secret123' });
    throw new Error('Unexpected request');
  };
  try {
    await assert.rejects(import('../../../.github/scripts/request-cross-maker-review.mjs?failed-job'),
      error => /failed-job.*failed/.test(error.message) && !error.message.includes('secret123'));
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

test('action stops a stalled review after 30 minutes and cancels its job', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cross-maker-timeout-'));
  const eventFile = join(directory, 'event.json');
  await writeFile(eventFile, JSON.stringify({ pull_request: { number: 184, head: { sha: 'a'.repeat(40) } } }));
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  const originalEnv = { ...process.env };
  process.env.GITHUB_EVENT_PATH = eventFile;
  process.env.GITHUB_REPOSITORY = 'toddwyder/julia-next';
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'test-secret';
  let polls = 0;
  let waits = 0;
  let cancel;
  globalThis.setTimeout = callback => { waits += 1; queueMicrotask(callback); return 0; };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') return Response.json({ jobId: 'stalled-job' }, { status: 202 });
    if (options.method === 'DELETE') { cancel = { url: String(url), options }; return Response.json({ status: 'canceled' }); }
    polls += 1;
    return Response.json({ status: 'running' });
  };
  try {
    await assert.rejects(import('../../../.github/scripts/request-cross-maker-review.mjs?stalled-job'),
      /did not finish within 30 minutes/i);
    assert.equal(waits, 60);
    assert.equal(polls, 60);
    assert.match(cancel.url, /\/julia\/review-pr\/stalled-job$/);
    assert.equal(cancel.options.headers['x-julia-review-signature'],
      createHmac('sha256', 'test-secret').update('stalled-job').digest('hex'));
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

test('signed DELETE cancels an active review job', async () => {
  const { reviewerCancelRoute } = await import('./src/mastra/reviewer/route.ts');
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'cancel-secret';
  let canceled = false;
  const workflow = {
    getWorkflowRunById: async () => ({ status: canceled ? 'canceled' : 'running' }),
    createRun: async ({ runId }) => ({ cancel: async () => { assert.equal(runId, 'job-1'); canceled = true; } }),
  };
  const handler = await reviewerCancelRoute.createHandler({ mastra: { getWorkflow: () => workflow } });
  const context = signature => ({
    req: { param: () => 'job-1', header: () => signature },
    json: (payload, status = 200) => ({ payload, status }),
  });
  try {
    assert.equal((await handler(context('bad'))).status, 401);
    assert.equal(canceled, false);
    const signature = createHmac('sha256', 'cancel-secret').update('job-1').digest('hex');
    assert.deepEqual((await handler(context(signature))).payload, { status: 'canceled' });
    assert.equal(canceled, true);
  } finally {
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('starting a newer review cancels an active review for the same PR', async () => {
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'dedupe-secret';
  const events = [];
  const workflow = {
    listActiveWorkflowRuns: async () => ({ runs: [
      { runId: 'old-job', resourceId: 'toddwyder/julia-next#184' },
      { runId: 'other-pr-job', resourceId: 'toddwyder/julia-next#185' },
    ] }),
    createRun: async options => {
      if (options.runId) return { cancel: async () => events.push(`cancel:${options.runId}`) };
      events.push(`create:${options.resourceId}`);
      return { startAsync: async () => { events.push('start:new-job'); return { runId: 'new-job' }; } };
    },
  };
  const handler = await reviewerRoute.createHandler({ mastra: { getWorkflow: () => workflow } });
  const body = JSON.stringify({ owner: 'toddwyder', repo: 'julia-next', pullNumber: 184, headSha: 'b'.repeat(40) });
  const signature = createHmac('sha256', 'dedupe-secret').update(body).digest('hex');
  try {
    const response = await handler({
      req: { text: async () => body, header: () => signature },
      json: (payload, status = 200) => ({ payload, status }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.payload, { jobId: 'new-job' });
    assert.deepEqual(events, ['cancel:old-job', 'create:toddwyder/julia-next#184', 'start:new-job']);
  } finally {
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('canceling through HTTP aborts the active model call', async () => {
  const { Hono } = await import('hono');
  const { Mastra } = await import('@mastra/core/mastra');
  const { InMemoryStore } = await import('@mastra/core/storage');
  const { EventEmitterPubSub } = await import('@mastra/core/events');
  const { codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');
  const { reviewerCancelRoute } = await import('./src/mastra/reviewer/route.ts');
  const secret = 'abort-secret';
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
  let signalReceived;
  const aborted = new Promise(resolve => { signalReceived = resolve; });
  let agentStarted;
  const started = new Promise(resolve => { agentStarted = resolve; });
  codeReviewAgent.generate = async (_prompt, options) => {
    agentStarted();
    return new Promise((_resolve, reject) => {
      options.abortSignal?.addEventListener('abort', () => {
        signalReceived();
        reject(new Error('Provider request aborted'));
      }, { once: true });
    });
  };
  const mastra = new Mastra({
    workflows: { crossMakerReviewWorkflow, prReviewWorkflow },
    agents: { codeReviewAgent }, storage: new InMemoryStore(),
    pubsub: new EventEmitterPubSub(), logger: false,
  });
  const app = new Hono();
  app.post('/julia/review-pr', await reviewerRoute.createHandler({ mastra }));
  app.get('/julia/review-pr/:jobId', await reviewerStatusRoute.createHandler({ mastra }));
  app.delete('/julia/review-pr/:jobId', await reviewerCancelRoute.createHandler({ mastra }));
  const body = JSON.stringify({ owner: 'toddwyder', repo: 'julia-next', pullNumber: 184, headSha });
  try {
    const start = await app.request('/julia/review-pr', {
      method: 'POST', headers: { 'x-julia-review-signature': createHmac('sha256', secret).update(body).digest('hex') }, body,
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    await started;
    const signature = createHmac('sha256', secret).update(jobId).digest('hex');
    const cancel = await app.request(`/julia/review-pr/${jobId}`, {
      method: 'DELETE', headers: { 'x-julia-review-signature': signature },
    });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json()).status, 'canceled');
    await Promise.race([
      aborted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Model call was not aborted')), 2000)),
    ]);
    const status = await app.request(`/julia/review-pr/${jobId}`, {
      headers: { 'x-julia-review-signature': signature },
    });
    assert.equal((await status.json()).status, 'canceled');
  } finally {
    globalThis.fetch = originalFetch;
    codeReviewAgent.generate = originalGenerate;
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('status closes a running job left by an earlier server process', async () => {
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'restart-secret';
  let canceled = false;
  const workflow = {
    getWorkflowRunById: async () => ({ status: 'running', createdAt: new Date(0) }),
    createRun: async () => ({ cancel: async () => { canceled = true; } }),
  };
  const handler = await reviewerStatusRoute.createHandler({ mastra: { getWorkflow: () => workflow } });
  const signature = createHmac('sha256', 'restart-secret').update('old-job').digest('hex');
  try {
    const response = await handler({
      req: { param: () => 'old-job', header: () => signature },
      json: (payload, status = 200) => ({ payload, status }),
    });
    assert.equal(canceled, true);
    assert.deepEqual(response.payload, { status: 'canceled', error: 'Review interrupted by server restart' });
  } finally {
    delete process.env.JULIA_REVIEW_ROUTE_SECRET;
  }
});

test('action sees a failed real HTTP workflow and submits no GitHub review', async () => {
  const { Hono } = await import('hono');
  const { Mastra } = await import('@mastra/core/mastra');
  const { InMemoryStore } = await import('@mastra/core/storage');
  const { EventEmitterPubSub } = await import('@mastra/core/events');
  const { codeReviewAgent } = await import('./src/mastra/reviewer/agents/code-review-agent.ts');
  const directory = await mkdtemp(join(tmpdir(), 'cross-maker-assembled-failure-'));
  const eventFile = join(directory, 'event.json');
  const headSha = 'c'.repeat(40);
  await writeFile(eventFile, JSON.stringify({ pull_request: { number: 184, head: { sha: headSha } } }));
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  const originalGenerate = codeReviewAgent.generate;
  const originalEnv = { ...process.env };
  process.env.GITHUB_EVENT_PATH = eventFile;
  process.env.GITHUB_REPOSITORY = 'toddwyder/julia-next';
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.JULIA_REVIEW_ROUTE_SECRET = 'assembled-secret';
  codeReviewAgent.generate = async () => { throw new Error('Provider unavailable'); };
  const mastra = new Mastra({
    workflows: { crossMakerReviewWorkflow, prReviewWorkflow }, agents: { codeReviewAgent },
    storage: new InMemoryStore(), pubsub: new EventEmitterPubSub(), logger: false,
  });
  const app = new Hono();
  app.post('/julia/review-pr', await reviewerRoute.createHandler({ mastra }));
  app.get('/julia/review-pr/:jobId', await reviewerStatusRoute.createHandler({ mastra }));
  app.delete('/julia/review-pr/:jobId', await (await import('./src/mastra/reviewer/route.ts')).reviewerCancelRoute.createHandler({ mastra }));
  let reviewsSubmitted = 0;
  const waits = [];
  globalThis.setTimeout = (callback, delay) => { waits.push(delay); return originalTimer(callback, 5); };
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.startsWith('https://julia-factory.tail91f394.ts.net/')) return app.request(new Request(path, options));
    if (path.includes('/pulls/184/files?')) return Response.json([{
      filename: 'src/recipe.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '+fix',
    }]);
    if (path.endsWith('/pulls/184')) return Response.json({
      title: 'Recipe fix', body: 'Closes #200', head: { sha: headSha },
    });
    if (path.endsWith('/issues/200')) return Response.json({
      body: '## Acceptance criteria\n- [ ] Recipe fix works',
    });
    if (path.endsWith('/pulls/184/reviews')) { reviewsSubmitted += 1; return Response.json({ state: 'APPROVED' }); }
    throw new Error(`Unexpected request ${path}`);
  };
  try {
    await assert.rejects(import('../../../.github/scripts/request-cross-maker-review.mjs?assembled-failure'),
      /job .* stopped with status failed/);
    assert.equal(reviewsSubmitted, 0);
    assert.ok(waits.includes(30_000));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimer;
    codeReviewAgent.generate = originalGenerate;
    for (const key of ['GITHUB_EVENT_PATH', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN', 'JULIA_REVIEW_ROUTE_SECRET']) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
