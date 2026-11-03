// The three stage programs, called one after another by the machine workflow.
// Every stage is a command line, so the stages keep their own records and the
// workflow only has to say what ran, in what order, and how it ended. The
// commands are spawned asynchronously on purpose: the parent process has to
// keep beating its heartbeat while a build runs for half an hour, and a
// synchronous spawn would freeze the clock that tells a slow run from a dead
// one.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStageUsage, stageEnvironment, stageTraceFolder, traceFiles } from './usage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');

export function kickoffPrompt(card) {
  return [
    'Read .agents/skills/poteto-mode/SKILL.md and follow it.',
    '',
    `Build Linear card ${card}. Read the whole card first, including Todd's dated decisions on it, and move it to Implementation when you start.`,
    '',
    'Open the pull request in the same step as your first push, name only this card in its description, and keep pushing as you go.',
    'When the build is ready and the pull request is up to date, stop. The machine starts Shipping.',
    'Only a product decision or one approval in Todd\'s own account may reach him. Decide the rest and log it in the decision log.',
  ].join('\n');
}

const agents = tail => ['node', ['scripts/julia-agents.mjs', '--', ...tail]];

export function stageCommand(stage, { card, pr, model } = {}, env = process.env) {
  const modelArgs = model ? ['--model', model] : [];
  if (stage === 'build') {
    return env.MACHINE_BUILD ? [env.MACHINE_BUILD, [card, kickoffPrompt(card)]] : ['mastracode', ['-p', kickoffPrompt(card)]];
  }
  if (stage === 'remediation') {
    return env.MACHINE_REMEDIATION
      ? [env.MACHINE_REMEDIATION, ['--pr', String(pr), '--card', card, ...modelArgs]]
      : agents(['node', 'machine/remediation/run.mjs', '--pr', String(pr), '--card', card, ...modelArgs]);
  }
  if (stage === 'landing') {
    return env.MACHINE_LANDING
      ? [env.MACHINE_LANDING, ['--pr', String(pr), '--card', card]]
      : agents(['node', 'machine/merge/run.mjs', '--pr', String(pr), '--card', card]);
  }
  throw new Error(`${stage} is not a stage of the machine`);
}

// The pull request the builder opened is the open one that names the card in
// its branch or title. More than one is a stop: the machine does not pick.
export function findPullRequest(card, { root = repoRoot, env = process.env, run = spawnSync } = {}) {
  const capture = ([command, args]) => run(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (env.MACHINE_FIND_PR) {
    const found = capture([env.MACHINE_FIND_PR, [card]]);
    const number = Number(String(found.stdout ?? '').trim());
    return found.status === 0 && Number.isInteger(number) && number > 0 ? { pr: number } : { error: `the builder left no open pull request for ${card}` };
  }
  const listed = capture(['gh', ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName', '--limit', '100']]);
  if (listed.status !== 0) return { error: 'gh could not list pull requests' };
  const needle = card.toLowerCase();
  let pulls;
  try {
    pulls = JSON.parse(listed.stdout || '[]');
  } catch {
    return { error: 'gh answered with something that is not a pull request list' };
  }
  const matches = pulls.filter(pr => String(pr.headRefName).toLowerCase().includes(needle) || String(pr.title).toLowerCase().includes(needle));
  if (matches.length === 1) return { pr: matches[0].number };
  return { error: matches.length === 0 ? `the builder left no open pull request for ${card}` : `more than one open pull request names ${card}: ${matches.map(pull => `#${pull.number}`).join(', ')}` };
}

function spawnCommand([command, args], { root, spawnImpl, env }) {
  return new Promise(resolve => {
    let settled = false;
    const done = value => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const child = spawnImpl(command, args, { cwd: root, stdio: 'inherit', env });
    child.on('error', error => done({ code: 127, error: error.message }));
    child.on('close', code => done({ code: code ?? 1 }));
  });
}

export function createStages({
  root = repoRoot,
  env = process.env,
  spawnImpl = spawn,
  find = findPullRequest,
  readUsage = readStageUsage,
  log = console.log,
} = {}) {
  // Every stage gets a folder of its own and is told to put its trace files
  // there. The parent's observability file is removed from the child's
  // environment: the parent holds that file open, so a child writing to it
  // would record nothing at all.
  const usageFor = async (stage, runDir) => {
    if (!runDir) return null;
    const folder = stageTraceFolder(runDir, stage);
    mkdirSync(folder, { recursive: true });
    return readUsage(traceFiles(folder));
  };

  return async function runStage(stage, { card, pr = null, model = null, runDir = null }) {
    if (stage === 'build' && pr) {
      return { status: 'skipped', pr, detail: `pull request #${pr} was given, so the build was skipped` };
    }
    if (stage !== 'build' && !pr) {
      return { status: 'failed', pr: null, detail: `${stage} needs a pull request, and the run has none` };
    }

    const [command, args] = stageCommand(stage, { card, pr, model }, env);
    const folder = runDir ? stageTraceFolder(runDir, stage) : null;
    if (folder) mkdirSync(folder, { recursive: true });
    log(`machine: ${stage} on ${card}${pr ? ` (pull request #${pr})` : ''}`);
    const result = await spawnCommand([command, args], {
      root,
      spawnImpl,
      env: folder ? stageEnvironment(env, folder) : env,
    });
    const usage = await usageFor(stage, runDir);
    if (result.code !== 0) {
      const why = result.error ? `${result.error}` : `exit code ${result.code}`;
      return { status: 'failed', pr, detail: `${stage} ended with ${why}`, usage };
    }

    if (stage === 'build') {
      const found = find(card, { root, env });
      if (found.error) return { status: 'failed', pr: null, detail: found.error, usage };
      return { status: 'succeeded', pr: found.pr, detail: `the builder opened pull request #${found.pr}`, usage };
    }
    if (stage === 'remediation') {
      return { status: 'succeeded', pr, detail: `the review loop passed pull request #${pr}`, usage };
    }
    return { status: 'succeeded', pr, detail: `pull request #${pr} merged`, usage };
  };
}
