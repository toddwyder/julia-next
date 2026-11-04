// A card's whole run as one stock Mastra workflow: build, then the pull request
// the build left, then review and remediation, then landing. The build is the
// workflow's own work, done in this process by an agent the step starts; the
// later stages are the machine's existing commands, started by their steps.
//
// Every step receives the card and the pull request so far, and a failing step
// throws: the workflow stops, the trace keeps the steps that ran, and the caller
// writes down why.

import { spawnSync } from 'node:child_process';

import { loadMastra } from '../shipping/harness.mjs';
import { BUILD_TIME_LIMIT_MS, runBuild } from './agent.mjs';

export const WORKFLOW_ID = 'card';
export const STEP_IDS = ['build', 'pull-request', 'review', 'landing'];

// Each later stage is a command line, so the environment can point a step at
// another program that takes the same arguments and answers with the same exit
// codes. The build is not here: it is the workflow's own step.
export function stageCommand(stage, { card, pr }, env = process.env) {
  const override = stage === 'review' ? env.MACHINE_REVIEW : env.MACHINE_LANDING;
  const args = ['--pr', String(pr), '--card', card];
  if (override) return [override, args];
  const program = stage === 'review' ? 'machine/remediation/run.mjs' : 'machine/merge/run.mjs';
  return ['node', ['scripts/julia-agents.mjs', '--', 'node', program, ...args]];
}

function syncRun(command, args, { root, env, stdio = 'inherit' }) {
  return spawnSync(command, args, { cwd: root, env, stdio, encoding: 'utf8' });
}

// A stage runs in its own process with its own record. The parent holds the run's
// trace file open, so the child must not be handed it: it names its own.
export function stageEnvironment(env = process.env) {
  const child = { ...env };
  delete child.MASTRA_OBSERVABILITY_DB_PATH;
  delete child.MASTRA_DB_PATH;
  return child;
}

// The pull request the build opened is the open one that names the card in its
// branch or title. More than one is a stop: the machine does not pick between them.
export function findPullRequest(card, { root, run = syncRun, env = process.env } = {}) {
  if (env.MACHINE_FIND_PR) {
    const found = run(env.MACHINE_FIND_PR, [card], { root, env, stdio: ['ignore', 'pipe', 'inherit'] });
    const number = Number(String(found.stdout ?? '').trim());
    return found.status === 0 && Number.isInteger(number) && number > 0
      ? { pr: number }
      : { error: `no pull request found for ${card}` };
  }
  const listed = run('gh', ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName', '--limit', '100'], {
    root,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (listed.status !== 0) return { error: 'gh could not list pull requests' };
  const needle = card.toLowerCase();
  const matches = JSON.parse(listed.stdout || '[]').filter(
    pr => String(pr.headRefName).toLowerCase().includes(needle) || String(pr.title).toLowerCase().includes(needle),
  );
  if (matches.length === 1) return { pr: matches[0].number };
  return {
    error:
      matches.length === 0
        ? `the build left no open pull request for ${card}`
        : `more than one open pull request names ${card}: ${matches.map(match => `#${match.number}`).join(', ')}`,
  };
}

export async function createCardWorkflow({
  mastra,
  session = null,
  root,
  model = null,
  timeLimitMs = BUILD_TIME_LIMIT_MS,
  currentSpan = () => null,
  deps = {},
  log = console.log,
}) {
  const { z, createWorkflow, createStep } = await loadMastra();
  const state = z.object({ card: z.string(), pr: z.number().nullable().default(null) });

  const build = deps.runBuild ?? runBuild;
  const find = deps.findPullRequest ?? findPullRequest;
  const runStage =
    deps.runStage ??
    ((stage, { card, pr }) => {
      const [command, args] = stageCommand(stage, { card, pr });
      log(`card: ${stage} runs ${command} ${args.join(' ')}`);
      const result = syncRun(command, args, { root, env: stageEnvironment() });
      return { status: result.status === 0 ? 'done' : 'failed', detail: result.status === 0 ? null : `exit code ${result.status}` };
    });

  const stepFor = (id, run) =>
    createStep({
      id,
      inputSchema: state,
      outputSchema: state,
      execute: async ({ inputData }) => {
        const outcome = await run(inputData);
        if (outcome?.error) throw new Error(`${id} stopped the card: ${outcome.error}`);
        if (outcome?.status === 'failed') throw new Error(`${id} stopped the card: ${outcome.detail ?? 'no reason given'}`);
        log(`card: ${id} done${outcome?.detail ? ` — ${outcome.detail}` : ''}`);
        return { card: inputData.card, pr: outcome?.pr ?? inputData.pr };
      },
    });

  const buildStep = stepFor('build', async ({ card }) => {
    const outcome = await build({ session, card, model, timeLimitMs, span: currentSpan(), log });
    if (outcome.timedOut) return { error: `the build ran out of time after ${Math.round(outcome.elapsedMs / 60_000)} minutes` };
    return { pr: null, detail: `${Math.round(outcome.elapsedMs / 1000)}s on thread ${outcome.threadId}` };
  });

  const pullRequestStep = stepFor('pull-request', async ({ card, pr }) => {
    if (pr) return { pr };
    const found = find(card, { root });
    if (found.error) return { error: found.error };
    return { pr: found.pr, detail: `#${found.pr}` };
  });

  const reviewStep = stepFor('review', async ({ card, pr }) => {
    if (!pr) return { error: 'there is no pull request to review' };
    return runStage('review', { card, pr });
  });

  const landingStep = stepFor('landing', async ({ card, pr }) => {
    if (!pr) return { error: 'there is no pull request to land' };
    return runStage('landing', { card, pr });
  });

  const workflow = createWorkflow({ id: WORKFLOW_ID, inputSchema: state, outputSchema: state })
    .then(buildStep)
    .then(pullRequestStep)
    .then(reviewStep)
    .then(landingStep)
    .commit();

  mastra.addWorkflow(workflow);
  return { workflow };
}
