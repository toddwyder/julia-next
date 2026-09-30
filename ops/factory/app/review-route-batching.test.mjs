// review-route-batching.test.mjs -- regression for the cross-maker review gate
// on large pull requests.
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
// proves the shipped wiring, not just the seam.
//
// Run it with:
//   node --experimental-strip-types --import ./register-typescript-esm.mjs \
//     --test review-route-batching.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewPullRequest } from './src/mastra/reviewer/review-pr.ts';
import { reviewerRoute } from './src/mastra/reviewer/route.ts';
import { prReviewWorkflow } from './src/mastra/reviewer/workflows/pr-review-workflow.ts';

const OWNER = 'toddwyder';
const REPO = 'julia-next';
const PULL = 176;
const HEAD = 'abc123';

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
      workflows: { prReviewWorkflow },
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
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    assert.equal(response.payload.verdict, 'REQUEST_CHANGES', 'an oversized unreviewed file must fail the verdict closed');
    assert.match(response.payload.body, /big\.ts/, 'the body names the file that could not be batched');
    assert.match(response.payload.body, /not reviewed|unreviewed|fail closed/i);
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
      workflows: { prReviewWorkflow },
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
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    assert.equal(response.payload.verdict, 'APPROVE');
    assert.equal(response.payload.headSha, HEAD);
    assert.equal(response.payload.criteria.length, 2);
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
