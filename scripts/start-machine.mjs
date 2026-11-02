#!/usr/bin/env node
// start-machine: one command takes a card from "go" to "Complete".
//
//   node scripts/start-machine.mjs JUL-315
//
// It starts the builder itself (a headless Mastra Code session), finds the pull
// request the builder opened, runs the remediation machine (Shipping review, fix,
// fresh review), then runs the merge machine (merge, record, retro, sweep).
// Each stage saves its result in .artifacts/start-machine/<card>/state.json, so a
// second run of the same command continues where the first one stopped.
//
// Exit 0: the card is Complete. Exit 1: the machine stopped; the last line names
// the stage and the reason. Exit 2: bad arguments.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: node scripts/start-machine.mjs <JUL-n> [options]

  --pr <n>        a pull request that already exists for the card; skips the build
  --model <id>    Shipping review model, passed to the remediation machine
  --dry-run       print the commands each stage would run and stop
  --force         ignore the saved state and start again from the build
`;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export function parseArgs(argv) {
  const options = { card: null, pr: null, model: null, dryRun: false, force: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--pr') options.pr = Number(argv[++index]);
    else if (arg === '--model') options.model = argv[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (/^JUL-\d+$/i.test(arg)) options.card = arg.toUpperCase();
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

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

export function statePath(card, root = repoRoot) {
  return path.join(root, '.artifacts', 'start-machine', card, 'state.json');
}

export function readState(card, root = repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(statePath(card, root), 'utf8'));
  } catch {
    return { card, build: null, pr: null, remediation: null, merge: null };
  }
}

export function writeState(state, root = repoRoot) {
  const file = statePath(state.card, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

// Every stage is a command line. The defaults are the repository's own stage
// programs; the environment can replace any of them with another program that
// takes the same arguments and answers with the same exit codes.
export function stageCommands({ card, pr, model, retry = false }, env = process.env) {
  const agents = ['node', ['scripts/julia-agents.mjs', '--']];
  const withAgents = tail => [agents[0], [...agents[1], ...tail]];
  const modelArgs = model ? ['--model', model] : [];
  const retryArgs = retry ? ['--force'] : [];
  return {
    build: env.START_MACHINE_BUILD
      ? [env.START_MACHINE_BUILD, [card, kickoffPrompt(card)]]
      : ['mastracode', ['-p', kickoffPrompt(card)]],
    remediation: env.START_MACHINE_REMEDIATION
      ? [env.START_MACHINE_REMEDIATION, ['--pr', String(pr), '--card', card, ...modelArgs, ...retryArgs]]
      : withAgents(['node', 'machine/remediation/run.mjs', '--pr', String(pr), '--card', card, ...modelArgs, ...retryArgs]),
    merge: env.START_MACHINE_MERGE
      ? [env.START_MACHINE_MERGE, ['--pr', String(pr), '--card', card]]
      : withAgents(['node', 'machine/merge/run.mjs', '--pr', String(pr), '--card', card]),
  };
}

function run([command, args], { root, capture = false }) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) return { code: 127, out: '', error: result.error.message };
  return { code: result.status ?? 1, out: result.stdout ?? '' };
}

// The pull request the builder opened is the open one that names the card in its
// branch or title. More than one is a stop: the machine does not pick between them.
export function findPullRequest(card, root = repoRoot, env = process.env) {
  if (env.START_MACHINE_FIND_PR) {
    const found = run([env.START_MACHINE_FIND_PR, [card]], { root, capture: true });
    const number = Number(found.out.trim());
    return found.code === 0 && Number.isInteger(number) && number > 0 ? { pr: number } : { error: `no pull request found for ${card}` };
  }
  const listed = run(['gh', ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName', '--limit', '100']], { root, capture: true });
  if (listed.code !== 0) return { error: 'gh could not list pull requests' };
  const needle = card.toLowerCase();
  const matches = JSON.parse(listed.out || '[]').filter(
    pr => String(pr.headRefName).toLowerCase().includes(needle) || String(pr.title).toLowerCase().includes(needle),
  );
  if (matches.length === 1) return { pr: matches[0].number };
  return { error: matches.length === 0 ? `the builder left no open pull request for ${card}` : `more than one open pull request names ${card}: ${matches.map(m => `#${m.number}`).join(', ')}` };
}

export function startMachine(options, { root = repoRoot, env = process.env, log = console.log } = {}) {
  const card = options.card;
  const state = options.force ? { card, build: null, pr: null, remediation: null, merge: null } : readState(card, root);
  if (options.pr) state.pr = options.pr;
  const save = () => writeState(state, root);

  if (options.dryRun) {
    const commands = stageCommands({ card, pr: state.pr ?? '<n>', model: options.model }, env);
    for (const [stage, [command, args]] of Object.entries(commands)) log(`${stage}: ${command} ${args.map(a => (a.includes('\n') ? '<kickoff prompt>' : a)).join(' ')}`);
    return { code: 0 };
  }

  const stop = (stage, reason) => {
    state[stage] = { status: 'stopped', reason, at: new Date().toISOString() };
    save();
    log(`start-machine stopped at ${stage}: ${reason}`);
    return { code: 1, stage, reason };
  };

  if (state.merge?.status === 'done') {
    log(`${card} already finished: ${state.merge.detail ?? 'merged'}. Pass --force to run it again.`);
    return { code: 0 };
  }

  if (!state.pr && state.build?.status !== 'done') {
    log(`start-machine: building ${card}`);
    const built = run(stageCommands({ card, pr: null, model: options.model }, env).build, { root });
    if (built.code !== 0) return stop('build', `the builder session ended with exit code ${built.code}${built.error ? ` (${built.error})` : ''}`);
    state.build = { status: 'done', at: new Date().toISOString() };
    save();
  }

  if (!state.pr) {
    const found = findPullRequest(card, root, env);
    if (found.error) return stop('pr', found.error);
    state.pr = found.pr;
    save();
  }

  if (state.remediation?.status !== 'done') {
    log(`start-machine: review and remediation of #${state.pr}`);
    // A loop that stopped the card refuses to start again unless it is told to; the card is read afresh on a retry.
    const retry = state.remediation?.status === 'stopped';
    const reviewed = run(stageCommands({ card, pr: state.pr, model: options.model, retry }, env).remediation, { root });
    if (reviewed.code !== 0) return stop('remediation', `the review loop stopped the card (exit code ${reviewed.code}); its record is in .artifacts/remediation/pr-${state.pr}`);
    state.remediation = { status: 'done', at: new Date().toISOString() };
    save();
  }

  log(`start-machine: merge, record, retro and sweep of #${state.pr}`);
  const merged = run(stageCommands({ card, pr: state.pr, model: options.model }, env).merge, { root });
  if (merged.code !== 0) return stop('merge', `the merge machine stopped (exit code ${merged.code}); its record is in .artifacts/merge/pr-${state.pr}`);
  state.merge = { status: 'done', at: new Date().toISOString(), detail: `pull request #${state.pr} merged` };
  save();
  log(`start-machine: ${card} is Complete (pull request #${state.pr}).`);
  return { code: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!options.card) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(startMachine(options).code);
}
