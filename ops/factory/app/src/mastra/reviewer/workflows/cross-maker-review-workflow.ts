import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { reviewPullRequest, verdictSchema, type RunBatchedReview } from '../review-pr';

export const reviewInput = z.object({
  owner: z.literal('toddwyder'),
  repo: z.literal('julia-next'),
  pullNumber: z.number().int().positive().refine(Number.isSafeInteger),
  headSha: z.string().min(1),
});

const reviewOutput = verdictSchema.extend({
  headSha: z.string(),
  body: z.string(),
});

const reviewStep = createStep({
  id: 'review-pull-request',
  inputSchema: reviewInput,
  outputSchema: reviewOutput,
  execute: async ({ inputData, mastra, abortSignal }) => {
    const runBatchedReview: RunBatchedReview = async ({ owner, repo, pullNumber }) => {
      const workflow = mastra.getWorkflow('prReviewWorkflow');
      const run = await workflow.createRun();
      const cancelNested = () => { void run.cancel(); };
      abortSignal.addEventListener('abort', cancelNested, { once: true });
      let result;
      try {
        if (abortSignal.aborted) throw new Error('Review canceled');
        result = await run.start({ inputData: { owner, repo, pullNumber } });
      } finally {
        abortSignal.removeEventListener('abort', cancelNested);
      }
      if (result.status !== 'success') throw new Error('Batched PR review workflow did not complete.');
      return { fileReviews: result.result.fileReviews, skippedFiles: result.result.skippedFiles };
    };
    return reviewPullRequest(inputData.owner, inputData.repo, inputData.pullNumber, inputData.headSha,
      { runBatchedReview, abortSignal });
  },
});

export const crossMakerReviewWorkflow = createWorkflow({
  id: 'cross-maker-review',
  inputSchema: reviewInput,
  outputSchema: reviewOutput,
  // A model call in a dead process cannot be resumed safely. The status route
  // marks its persisted run as interrupted after restart.
  options: { autoRestartActiveRuns: false },
}).then(reviewStep).commit();
