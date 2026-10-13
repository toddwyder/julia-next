import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildAgyDeliverySpec, parseAgyDeliveryResult } from '../ops/service-dropbox/run-agy-seat.mjs';
import { runLimited } from '../ops/julia-runner/time-limit.mjs';
import { git as repositoryGit, localTester, safeWorkerEnvironment } from './julia-minimal-runner-checks.mjs';
import { productionLauncher } from './julia-delivery-runner.mjs';

const errorText = error => typeof error?.message === 'string' ? error.message : String(error);

async function runAgyDeliveryReview(request) {
  const spec = buildAgyDeliverySpec(request.prompt, { effort: request.configuration.thinking, cwd: request.repoRoot });
  let stdout = '';
  let stderr = '';
  const result = await runLimited(spec.command, spec.args, {
    ...spec.options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: safeWorkerEnvironment(),
  }, {
    seconds: 20 * 60,
    started: child => {
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
    },
  });
  const parsed = parseAgyDeliveryResult(stdout);
  return {
    exitCode: result.code === 0 && !result.stopped && parsed.ok ? 0 : (result.stopped ? 124 : result.code ?? 1),
    text: parsed.response ?? parsed.errorText ?? stderr,
    observed: parsed.model ? { maker: request.configuration.maker, model: parsed.model, harness: 'agy', cliVersion: request.cliVersion ?? null } : null,
    usage: parsed.usage,
  };
}

function identity(configuration, observed) {
  return {
    identity: configuration.identity,
    maker: observed?.maker ?? configuration.maker,
    model: observed?.model ?? null,
    ...(observed?.cliVersion ? { cliVersion: observed.cliVersion } : {}),
  };
}

export async function recoverDeliveryCrash(input, {
  git = repositoryGit,
  fix,
  review = runAgyDeliveryReview,
  verify = request => localTester({ worktree: request.repoRoot, run: 'runnerSuite' }),
} = {}) {
  const crash = JSON.parse(await readFile(input.crashPath, 'utf8'));
  const evidencePath = join(input.runDirectory, `recovery-${crash.incidentId}.json`);
  const spend = { authorizedUsd: Number.isFinite(input.authorizedUsd) ? input.authorizedUsd : 0, spentUsd: 0, maximumAdditionalUsd: 0 };
  const base = {
    incidentId: crash.incidentId, interruptedStep: crash.step, crashPath: input.crashPath,
    rootCause: null, recoveryCommit: null, fixer: null, reviewer: null,
    reviewBypassedFailedStep: true, reviewResult: 'NOT_RUN', verificationResult: 'NOT_RUN',
    resumePoint: crash.step, candidateCommit: input.candidate.commit, spend,
    originalPaidRequest: { acceptance: crash.providerAcceptance, costUsd: crash.costUsd }, evidencePath,
  };
  const save = async value => { await writeFile(evidencePath, `${JSON.stringify(value)}\n`); return value; };
  const park = (reason, additions = {}) => save({ ...base, ...additions, status: 'PARK', reason });
  try {
    const fixerConfiguration = input.configuration?.builder;
    const reviewerConfiguration = input.configuration?.recoveryReviewer;
    if (fixerConfiguration?.harness !== 'codex' || fixerConfiguration.model !== null) return park('recovery parked: Codex fixer is not configured on its current default model');
    if (reviewerConfiguration?.harness !== 'agy' || reviewerConfiguration.model !== null) return park('recovery parked: Gemini reviewer is not configured on its current default model');
    if (fixerConfiguration.maker.trim().toLowerCase() === reviewerConfiguration.maker.trim().toLowerCase()) return park('recovery parked: fixer and reviewer are configured to the same maker');
    const candidateBefore = git(input.candidate.path, 'rev-parse', 'HEAD');
    const candidateDirtyBefore = git(input.candidate.path, 'status', '--porcelain');
    if (candidateBefore !== input.candidate.commit || candidateDirtyBefore) return park('recovery parked: Julia candidate did not match the crash evidence');
    const sourceBefore = git(input.repoRoot, 'rev-parse', 'HEAD');
    if (git(input.repoRoot, 'status', '--porcelain')) return park('recovery parked: delivery source was dirty before diagnosis');

    const fixerPrompt = [
      `A delivery reviewer launcher crashed. This is recovery incident ${crash.incidentId}.`,
      `Read and follow .agents/skills/diagnosing-bugs/SKILL.md. Diagnose and fix only the confirmed cause in the delivery machinery at ${input.repoRoot}.`,
      `Crash evidence: ${input.crashPath}. The Julia candidate is separate and must not be changed: ${input.candidate.path} at ${input.candidate.commit}.`,
      'Run the tight regression and relevant tests, remove debug instrumentation, commit the recovery fix, and leave the delivery source clean. Do not call any paid model or edit Linear.',
    ].join('\n\n');
    const launchFix = fix ?? (request => productionLauncher(input.repoRoot)('builder', request));
    const fixed = await launchFix({
      configuration: fixerConfiguration, prompt: fixerPrompt,
      outputPath: join(input.runDirectory, `recovery-fixer-${crash.incidentId}.json`),
    });
    const fixer = identity(fixerConfiguration, fixed.observed ? {
      ...fixed.observed, cliVersion: fixed.observed.cliVersion ?? input.toolVersions?.codex ?? null,
    } : null);
    if (fixed.exitCode !== 0 || !fixed.observed?.model || fixer.maker.trim().toLowerCase() !== 'openai') {
      return park('recovery parked: Codex diagnosis/fix did not complete with observed identity', { fixer });
    }
    if (git(input.repoRoot, 'status', '--porcelain')) {
      git(input.repoRoot, 'add', '-A');
      git(input.repoRoot, '-c', 'user.name=Julia recovery runner', '-c', 'user.email=runner@julia.invalid',
        'commit', '-q', '-m', `recovery: ${crash.incidentId}`);
    }
    const recoveryCommit = git(input.repoRoot, 'rev-parse', 'HEAD');
    if (recoveryCommit === sourceBefore || git(input.repoRoot, 'status', '--porcelain')) {
      return park('recovery parked: Codex did not leave one committed clean recovery fix', { fixer, recoveryCommit });
    }
    const rootCause = `Confirmed by Codex diagnosis in ${fixed.outputPath ?? 'the retained fixer output'}; recovery changed ${sourceBefore} to ${recoveryCommit}.`;
    const diff = git(input.repoRoot, 'diff', '--binary', `${sourceBefore}...${recoveryCommit}`);
    const reviewPrompt = [
      'Review this crash-recovery fix independently. Do not edit files or call another model.',
      `Crash evidence: ${JSON.stringify(crash)}`,
      `The fixer was ${fixer.identity} (${fixer.maker}); you must act as the different-maker recovery reviewer.`,
      'Check that the confirmed delivery-machinery cause is fixed, the Julia candidate is untouched, and no unrelated behavior changed.',
      'Reply with exactly VERDICT: PASS or VERDICT: FAIL followed by concise findings.',
      `Recovery diff:\n${diff}`,
    ].join('\n\n');
    const reviewed = await review({
      configuration: reviewerConfiguration, prompt: reviewPrompt, repoRoot: input.repoRoot,
      cliVersion: input.toolVersions?.agy ?? null,
    });
    const reviewer = identity(reviewerConfiguration, reviewed.observed);
    if (reviewed.exitCode !== 0 || !reviewed.observed?.model || !/^VERDICT: PASS\b/m.test(reviewed.text ?? '')) {
      return park('recovery parked: Gemini independent recovery review did not pass', { rootCause, recoveryCommit, fixer, reviewer, reviewResult: 'FAIL' });
    }
    if (fixer.maker.trim().toLowerCase() === reviewer.maker.trim().toLowerCase()) {
      return park('recovery parked: recovery review used the same maker as the fixer', { rootCause, recoveryCommit, fixer, reviewer, reviewResult: 'FAIL' });
    }
    if (git(input.repoRoot, 'rev-parse', 'HEAD') !== recoveryCommit || git(input.repoRoot, 'status', '--porcelain')) {
      return park('recovery parked: delivery source changed during independent review', { rootCause, recoveryCommit, fixer, reviewer, reviewResult: 'PASS' });
    }
    const verified = await verify({ repoRoot: input.repoRoot, recoveryCommit });
    if (verified.status !== 0) return park('recovery parked: complete Windows runner and safety suite failed', {
      rootCause, recoveryCommit, fixer, reviewer, reviewResult: 'PASS', verificationResult: 'FAIL', verificationOutput: verified.output,
    });
    const candidateAfter = git(input.candidate.path, 'rev-parse', 'HEAD');
    const candidateDirtyAfter = git(input.candidate.path, 'status', '--porcelain');
    if (candidateAfter !== input.candidate.commit || candidateDirtyAfter) return park('recovery parked: recovery altered the Julia candidate', {
      rootCause, recoveryCommit, fixer, reviewer, reviewResult: 'PASS', verificationResult: 'PASS', verificationOutput: verified.output,
    });
    return save({
      ...base, status: 'RESUME', rootCause, recoveryCommit, fixer, reviewer,
      reviewResult: 'PASS', reviewText: reviewed.text, verificationResult: 'PASS', verificationOutput: verified.output,
    });
  } catch (error) {
    return park(`recovery parked: ${errorText(error)}`);
  }
}
