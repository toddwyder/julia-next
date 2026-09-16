// collect-worker-result.mjs -- builds the worker-result object that
// publishSupervisedFinish (AI-Stack) requires, from the worker's actual
// git state after Orca reports it done -- never a hand-typed JSON file.
//
// createWorkerResultImpl is injected (AI-Stack's claude-worker.mjs
// createWorkerResult) rather than imported here, so this module has no
// cross-repo import of its own and stays testable in isolation; the caller
// (run-jul43-coordinator.mjs) resolves it once from the AI-Stack checkout
// it's already given.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function defaultGitImpl(args, { cwd }) {
  return execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

async function git(args, { cwd, gitImpl = defaultGitImpl }) {
  const { stdout } = await gitImpl(args, { cwd });
  return stdout.trim();
}

// Orca's own outcome vocabulary (as observed in this ticket's live
// dispatches: 'succeeded', 'failed', 'timed_out') translated into the
// {launched, exitCode, timedOut} shape AI-Stack's createWorkerResult
// expects. Anything unrecognized (including Orca states this ticket has
// not yet observed, e.g. an abandoned dispatch) maps to launched: false
// rather than guessing success.
function translateOrcaOutcome(orcaOutcome) {
  if (orcaOutcome === 'succeeded') return { launched: true, exitCode: 0, timedOut: false };
  if (orcaOutcome === 'timed_out') return { launched: true, exitCode: 1, timedOut: true };
  if (orcaOutcome === 'failed') return { launched: true, exitCode: 1, timedOut: false };
  return { launched: false, exitCode: null, timedOut: false };
}

export async function collectWorkerResult({
  runId,
  workItemId,
  worktree,
  baseCommit,
  orcaOutcome,
  gitImpl = defaultGitImpl,
  createWorkerResultImpl,
}) {
  if (typeof createWorkerResultImpl !== 'function') {
    throw new Error('collectWorkerResult requires createWorkerResultImpl (AI-Stack claude-worker.mjs createWorkerResult)');
  }
  const branch = await git(['branch', '--show-current'], { cwd: worktree, gitImpl });
  const commit = await git(['rev-parse', 'HEAD'], { cwd: worktree, gitImpl });
  const process = translateOrcaOutcome(orcaOutcome);

  const base = createWorkerResultImpl({
    runId,
    workItemId,
    branch,
    commit,
    pullRequest: null,
    evidenceRefs: [`orca-worker-outcome:${orcaOutcome}`],
    process,
  });

  return { ...base, worktree, baseCommit };
}
