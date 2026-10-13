import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

import { getIssue, postCommentToIssueId } from './linear-cli.mjs';
import { authorizationReason, productionLauncher, workerPrompt } from './julia-delivery-runner.mjs';
import { assertDeliveryPath, captureDeliveryCandidate, prepareDeliveryWorkspace } from './julia-delivery-candidate.mjs';
import { git, localTester } from './julia-minimal-runner-checks.mjs';
import { seamsOf } from './julia-delivery-workspace.mjs';
import { reviewInput } from './julia-delivery-review.mjs';
import { saveJson } from './julia-delivery-state.mjs';
import { updateWorkerTools } from './delivery-tool-updates.mjs';
import { recoverDeliveryCrash } from './julia-delivery-recovery.mjs';
import { createDeliveryWorkflowRuntime } from '../ops/mastra-agents/reviewer/src/delivery-workflow-runtime.mjs';
import { createExistingDeliveryStepAdapters } from '../ops/mastra-agents/reviewer/src/delivery-step-adapters.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

function cardIdentityReason(card, issueId, authorization) {
  if (!card || card.identifier == null) return 'Linear did not return a card';
  if (card.identifier !== issueId) return `Linear returned ${card.identifier}, not ${issueId}`;
  if (!card.linearActor?.id || card.linearActor.id !== authorization?.linearActorId) return 'Linear actor does not match the authorized account';
  return null;
}

function cardRequirementsReason(card) {
  if (!/^##\s+Acceptance criteria\s*$/mi.test(card.description ?? '')) return 'card has no approved acceptance criteria';
  if (!seamsOf(card.description)) return 'card has no agreed test seams';
  return null;
}

async function writeOnce(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try { await writeFile(path, text, { flag: 'wx' }); }
  catch (error) {
    if (error?.code !== 'EEXIST' || await readFile(path, 'utf8') !== text) throw error;
  }
  return { resultPath: path };
}

export async function runDurableExternalUpdate({ requestPath, resultPath, request, operation }) {
  if (existsSync(resultPath)) {
    const saved = await readJson(resultPath);
    if (saved.status !== 'PASS') throw new Error(saved.reason ?? 'saved external update failed');
    return saved;
  }
  if (existsSync(requestPath)) {
    throw new Error(`external update is ambiguous after restart; refusing a duplicate (${requestPath})`);
  }
  await writeOnce(requestPath, request);
  try {
    const response = await operation();
    const saved = { status: 'PASS', operation: request.operation, card: request.card, response: response ?? null, completedAt: new Date().toISOString() };
    await writeOnce(resultPath, saved);
    return saved;
  } catch (error) {
    const reason = typeof error?.message === 'string' ? error.message : String(error);
    await writeOnce(resultPath, { status: 'FAIL', operation: request.operation, card: request.card, reason, completedAt: new Date().toISOString() });
    throw error;
  }
}

export function createMastraDeliveryAdapters({
  repoRoot = process.cwd(),
  worktree,
  base,
  readCard = id => getIssue(id, { apiKey: process.env.LINEAR_API_KEY, includeComments: true }),
  startCard = (card, commit) => postCommentToIssueId(card.id, `Runner started from ${commit}.`, { apiKey: process.env.LINEAR_API_KEY }),
  parkCard = (card, reason) => postCommentToIssueId(card.id, `Runner parked: ${reason}`, { apiKey: process.env.LINEAR_API_KEY }),
  launch,
  test = request => localTester(request.run === 'suite' ? { ...request, run: 'runnerSuite' } : request),
} = {}) {
  let existingSteps;
  const steps = async approvedInputPath => {
    if (existingSteps) return existingSteps;
    const approved = await readJson(approvedInputPath);
    const worker = launch ?? productionLauncher(approved.workspace.path);
    existingSteps = createExistingDeliveryStepAdapters({
      worktree: approved.workspace.path,
      launch: worker,
      checks: async input => {
        const current = await readJson(input.approvedInputPath);
        const evidenceName = input.cycle > 1 ? `${input.round}-cycle-${input.cycle}` : input.round;
        const candidate = await captureDeliveryCandidate({
          issueId: current.issueId, runPath: current.runPath, workspace: current.workspace,
          card: current.card, test, round: input.round, evidenceName,
        });
        if (!candidate.clean || candidate.checks?.pass !== true) return { status: 'FAIL', reason: candidate.checks?.error ?? candidate.checks?.summary ?? 'candidate checks failed' };
        const prior = input.priorReviewPath ? await readJson(input.priorReviewPath) : null;
        const prepared = reviewInput(current.card, candidate, current.workspace, prior?.verdict === 'FAIL' ? { ...prior, commit: prior.candidateCommit, text: prior.text, report: prior.report } : null);
        const candidatePath = candidate.evidencePath;
        const reviewInputPath = join(input.runDirectory, `review-input-${evidenceName}.json`);
        await saveJson(reviewInputPath, prepared);
        return { status: 'PASS', change: candidate.commit, candidateCommit: candidate.commit, candidatePath, reviewInputPath, evidencePaths: candidate.runs.map(run => run.outputPath).filter(Boolean) };
      },
      waitingRecord: async input => {
        const approvedInput = await readJson(input.approvedInputPath);
        const checks = await readJson(input.checksResultPath);
        const candidateCommit = checks.candidateCommit ?? checks.change;
        const path = join(input.runDirectory, `waiting-${candidateCommit}.json`);
        return writeOnce(path, {
          card: approvedInput.issueId,
          candidateCommit,
          evidencePaths: [input.builderResultPath, input.checksResultPath, input.reviewResultPath, ...(checks.evidencePaths ?? [])],
          summary: `The candidate at ${candidateCommit} passed its automated checks and independent review. Its saved evidence is waiting for Todd's technical acceptance.`,
        });
      },
      validateCandidate: async input => {
        const approvedInput = await readJson(input.approvedInputPath);
        const checks = await readJson(input.checksResultPath);
        const expected = checks.candidateCommit ?? checks.change;
        const actual = git(approvedInput.workspace.path, 'rev-parse', 'HEAD');
        const dirty = git(approvedInput.workspace.path, 'status', '--porcelain');
        const branch = git(approvedInput.workspace.path, 'branch', '--show-current');
        return actual === expected && !dirty && branch === approvedInput.workspace.branch
          ? { status: 'PASS' }
          : { status: 'STALE', reason: `reviewed candidate ${expected} no longer matches the worktree` };
      },
      recordAcceptance: async input => {
        const approvedInput = await readJson(input.approvedInputPath);
        const checks = await readJson(input.checksResultPath);
        const candidateCommit = checks.candidateCommit ?? checks.change;
        const acceptancePath = join(input.runDirectory, `acceptance-${candidateCommit}.json`);
        if (existsSync(acceptancePath)) {
          const existing = await readJson(acceptancePath);
          if (existing.card === approvedInput.issueId && existing.candidateCommit === candidateCommit && existing.accepted === true) {
            return { resultPath: acceptancePath };
          }
          throw new Error(`existing acceptance does not match ${approvedInput.issueId} at ${candidateCommit}`);
        }
        return writeOnce(acceptancePath, {
          card: approvedInput.issueId, candidateCommit, accepted: true, acceptedAt: new Date().toISOString(),
        });
      },
      park: async input => {
        const approvedInput = await readJson(input.approvedInputPath);
        const review = await readJson(input.reviewResultPath);
        const reason = review.reason ?? 'two independent review attempts found blocking defects';
        await runDurableExternalUpdate({
          requestPath: join(input.runDirectory, 'linear-park-request.json'),
          resultPath: join(input.runDirectory, 'linear-park-result.json'),
          request: { operation: 'park-card', card: approvedInput.issueId, actor: approvedInput.card.linearActor, reason },
          operation: () => parkCard(approvedInput.card, reason),
        });
        return writeOnce(join(input.runDirectory, 'park.json'), { card: approvedInput.issueId, reason });
      },
      recoverCrash: async input => {
        const approvedInput = await readJson(input.approvedInputPath);
        const crash = await readJson(input.crashPath);
        const checks = await readJson(input.checksResultPath);
        const authorizedUsd = approvedInput.authorization?.spending?.reviewer?.maxUsd;
        const updates = input.toolUpdatesResultPath ? await readJson(input.toolUpdatesResultPath) : { tools: [] };
        const toolVersions = Object.fromEntries((updates.tools ?? []).map(tool => [tool.tool, tool.afterVersion]));
        const result = await recoverDeliveryCrash({
          crashPath: input.crashPath, runDirectory: input.runDirectory, repoRoot,
          candidate: { path: approvedInput.workspace.path, commit: checks.candidateCommit ?? checks.change },
          configuration: approvedInput.configuration, authorizedUsd, toolVersions,
        });
        return { resultPath: result.evidencePath };
      },
    });
    return existingSteps;
  };

  return {
    authorization: async input => {
      const launchInput = await readJson(input.launchInputPath);
      const reason = authorizationReason(launchInput.authorization, launchInput.issueId, launchInput.configuration);
      return writeOnce(join(input.runDirectory, 'authorization.json'), { status: reason ? 'FAIL' : 'PASS', reason });
    },
    cardRead: async input => {
      const launchInput = await readJson(input.launchInputPath);
      const card = { ...await readCard(launchInput.issueId), expectedId: launchInput.issueId };
      const identityReason = cardIdentityReason(card, launchInput.issueId, launchInput.authorization);
      if (identityReason) throw new Error(identityReason);
      const requirementsReason = cardRequirementsReason(card);
      const approvedInputPath = join(input.runDirectory, `${launchInput.issueId}-approved.json`);
      if (requirementsReason) {
        await saveJson(approvedInputPath, {
          issueId: launchInput.issueId, card, configuration: launchInput.configuration,
          authorization: launchInput.authorization, runPath: launchInput.runPath,
          readAt: new Date().toISOString(), cardProblemReason: requirementsReason,
        });
        return { resultPath: approvedInputPath };
      }
      const prepared = await prepareDeliveryWorkspace({
        issueId: launchInput.issueId, runPath: launchInput.runPath, repoRoot,
        base, worktree, saved: launchInput.workspace,
      });
      const approved = {
        issueId: launchInput.issueId, card, configuration: launchInput.configuration,
        authorization: launchInput.authorization, runPath: launchInput.runPath,
        workspace: prepared.worktree, readAt: new Date().toISOString(),
      };
      approved.builderRequest = {
        configuration: launchInput.configuration.builder,
        prompt: `${workerPrompt('builder', card, launchInput.configuration, launchInput.runPath, approvedInputPath)}\n\nPinned canonical implementation instructions:\n${prepared.instructions}`,
        outputPath: join(input.runDirectory, 'builder-worker-1.json'),
      };
      approved.reviewerRequest = {
        issueId: launchInput.issueId, configuration: launchInput.configuration.reviewer,
        spending: launchInput.authorization.spending.reviewer,
        outputPath: join(input.runDirectory, 'reviewer-worker.json'),
      };
      await saveJson(approvedInputPath, approved);
      await runDurableExternalUpdate({
        requestPath: join(input.runDirectory, 'linear-start-request.json'),
        resultPath: join(input.runDirectory, 'linear-start-result.json'),
        request: { operation: 'start-card', card: launchInput.issueId, actor: card.linearActor, startCommit: prepared.worktree.startCommit },
        operation: () => startCard(card, prepared.worktree.startCommit),
      });
      return { resultPath: approvedInputPath };
    },
    toolUpdates: async input => {
      const approved = await readJson(input.approvedInputPath);
      const harnesses = [approved.configuration?.builder?.harness, approved.configuration?.recoveryReviewer?.harness]
        .filter(harness => harness === 'codex' || harness === 'agy');
      const path = join(input.runDirectory, 'tool-updates.json');
      if (existsSync(path)) return { resultPath: path };
      return writeOnce(path, await updateWorkerTools(harnesses));
    },
    builder: async input => (await steps(input.approvedInputPath)).builder(input),
    checks: async input => (await steps(input.approvedInputPath)).checks(input),
    reviewer: async input => (await steps(input.approvedInputPath)).reviewer(input),
    recoverCrash: async input => (await steps(input.approvedInputPath)).recoverCrash(input),
    waitingRecord: async input => (await steps(input.approvedInputPath)).waitingRecord(input),
    validateCandidate: async input => (await steps(input.approvedInputPath)).validateCandidate(input),
    recordAcceptance: async input => (await steps(input.approvedInputPath)).recordAcceptance(input),
    park: async input => (await steps(input.approvedInputPath)).park(input),
  };
}

export async function startMastraDelivery(issueId, configuration, {
  runPath = join(homedir(), '.julia', 'runs', `${issueId}.json`),
  authorization,
  decision,
  adapters,
  repoRoot = process.cwd(),
  worktree = process.env.JULIA_DELIVERY_WORKTREE,
  base,
} = {}) {
  assertDeliveryPath(runPath);
  const runDirectory = join(dirname(resolve(runPath)), `${issueId}-run`);
  await mkdir(runDirectory, { recursive: true });
  const runId = issueId.toLowerCase();
  const launchInputPath = join(runDirectory, 'launch.json');
  const launchInput = { issueId, configuration, authorization, runPath, runId };
  try { await writeOnce(launchInputPath, launchInput); }
  catch (error) { throw new Error(`saved workflow launch differs from this request: ${error.message}`); }
  if (!adapters && process.env.JULIA_DELIVERY_OFFLINE_FIXTURE === '1') {
    const { createOfflineDeliveryAdapters } = await import('../ops/mastra-agents/reviewer/support/offline-delivery-adapters.mjs');
    await writeFile(join(runDirectory, 'JUL-196-approved.json'), `${JSON.stringify({ identifier: issueId })}\n`);
    adapters = createOfflineDeliveryAdapters({
      directory: runDirectory,
      callsPath: join(runDirectory, 'calls.jsonl'),
      verdicts: (process.env.JULIA_DELIVERY_OFFLINE_VERDICTS ?? 'PASS').split(',').map(value => value.trim()),
    });
  }
  const runtime = await createDeliveryWorkflowRuntime({
    storagePath: join(runDirectory, 'mastra.db'), runDirectory,
    summaryPath: join(dirname(resolve(runPath)), 'delivery-summary.log'),
    adapters: adapters ?? createMastraDeliveryAdapters({ repoRoot, worktree, base }),
  });
  try {
    const snapshot = await runtime.inspect(runId);
    if (!snapshot) return await runtime.start({ runId, input: { card: issueId, launchInputPath, runDirectory } });
    if (snapshot.status === 'suspended') {
      if (!decision) {
        const metrics = await readJson(join(runDirectory, `${runId}-workflow-metrics.json`));
        return { status: 'suspended', runId, outcome: 'awaiting-technical-acceptance', peakMemoryBytes: metrics.peakMemoryBytes, pauseStateBytes: metrics.pauseStateBytes };
      }
      return await runtime.resume({ runId, decision: decision.decision, reason: decision.reason });
    }
    return { status: snapshot.status, result: snapshot.result, runId };
  } finally { await runtime.close(); }
}
