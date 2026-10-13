import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { productionLauncher } from '../../../../scripts/julia-delivery-runner.mjs';
import { checkedReview } from '../../../../scripts/julia-delivery-review.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function saveResult(runDirectory, name, value) {
  await mkdir(runDirectory, { recursive: true });
  const resultPath = join(runDirectory, name);
  await writeFile(resultPath, `${JSON.stringify(value)}\n`);
  return { resultPath };
}

// This is deliberately glue, not another launcher or reviewer. The workflow
// calls the runner's established productionLauncher for both roles; that
// launcher's `mastraReviewOnly` branch owns the existing reviewer.mjs process.
export function createExistingDeliveryStepAdapters({
  worktree,
  launch = productionLauncher(worktree),
  checks,
  notify,
}) {
  if (!worktree) throw new Error('existing delivery steps require a worktree');
  if (typeof launch !== 'function' || typeof checks !== 'function' || typeof notify !== 'function') {
    throw new Error('existing delivery steps require launcher, checks and notification boundaries');
  }
  return {
    builder: async input => {
      const approved = await readJson(input.approvedInputPath);
      const request = approved.builderRequest;
      if (!request?.configuration || typeof request.prompt !== 'string') throw new Error('approved input has no existing builder launch request');
      const launched = await launch('builder', { ...request, round: input.round });
      return saveResult(input.runDirectory, `builder-${input.round}.json`, {
        status: launched.exitCode === 0 ? 'PASS' : 'FAIL',
        reason: launched.exitCode === 0 ? null : launched.text || `builder exited ${launched.exitCode}`,
        observed: launched.observed ?? null,
        outputPath: launched.outputPath ?? null,
      });
    },
    checks: async input => {
      const checked = await checks(input);
      return saveResult(input.runDirectory, `checks-${input.round}.json`, checked);
    },
    reviewer: async input => {
      const approved = await readJson(input.approvedInputPath);
      const request = approved.reviewerRequest;
      if (!request?.configuration || !request.reviewInput) throw new Error('approved input has no existing Mastra reviewer request');
      const launched = await launch('reviewer', {
        ...request,
        round: input.round,
        builderResultPath: input.builderResultPath,
        checksResultPath: input.checksResultPath,
        mastraReviewOnly: true,
      });
      const reviewed = checkedReview(launched.text, request.reviewInput);
      return saveResult(input.runDirectory, `review-${input.round}.json`, {
        verdict: launched.exitCode === 0 && !reviewed.error ? reviewed.verdict : 'FAIL',
        reason: launched.technicalFailure ?? reviewed.error ?? (launched.exitCode === 0 ? null : `reviewer exited ${launched.exitCode}`),
        model: launched.observed?.model ?? request.configuration.model ?? null,
        effort: launched.observed?.effort ?? request.configuration.thinking ?? null,
        inputTokens: launched.usage?.inputTokens ?? null,
        outputTokens: launched.usage?.outputTokens ?? null,
        costEstimateUsd: launched.costEstimateUsd ?? null,
      });
    },
    notify,
  };
}
