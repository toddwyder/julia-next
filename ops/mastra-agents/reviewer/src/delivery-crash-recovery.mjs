import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
  return path;
}

async function updateMetadata(path, update) {
  const current = await readJson(path);
  await writeJson(path, { ...current, ...update });
}

function adapterInput(inputData, additions = {}) {
  return Object.fromEntries(Object.entries({
    round: inputData.round,
    cycle: inputData.cycle,
    runDirectory: inputData.runDirectory,
    launchInputPath: inputData.launchInputPath,
    approvedInputPath: inputData.approvedInputPath,
    priorReviewPath: inputData.priorReviewPath,
    ...additions,
  }).filter(([, value]) => value != null));
}

function resultPath(role, result) {
  if (!result || typeof result.resultPath !== 'string' || !result.resultPath) throw new Error(`${role} step did not return a result path`);
  return result.resultPath;
}

const errorMessage = error => typeof error?.message === 'string' ? error.message : String(error);

async function technicalStop(inputData, reason, additions = {}) {
  const path = await writeJson(join(inputData.runDirectory, `review-system-error-${inputData.round}.json`), {
    verdict: 'SYSTEM_ERROR', reason, model: null, effort: null,
    inputTokens: null, outputTokens: null, costEstimateUsd: null, ...additions,
  });
  return { reviewResultPath: path, inputData: { ...inputData, ...additions, stopReason: reason } };
}

function recoveryProblem(recovery, crash, checks, crashPath, authorizedUsd) {
  const candidateCommit = checks.candidateCommit ?? checks.change;
  if (!recovery || !['RESUME', 'PARK'].includes(recovery.status)) return 'recovery result has no valid terminal status';
  if (recovery.incidentId !== crash.incidentId || recovery.crashPath !== crashPath || recovery.interruptedStep !== crash.step) return 'recovery result does not identify the crash incident';
  if (recovery.candidateCommit !== candidateCommit) return 'recovery result does not preserve the Julia candidate';
  const spend = recovery.spend;
  if (![spend?.authorizedUsd, spend?.spentUsd, spend?.maximumAdditionalUsd].every(value => Number.isFinite(value) && value >= 0)
    || !Number.isFinite(authorizedUsd) || spend.authorizedUsd !== authorizedUsd
    || spend.spentUsd + spend.maximumAdditionalUsd > spend.authorizedUsd) return 'recovery could exceed the authorized spending limit';
  if (recovery.originalPaidRequest?.acceptance !== crash.providerAcceptance
    || recovery.originalPaidRequest?.costUsd !== crash.costUsd) return 'recovery result does not preserve original provider acceptance and cost evidence';
  if (recovery.status === 'PARK') return typeof recovery.reason === 'string' && recovery.reason.trim() ? null : 'parked recovery has no concise reason';
  if (!recovery.rootCause || !recovery.recoveryCommit || !recovery.fixer?.identity || !recovery.fixer?.maker
    || !recovery.reviewer?.identity || !recovery.reviewer?.maker || recovery.resumePoint !== crash.step) return 'recovery evidence is incomplete or names the wrong resume point';
  if (recovery.fixer.maker.trim().toLowerCase() === recovery.reviewer.maker.trim().toLowerCase()) return 'recovery reviewer maker matches the fixer maker';
  if (recovery.reviewBypassedFailedStep !== true || recovery.reviewResult !== 'PASS' || recovery.verificationResult !== 'PASS') return 'recovery review or verification did not pass through an independent bypass route';
  return null;
}

export async function handleReviewerCrash({ error, inputData, checksResult, adapters }) {
  const crashPath = error?.deliveryCrashPath;
  if (!crashPath) return technicalStop(inputData, `reviewer technical failure: ${errorMessage(error)}`);

  const crash = await readJson(crashPath);
  const metadata = await readJson(inputData.runMetadataPath);
  const existing = (metadata.crashIncidents ?? []).find(item => item.incidentId === crash.incidentId || item.crashPath === crashPath);
  if (existing) {
    const reason = `crash incident ${crash.incidentId} replayed after recovery handling began; refusing a second recovery cycle`;
    const incidents = metadata.crashIncidents.map(item => item === existing ? { ...item, parkedReason: reason } : item);
    await updateMetadata(inputData.runMetadataPath, { crashIncidents: incidents });
    return technicalStop(inputData, reason, { crashPath, ...(existing.recoveryResultPath ? { recoveryResultPath: existing.recoveryResultPath } : {}) });
  }

  const incident = { incidentId: crash.incidentId, crashPath, interruptedStep: crash.step, round: inputData.round };
  const crashIncidents = [...(metadata.crashIncidents ?? []), incident];
  await updateMetadata(inputData.runMetadataPath, { crashIncidents });
  if (crash.providerAcceptance !== 'not-accepted' || crash.costUsd !== 0) {
    const reason = 'reviewer crashed and the original paid-request acceptance or cost is uncertain or positive; refusing another model call';
    return technicalStop(inputData, reason, { crashPath });
  }

  let recoveryResultPath;
  try {
    await updateMetadata(inputData.runMetadataPath, {
      crashIncidents: crashIncidents.map(item => item.incidentId === crash.incidentId ? { ...item, recoveryStartedAt: new Date().toISOString() } : item),
    });
    recoveryResultPath = resultPath('crash recovery', await adapters.recoverCrash(adapterInput(inputData, {
      builderResultPath: inputData.builderResultPath, checksResultPath: inputData.checksResultPath, crashPath,
    })));
    const recovery = await readJson(recoveryResultPath);
    const approved = await readJson(inputData.approvedInputPath);
    const problem = recoveryProblem(recovery, crash, checksResult, crashPath, approved.authorization?.spending?.reviewer?.maxUsd);
    if (problem || recovery.status === 'PARK') {
      const reason = problem ? `recovery parked: ${problem}` : recovery.reason;
      return technicalStop(inputData, reason, { crashPath, recoveryResultPath });
    }
    await updateMetadata(inputData.runMetadataPath, {
      crashIncidents: crashIncidents.map(item => item.incidentId === crash.incidentId ? { ...item, recoveryResultPath } : item),
    });
    try {
      const resumed = await adapters.reviewer(adapterInput(inputData, {
        builderResultPath: inputData.builderResultPath, checksResultPath: inputData.checksResultPath, crashPath, recoveryResultPath,
      }));
      return { reviewResultPath: resultPath('resumed reviewer', resumed), inputData: { ...inputData, crashPath, recoveryResultPath } };
    } catch (resumedError) {
      const reason = `reviewer crashed again before the interrupted step completed: ${errorMessage(resumedError)}`;
      const resumptionCrashPath = resumedError?.deliveryCrashPath ?? crashPath;
      await updateMetadata(inputData.runMetadataPath, {
        crashIncidents: crashIncidents.map(item => item.incidentId === crash.incidentId
          ? { ...item, recoveryResultPath, resumptionCrashPath, parkedReason: reason }
          : item),
      });
      return technicalStop(inputData, reason, { crashPath: resumptionCrashPath, recoveryResultPath });
    }
  } catch (recoveryError) {
    const reason = `crash recovery failed: ${errorMessage(recoveryError)}`;
    return technicalStop(inputData, reason, { crashPath, ...(recoveryResultPath ? { recoveryResultPath } : {}) });
  }
}
