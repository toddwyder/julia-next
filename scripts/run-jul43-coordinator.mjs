#!/usr/bin/env node
// run-jul43-coordinator.mjs -- the executable initialization command for
// routing a Linear ticket through the existing graph: prepare (read the
// ticket) -> dispatch (Orca) -> collect the worker's real result -> publish
// (push, open PR, report to Linear) -- with a coordinator_* event emitted
// automatically at every stage, on the existing journey-relay. No manual
// step, no hand-typed result JSON, no placeholder URL.
//
// runCoordinator() is the whole orchestration, built from injected
// functions so its sequencing and error handling are unit-testable
// (run-jul43-coordinator.test.mjs) without needing a live runner, Linear,
// or GitHub App. main() below wires the real implementations -- Orca CLI,
// AI-Stack's library functions (dynamic-imported from --ai-stack-dir,
// since this repo cannot depend on that one directly), real git, real
// fetch -- and is what an actual run invokes. See
// docs/agents/jul43-coordinator-runbook.md for prerequisites and the exact
// command line.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { recordCoordinatorEvent } from './coordinator-events.mjs';
import { runCreate, terminalWait, workerShow, workerStart } from './orca-cli.mjs';
import { collectWorkerResult } from './collect-worker-result.mjs';
import { getPublisherInstallationToken } from './publish-via-github-app.mjs';

const execFileAsync = promisify(execFile);

export async function runCoordinator({
  expectedIssue,
  runId,
  environment = 'OVH runner',
  fromTerminal,
  worktreeName,
  baseCommit,
  timeoutMs = 30 * 60 * 1000,
  readFileImpl = (path) => readFile(path, 'utf8'),
  prepareImpl,
  runCreateImpl,
  workerStartImpl,
  terminalWaitImpl,
  workerShowImpl,
  collectResultImpl,
  publishStartImpl,
  publishFinishImpl,
  recordEventImpl,
} = {}) {
  await recordEventImpl('started', { runId, expectedIssue });
  try {
    const selection = await prepareImpl({ expectedIssue });
    await recordEventImpl('progress', { runId, stage: 'prepared', issue: selection.issue });

    const workDefinition = await readFileImpl(selection.workDefinitionPath);
    const context = await readFileImpl(selection.contextPath);

    const run = await runCreateImpl({
      environment,
      from: fromTerminal,
      objective: `JUL-43 coordinator run ${runId}: ${selection.issue}`,
    });
    const worker = await workerStartImpl({
      run: run.run_id,
      environment,
      from: fromTerminal,
      spec: `${workDefinition}\n\n---\n\n${context}`,
      worktree: worktreeName,
      name: runId,
    });
    // A real, traceable identifier -- Orca is a local orchestration tool
    // with no browsable web URL for a run, so this is the closest thing to
    // one: the actual run and dispatch ids, not an unfilled placeholder.
    const runUrl = `orca://${environment}/run/${run.run_id}/dispatch/${worker.dispatch_id}`;

    await publishStartImpl({
      issue: selection.issue,
      issueId: selection.issueId,
      runId,
      runUrl,
      baseCommit,
      packetUrl: selection.issueUrl,
    });
    await recordEventImpl('progress', { runId, stage: 'worker-dispatched', dispatch: worker.dispatch_id });

    await terminalWaitImpl({ environment, terminal: worker.terminal, timeoutMs });
    const status = await workerShowImpl({ environment, dispatch: worker.dispatch_id });
    const orcaOutcome = status.projection?.outcome;
    await recordEventImpl('progress', { runId, stage: 'worker-done', orcaOutcome });

    const result = await collectResultImpl({
      runId,
      workItemId: selection.workItemId,
      worktree: worker.worktree,
      baseCommit,
      orcaOutcome,
    });

    const finish = await publishFinishImpl({
      selection: { ...selection, runId },
      result,
      runUrl,
    });

    await recordEventImpl(finish.published ? 'completed' : 'failed', {
      runId,
      outcome: result.outcome,
      published: finish.published,
    });

    return { selection, result, finish, runUrl };
  } catch (error) {
    await recordEventImpl('failed', { runId, error: error.message });
    throw error;
  }
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const aiStackDir = option('ai-stack-dir');
  const expectedIssue = option('expected-issue') ?? 'JUL-43';
  const fromTerminal = option('from-terminal');
  const environment = option('environment') ?? 'OVH runner';
  if (!aiStackDir) throw new Error('--ai-stack-dir is required (path to a toddwyder/AI-Stack checkout)');
  if (!fromTerminal) throw new Error('--from-terminal is required (an existing plain-bash terminal handle on the runner)');

  const runId = `jul43-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outputDir = `/tmp/${runId}`;

  const projectConfigPath = resolve('graph/julia-next.project.mjs');
  const { defineProjectConfig } = await import(pathToFileURL(resolve(aiStackDir, 'orchestrator/lib/project-config.mjs')).href);
  const { prepareLinearSupervisedRun } = await import(pathToFileURL(resolve(aiStackDir, 'orchestrator/lib/julia-supervised-run.mjs')).href);
  const { requireLinearApiKey } = await import(pathToFileURL(resolve(aiStackDir, 'orchestrator/lib/linear-client.mjs')).href);
  const {
    createLinearAwarePublisherEffects,
    publishSupervisedFinish,
    publishSupervisedStart,
  } = await import(pathToFileURL(resolve(aiStackDir, 'orchestrator/lib/julia-supervised-publisher.mjs')).href);
  const { createWorkerResult } = await import(pathToFileURL(resolve(aiStackDir, 'orchestrator/lib/claude-worker.mjs')).href);

  const configModule = await import(pathToFileURL(projectConfigPath).href);
  const config = defineProjectConfig(configModule.default);
  // Mints a fresh ~1-hour installation token from the App's own credentials
  // on every run, via the mechanism already proven in toddwyder/Julia's
  // publish-via-github-app.mjs -- so the runner only ever needs to hold the
  // App's long-lived private key, never a token that goes stale between
  // runs. JULIA_PUBLISHER_REPO tells it which repo's installation to use.
  const credential = await getPublisherInstallationToken({
    ...process.env,
    JULIA_PUBLISHER_REPO: config.targetRepo.name,
    JULIA_PUBLISHER_OWNER: config.targetRepo.owner,
  });
  const effects = createLinearAwarePublisherEffects({ config, linearApiKey: requireLinearApiKey() });

  const { stdout: baseCommit } = await execFileAsync('git', ['rev-parse', 'HEAD']);

  const result = await runCoordinator({
    expectedIssue,
    runId,
    environment,
    fromTerminal,
    worktreeName: option('worktree') ?? 'new-top-level',
    baseCommit: baseCommit.trim(),
    prepareImpl: (args) => prepareLinearSupervisedRun({
      config, expectedIssue: args.expectedIssue, outputDir, apiKey: requireLinearApiKey(),
    }),
    runCreateImpl: runCreate,
    workerStartImpl: workerStart,
    terminalWaitImpl: terminalWait,
    workerShowImpl: workerShow,
    collectResultImpl: (args) => collectWorkerResult({ ...args, createWorkerResultImpl: createWorkerResult }),
    publishStartImpl: (args) => publishSupervisedStart({ credential, effects, ...args }),
    publishFinishImpl: (args) => publishSupervisedFinish({ credential, effects, ...args }),
    recordEventImpl: (stage, ctx) => recordCoordinatorEvent(stage, ctx),
  });

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[run-jul43-coordinator] FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
