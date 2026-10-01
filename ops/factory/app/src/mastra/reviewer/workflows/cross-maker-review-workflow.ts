import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { reviewPullRequest } from '../review-pr';

const reviewInput = z.object({
  owner: z.string(),
  repo: z.string(),
  pullNumber: z.number().int().positive(),
  headSha: z.string(),
});

const reviewOutput = z.object({
  verdict: z.enum(['APPROVE', 'REQUEST_CHANGES']),
  headSha: z.string(),
  body: z.string(),
});

const reviewStep = createStep({
  id: 'review-pull-request',
  inputSchema: reviewInput,
  outputSchema: reviewOutput,
  execute: async ({ inputData, mastra }) => {
    const runBatchedReview = async ({ owner, repo, pullNumber }: Pick<z.infer<typeof reviewInput>, 'owner' | 'repo' | 'pullNumber'>) => {
      const workflow = mastra.getWorkflow('prReviewWorkflow');
      const run = await workflow.createRun();
      const result = await run.start({ inputData: { owner, repo, pullNumber } });
      if (result.status !== 'success') throw new Error('Batched PR review workflow did not complete.');
      return { fileReviews: result.result.fileReviews, skippedFiles: result.result.skippedFiles };
    };
    return reviewPullRequest(inputData.owner, inputData.repo, inputData.pullNumber, inputData.headSha, { runBatchedReview });
  },
});

export const crossMakerReviewWorkflow = createWorkflow({
  id: 'cross-maker-review',
  inputSchema: reviewInput,
  outputSchema: reviewOutput,
}).then(reviewStep).commit();
