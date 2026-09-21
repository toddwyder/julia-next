// dispatch.mjs -- JUL-98 step 3, item 1: every step is handed to a FRESH
// worker, through Orca's own worker-start.
//
// WHAT "FRESH" MEANS HERE, mechanically rather than as a wish:
//
//   * one `worker-start` per step, so Orca issues a new task id and a new
//     dispatch id (recorded: worker-start.claude-model-effort.json);
//   * `--worktree new-top-level`, never a reused worktree;
//   * NEVER `--terminal <handle>`. Adopting a terminal is a real Orca route
//     (worker-start.adopt-terminal-pi.json) but it hands the new step whatever
//     session is already in that terminal -- which is the one thing a fresh
//     worker must not have;
//   * the brief is built from ONE step. `buildStepBrief` takes a single step
//     object and has no way to reach the rest of the plan, so another step's
//     words cannot travel by accident.
//
// The brief carries exactly four things: the card, that step, the files the
// step names, and the path of the worker's own skill -- the builder skill for a
// build step, the reviewer skill for a review step (both merged in step 1).
// The standing orders themselves live in those files and are not repeated here;
// a second copy would drift.
//
// WHAT THIS MODULE DOES NOT DO. It does not decide that the worker started.
// `worker-start` answers `stage: "input_accepted"` even for a start that went
// on to succeed, so proof is ./turn-start.mjs's job and the caller's.

import { MODEL_CATALOG } from '../../scripts/seat-labels.mjs';
import { wasReplayed } from './inflight.mjs';

// The two worker skills, and only two (the card is explicit that there are no
// others until there is work for one). Paths, not contents: the worker reads
// the file in its own worktree.
export const WORKER_SKILLS = Object.freeze({
  builder: '.claude/skills/julia-builder/SKILL.md',
  reviewer: '.claude/skills/julia-reviewer/SKILL.md',
});

// The vendor model id `worker-start --model` is given, per MODEL_SPECS model
// name. These are the ids graph/rate-table.mjs prices, deliberately: a seat
// dispatched on a model the table cannot price could only ever produce a blank
// cost line, and a blank cost line fails the step. Two of them are recorded in
// real worker-start answers (`claude-sonnet-5`, `gpt-6-astra`).
export const LAUNCH_MODEL_IDS = Object.freeze({
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
  codex: 'gpt-6-astra',
  'deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek-v4-flash': 'deepseek-v4-flash',
});

// The seat-table entry -> the `--agent` name Orca launches. `pi-deepseek` is
// absent on purpose: see below.
const AGENT_FOR_ENTRY = Object.freeze({ claude: 'claude', codex: 'codex' });

// JUL-109, section 4: `run-pi-seat.mjs` runs Pi as a one-shot with no contract,
// so a Pi seat started that way cannot report to the mailbox at all; the only
// route that reported `worker_done` was an INTERACTIVE Pi, started first and
// adopted with `worker-start --terminal` once it had fully started. That route
// carries no model and no effort and needs the startup wait. So a DeepSeek seat
// is refused a new-worktree dispatch here rather than being launched into a
// shape no recording supports.
const PI_REFUSAL =
  'a DeepSeek (Pi) seat cannot be started with a new worktree: the only recorded route that reports to the mailbox is an interactive Pi adopted with worker-start --terminal once it has fully started (JUL-109 findings, section 4), and it carries no model or effort';

// `choice` is one seat's entry from scripts/seat-labels.mjs
// (`{ entry, modelLabel, effort }`). Returns what worker-start is given, or a
// refusal with a reason.
export function launchForChoice(choice) {
  const agent = AGENT_FOR_ENTRY[choice?.entry];
  if (!agent) {
    if (choice?.entry === 'pi-deepseek') return { ok: false, reason: PI_REFUSAL };
    return { ok: false, reason: `no Orca agent is known for seat-table entry ${JSON.stringify(choice?.entry ?? null)}` };
  }
  const spec = MODEL_CATALOG[choice.modelLabel];
  const modelName = spec?.model ?? (choice.entry === 'codex' ? 'codex' : null);
  const model = LAUNCH_MODEL_IDS[modelName];
  if (!model) {
    return { ok: false, reason: `no launch model id for model label ${JSON.stringify(choice.modelLabel)}` };
  }
  return { agent, model, effort: choice.effort };
}

function bullets(items) {
  return (items ?? []).map((item) => `- ${item}`).join('\n');
}

// The brief one fresh worker is started with. One step in, one brief out.
export function buildStepBrief({ seat, card, step, files = [] }) {
  const skill = WORKER_SKILLS[seat];
  if (!skill) throw new Error(`buildStepBrief: no worker skill for seat ${JSON.stringify(seat)} (seats: ${Object.keys(WORKER_SKILLS).join(', ')})`);
  if (!step?.title) throw new Error('buildStepBrief: the step needs a title');

  const lines = [
    `# ${card.identifier} -- ${step.title}`,
    '',
    `You are the ${seat} for this ONE step. Your standing orders are \`${skill}\` in your own`,
    'worktree: read it before anything else and follow it. You have no memory of any other step',
    'and you are not given one.',
    '',
    '## The card',
    '',
    `${card.identifier}: ${card.title}`,
  ];
  if (card.url) lines.push(card.url);
  lines.push('', '## This step', '', step.brief ?? '');
  if (step.criteria?.length) {
    lines.push('', '### What this step is judged on', '', bullets(step.criteria));
  }
  if (files.length) {
    lines.push('', '## The files this step is about', '', bullets(files));
  }
  if (step.priorFinding) {
    // The ONE thing that may travel from an earlier round: the finding this
    // round exists to fix. It is this step's input, not another step's context.
    lines.push('', '## The finding you are fixing', '', step.priorFinding);
  }
  lines.push('');
  return lines.join('\n');
}

// Start the worker. Returns the dispatch record, or `{ ok: false }` with Orca's
// own failure detail when the start itself failed (the trust-screen case:
// `failedStage: agent_readiness`, `lastError: timeout`, and a
// `residualResources` list naming the worktree and terminal left behind).
export async function dispatchWorker({
  workerStartImpl,
  environment,
  runId,
  from,
  repo,
  seat,
  card,
  step,
  choice,
  files = [],
  worktreeName,
  requestId,
}) {
  const launch = launchForChoice(choice);
  if (launch.ok === false) {
    // `launchRefused` marks the ONE case where nothing at all was created:
    // this seat's entry cannot be started, so there is no worker, no terminal
    // and no worktree behind this failure. ../controller/step-runner.mjs
    // branches on it to resolve the seat's backup (JUL-98 step 5, fifth fix);
    // a `worker-start` that FAILED is a different thing and keeps `ok: false`
    // without the mark, because it may have left residual resources.
    return { ok: false, seat, launchRefused: true, entry: choice?.entry ?? null, reason: launch.reason, residualResources: [] };
  }
  const spec = buildStepBrief({ seat, card, step, files });

  const result = await workerStartImpl({
    environment,
    run: runId,
    from,
    repo,
    // A fresh worktree and no terminal: the two mechanical halves of "fresh".
    worktree: 'new-top-level',
    name: worktreeName,
    spec,
    agent: launch.agent,
    model: launch.model,
    effort: launch.effort,
    requestId,
  });

  if (result.state === 'failed') {
    return {
      ok: false,
      seat,
      taskId: result.taskId ?? null,
      dispatchId: result.dispatchId ?? null,
      failedStage: result.failedStage ?? result.stage ?? null,
      lastError: result.lastError ?? null,
      residualResources: result.residualResources ?? [],
      reason: `worker-start failed at ${result.failedStage ?? result.stage} (${result.lastError ?? 'no error given'})`,
    };
  }

  const terminal = (result.effects ?? []).find((effect) => effect.kind === 'terminal')?.id ?? null;
  const worktree = (result.effects ?? []).find((effect) => effect.kind === 'worktree')?.id ?? null;

  return {
    ok: true,
    seat,
    stepKey: step.key ?? step.title,
    taskId: result.taskId,
    dispatchId: result.dispatchId,
    runId: result.runId,
    terminal,
    worktree,
    // Orca's own stage. Deliberately surfaced and deliberately NOT read as
    // "started": ./turn-start.mjs is what decides that.
    stage: result.stage ?? null,
    state: result.state ?? null,
    launch: { ...launch },
    replayed: wasReplayed(result),
    spec,
  };
}
