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
      const prompt = input.priorReviewPath
        ? `${request.prompt}\n\nRepair every finding in the saved independent review at ${input.priorReviewPath}. Read that file; its path is the handoff.`
        : request.prompt;
      const launched = await launch('builder', { ...request, prompt, round: input.round });
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
      if (!request?.configuration || !request.issueId || !request.candidate || request.configuration.connection?.provider !== 'commandcode') {
        throw new Error('approved input has no complete existing Mastra reviewer request');
      }
      const builder = await readJson(input.builderResultPath);
      if (!builder.observed?.maker || !request.configuration.maker
        || builder.observed.maker.trim().toLowerCase() === request.configuration.maker.trim().toLowerCase()) {
        throw new Error('independent reviewer maker must differ from the observed builder maker');
      }
      const checkResult = await readJson(input.checksResultPath);
      const reviewInput = checkResult.reviewInputPath
        ? await readJson(checkResult.reviewInputPath)
        : request.reviewInput;
      const candidate = checkResult.candidatePath
        ? await readJson(checkResult.candidatePath)
        : request.candidate;
      if (!reviewInput || !candidate || (input.round > 1 && (!checkResult.reviewInputPath || !checkResult.candidatePath))) {
        throw new Error('checks did not save the current candidate and review input');
      }
      const launched = await launch('reviewer', {
        ...request,
        candidate,
        reviewInput,
        round: input.round,
        builderResultPath: input.builderResultPath,
        checksResultPath: input.checksResultPath,
        mastraReviewOnly: true,
      });
      const reviewed = checkedReview(launched.text, reviewInput);
      const inputTokens = launched.usage?.inputTokens ?? launched.usage?.prompt_tokens;
      const outputTokens = launched.usage?.outputTokens ?? launched.usage?.completion_tokens;
      if (launched.exitCode === 0 && (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)
        || !Number.isFinite(launched.costEstimateUsd))) {
        throw new Error('existing Mastra reviewer returned no token or cost measurement');
      }
      return saveResult(input.runDirectory, `review-${input.round}.json`, {
        verdict: launched.exitCode === 0 && !reviewed.error ? reviewed.verdict : 'FAIL',
        reason: launched.technicalFailure ?? reviewed.error ?? (launched.exitCode === 0 ? null : `reviewer exited ${launched.exitCode}`),
        report: reviewed.report ?? null,
        model: launched.observed?.model ?? request.configuration.model ?? null,
        effort: launched.observed?.effort ?? request.configuration.thinking ?? null,
        inputTokens: inputTokens ?? null,
        outputTokens: outputTokens ?? null,
        costEstimateUsd: launched.costEstimateUsd ?? null,
      });
    },
    notify,
  };
}
