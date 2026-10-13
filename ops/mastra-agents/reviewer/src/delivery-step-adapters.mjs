import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

async function reviewerCrash(runDirectory, suffix, launched, candidateCommit) {
  const crashPath = join(runDirectory, `crash-reviewer-${suffix}.json`);
  const incidentId = `reviewer-${suffix}-${Date.now()}`;
  await writeFile(crashPath, `${JSON.stringify({
    kind: 'technical-failure', incidentId, step: 'reviewer-launch',
    reason: launched.technicalFailure ?? launched.text ?? `reviewer launcher exited ${launched.exitCode}`,
    candidateCommit, providerAcceptance: launched.providerAcceptance ?? 'uncertain',
    costUsd: Number.isFinite(launched.costEstimateUsd) ? launched.costEstimateUsd : null,
    outputPath: launched.outputPath ?? null, responseId: launched.responseId ?? null,
  })}\n`, { flag: 'wx' });
  const error = new Error(`reviewer launcher failed: ${launched.technicalFailure ?? `exit ${launched.exitCode}`}`);
  error.deliveryCrashPath = crashPath;
  throw error;
}

async function launchDurably(launch, role, request, runDirectory, suffix) {
  const outputPath = request.outputPath;
  if (outputPath && existsSync(outputPath)) {
    const saved = await readJson(outputPath);
    if (saved.deliveryResult) return saved.deliveryResult;
    throw new Error(`${role} output exists without a durable delivery result: ${outputPath}`);
  }
  const journalPath = join(runDirectory, `${role}-launch-${suffix}.json`);
  if (existsSync(journalPath)) {
    throw new Error(`${role} launch is ambiguous after restart; refusing a duplicate launch (${journalPath})`);
  }
  return launch(role, {
    ...request,
    started: async ({ pid }) => {
      await writeFile(journalPath, `${JSON.stringify({ role, pid, round: request.round, outputPath })}\n`, { flag: 'wx' });
    },
  });
}

// This is deliberately glue, not another launcher or reviewer. The workflow
// calls the runner's established productionLauncher for both roles; that
// launcher's `mastraReviewOnly` branch owns the existing reviewer.mjs process.
export function createExistingDeliveryStepAdapters({
  worktree,
  launch = productionLauncher(worktree),
  checks,
  recoverCrash = async () => { throw new Error('recovery route is required'); },
  waitingRecord,
  validateCandidate = async () => ({ status: 'PASS' }),
  recordAcceptance = async () => { throw new Error('acceptance recorder is required'); },
  park = async () => { throw new Error('park recorder is required'); },
}) {
  if (!worktree) throw new Error('existing delivery steps require a worktree');
  if (typeof launch !== 'function' || typeof checks !== 'function' || typeof waitingRecord !== 'function') {
    throw new Error('existing delivery steps require launcher, checks and waiting-record boundaries');
  }
  return {
    builder: async input => {
      const approved = await readJson(input.approvedInputPath);
      const request = approved.builderRequest;
      if (!request?.configuration || typeof request.prompt !== 'string') throw new Error('approved input has no existing builder launch request');
      const prompt = input.priorReviewPath
        ? `${request.prompt}\n\nRepair every finding in the saved independent review at ${input.priorReviewPath}. Read that file; its path is the handoff.`
        : request.prompt;
      const suffix = input.cycle && input.cycle > 1 ? `${input.round}-cycle-${input.cycle}` : input.round;
      const launched = await launchDurably(launch, 'builder', { ...request, prompt, round: input.round, outputPath: join(input.runDirectory, `builder-worker-${suffix}.json`) }, input.runDirectory, suffix);
      return saveResult(input.runDirectory, `builder-${suffix}.json`, {
        status: launched.exitCode === 0 ? 'PASS' : 'FAIL',
        reason: launched.exitCode === 0 ? null : launched.text || `builder exited ${launched.exitCode}`,
        observed: launched.observed ?? null,
        outputPath: launched.outputPath ?? null,
      });
    },
    checks: async input => {
      const checked = await checks(input);
      const suffix = input.cycle && input.cycle > 1 ? `${input.round}-cycle-${input.cycle}` : input.round;
      return saveResult(input.runDirectory, `checks-${suffix}.json`, checked);
    },
    reviewer: async input => {
      const approved = await readJson(input.approvedInputPath);
      const request = approved.reviewerRequest;
      if (!request?.configuration || !request.issueId || request.configuration.connection?.provider !== 'commandcode') {
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
      const roundSuffix = input.cycle && input.cycle > 1 ? `${input.round}-cycle-${input.cycle}` : input.round;
      const suffix = input.recoveryResultPath ? `${roundSuffix}-recovered` : roundSuffix;
      const launched = await launchDurably(launch, 'reviewer', {
        ...request,
        candidate,
        reviewInput,
        round: input.round,
        builderResultPath: input.builderResultPath,
        checksResultPath: input.checksResultPath,
        mastraReviewOnly: true,
        outputPath: join(input.runDirectory, `reviewer-worker-${suffix}.json`),
      }, input.runDirectory, suffix);
      if (launched.exitCode !== 0 || launched.technicalFailure) {
        await reviewerCrash(input.runDirectory, suffix, launched, candidate.commit ?? reviewInput.candidate ?? null);
      }
      const reviewed = checkedReview(launched.text, reviewInput);
      const inputTokens = launched.usage?.inputTokens ?? launched.usage?.prompt_tokens;
      const outputTokens = launched.usage?.outputTokens ?? launched.usage?.completion_tokens;
      if (launched.exitCode === 0 && (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)
        || !Number.isFinite(launched.costEstimateUsd))) {
        throw new Error('existing Mastra reviewer returned no token or cost measurement');
      }
      return saveResult(input.runDirectory, `review-${suffix}.json`, {
        verdict: launched.exitCode === 0 && !reviewed.error ? reviewed.verdict : 'FAIL',
        reason: launched.technicalFailure ?? reviewed.error ?? (launched.exitCode === 0 ? null : `reviewer exited ${launched.exitCode}`),
        report: reviewed.report ?? null,
        text: launched.text ?? null,
        candidateCommit: candidate.commit ?? reviewInput.candidate ?? null,
        model: launched.observed?.model ?? request.configuration.model ?? null,
        effort: launched.observed?.effort ?? request.configuration.thinking ?? null,
        inputTokens: inputTokens ?? null,
        outputTokens: outputTokens ?? null,
        costEstimateUsd: launched.costEstimateUsd ?? null,
      });
    },
    recoverCrash,
    waitingRecord,
    validateCandidate,
    recordAcceptance,
    park,
  };
}
